import assert from "node:assert/strict";
import test from "node:test";

import { maybeEntitleBookingAfterPayment } from "@/lib/availability/entitlement";
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

test("maybeEntitleBookingAfterPayment: winner query uses deterministic entitlement ordering", async () => {
  const { db, calls } = createMockDb([
    {
      rows: [
        {
          id: "booking-current",
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
    { rows: [{}], rowCount: 1 },
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
          entitlement_sort_at: "2026-03-01T09:00:00.000Z",
        },
      ],
      rowCount: 1,
    },
    {
      rows: [{ pricing_json: { payment_status: "DEPOSIT_PAID", amount_paid: 5000, deposit_cents: 5000 } }],
      rowCount: 1,
    },
    { rows: [], rowCount: 1 },
  ]);

  const resolution = await maybeEntitleBookingAfterPayment("booking-current", {
    client: db,
    recalculateBooking: async () => ({
      bookingId: "booking-current",
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

  const winnerQuery = calls.find((call) => call.text.includes("order by entitlement_sort_at asc"));
  assert.ok(winnerQuery, "expected winner query with deterministic ordering");
  assert.match(
    winnerQuery.text,
    /order by entitlement_sort_at asc, booking_created_at asc, b\.id asc limit 1/,
  );
});
