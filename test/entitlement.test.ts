import assert from "node:assert/strict";
import test from "node:test";

import {
  isEntitledBooking,
  listAvailableVehiclesEntitlementBased,
  maybeEntitleBookingAfterPayment,
} from "@/lib/availability/entitlement";
import type { Queryable } from "@/lib/payments/pricing";

type MockResponse = {
  rows: unknown[];
  rowCount: number;
};

function createMockDb(responses: MockResponse[]) {
  const queue = [...responses];
  const calls: Array<{ text: string; params: unknown[] | undefined }> = [];
  const db: Queryable = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      const next = queue.shift();
      if (!next) {
        throw new Error(`Unexpected query: ${text}`);
      }
      return next;
    },
  };
  return { db, calls };
}

test("entitlement: paidToDate below depositRequired remains tentative", () => {
  const entitled = isEntitledBooking({
    status: "PENDING_PAYMENT",
    pricing_json: {
      payment_status: "DEPOSIT_PAID",
      amount_paid: 2000,
      deposit_cents: 5000,
    },
  });
  assert.equal(entitled, false);
});

test("entitlement: paidToDate meeting depositRequired is entitled", () => {
  const entitled = isEntitledBooking({
    status: "PENDING_PAYMENT",
    pricing_json: {
      payment_status: "DEPOSIT_PAID",
      amount_paid: 5000,
      deposit_cents: 5000,
    },
  });
  assert.equal(entitled, true);
});

test("listAvailableVehiclesEntitlementBased: entitled overlap hides vehicle from listing", async () => {
  const vehicles = [{ id: "11111111-1111-4111-8111-111111111111", label: "A" }, { id: "22222222-2222-4222-8222-222222222222", label: "B" }];
  const { db } = createMockDb([
    {
      rows: [{ vehicle_id: "22222222-2222-4222-8222-222222222222" }],
      rowCount: 1,
    },
  ]);

  const available = await listAvailableVehiclesEntitlementBased(
    vehicles,
    { startAt: "2026-04-01T10:00:00.000Z", endAt: "2026-04-04T10:00:00.000Z" },
    { client: db },
  );

  assert.deepEqual(
    available.map((vehicle) => vehicle.id),
    ["11111111-1111-4111-8111-111111111111"],
  );
});

test("listAvailableVehiclesEntitlementBased: tentative overlaps do not hide vehicles", async () => {
  const vehicles = [{ id: "11111111-1111-4111-8111-111111111111", label: "A" }];
  const { db } = createMockDb([
    {
      rows: [],
      rowCount: 0,
    },
  ]);

  const available = await listAvailableVehiclesEntitlementBased(
    vehicles,
    { startAt: "2026-04-01T10:00:00.000Z", endAt: "2026-04-04T10:00:00.000Z" },
    { client: db },
  );

  assert.equal(available.length, 1);
  assert.equal(available[0]?.id, "11111111-1111-4111-8111-111111111111");
});

test("maybeEntitleBookingAfterPayment: threshold reached entitles winner and cancels tentative overlaps", async () => {
  const { db, calls } = createMockDb([
    {
      rows: [
        {
          id: "booking-winner",
          status: "PENDING_PAYMENT",
          vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          start_date: "2026-04-01",
          end_date: "2026-04-03",
          start_at: "2026-04-01T10:00:00.000Z",
          end_at: "2026-04-03T10:00:00.000Z",
          pricing_json: {},
        },
      ],
      rowCount: 1,
    },
    { rows: [{}], rowCount: 1 }, // advisory lock
    { rows: [], rowCount: 0 }, // overlapping entitled
    { rows: [], rowCount: 1 }, // set confirmed
    {
      rows: [
        {
          id: "booking-loser",
          status: "PENDING_PAYMENT",
          start_date: "2026-04-01",
          end_date: "2026-04-03",
          pickup_location: "Kingston",
          pricing_json: { payment_status: "UNPAID", amount_paid: 0, deposit_cents: 5000 },
          customer_name: "Loser Customer",
          customer_email: "loser@example.com",
          vehicle_make: "Toyota",
          vehicle_model: "Yaris",
          amount_paid: 0,
          deposit_required: 5000,
        },
      ],
      rowCount: 1,
    },
    { rows: [], rowCount: 1 }, // cancel loser
    {
      rows: [{ pricing_json: { payment_status: "DEPOSIT_PAID", amount_paid: 5000, deposit_cents: 5000 } }],
      rowCount: 1,
    },
    { rows: [], rowCount: 1 }, // update winner pricing
  ]);

  const resolution = await maybeEntitleBookingAfterPayment("booking-winner", {
    client: db,
    recalculateBooking: async () => ({
      bookingId: "booking-winner",
      days: 3,
      dailyRate: 12000,
      subtotalAmount: 36000,
      promoCode: null,
      promoDiscount: 0,
      totalAmount: 36000,
      depositAmount: 5000,
      paymentOption: "DEPOSIT",
      netPaidToDate: 5000,
      balanceDue: 31000,
      paymentStatus: "DEPOSIT_PAID",
      refundRequired: false,
    }),
  });

  assert.equal(resolution.state, "ENTITLED");
  assert.equal(resolution.winnerBookingId, "booking-winner");
  assert.equal(resolution.cancelledOverlaps.length, 1);
  assert.equal(resolution.cancelledOverlaps[0]?.id, "booking-loser");
  assert.ok(
    calls.some((call) => call.text.includes("pg_advisory_xact_lock")),
    "expected advisory lock query",
  );
});

test("maybeEntitleBookingAfterPayment: existing entitled overlap causes booking to lose", async () => {
  const { db } = createMockDb([
    {
      rows: [
        {
          id: "booking-loser",
          status: "PENDING_PAYMENT",
          vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          start_date: "2026-04-01",
          end_date: "2026-04-03",
          start_at: "2026-04-01T10:00:00.000Z",
          end_at: "2026-04-03T10:00:00.000Z",
          pricing_json: {},
        },
      ],
      rowCount: 1,
    },
    { rows: [{}], rowCount: 1 }, // advisory lock
    {
      rows: [
        {
          id: "booking-winner",
          status: "CONFIRMED",
          vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          start_date: "2026-04-01",
          end_date: "2026-04-03",
          start_at: "2026-04-01T10:00:00.000Z",
          end_at: "2026-04-03T10:00:00.000Z",
          amount_paid: 5000,
          deposit_required: 5000,
        },
      ],
      rowCount: 1,
    },
    { rows: [{ pricing_json: { payment_status: "DEPOSIT_PAID", amount_paid: 5000, deposit_cents: 5000 } }], rowCount: 1 },
    { rows: [], rowCount: 1 }, // cancel loser
  ]);

  const resolution = await maybeEntitleBookingAfterPayment("booking-loser", {
    client: db,
    recalculateBooking: async () => ({
      bookingId: "booking-loser",
      days: 3,
      dailyRate: 12000,
      subtotalAmount: 36000,
      promoCode: null,
      promoDiscount: 0,
      totalAmount: 36000,
      depositAmount: 5000,
      paymentOption: "DEPOSIT",
      netPaidToDate: 5000,
      balanceDue: 31000,
      paymentStatus: "DEPOSIT_PAID",
      refundRequired: false,
    }),
  });

  assert.equal(resolution.state, "LOST");
  assert.equal(resolution.winnerBookingId, "booking-winner");
  assert.equal(resolution.status, "CANCELLED");
});
