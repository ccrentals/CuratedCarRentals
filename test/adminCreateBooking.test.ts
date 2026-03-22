import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminBookingsPost,
  type AdminBookingsPostRouteDeps,
} from "@/app/api/admin/bookings/route";
import {
  buildAdminCreateBookingWindow,
  computeAdminCreateBookingPricingPreview,
  getAdminCreateBookingPricingPreview,
  listAdminCreateBookingAvailableVehicles,
} from "@/lib/bookings/adminCreateBooking";
import {
  isAdminCreateBookingDateRangeValid,
  suggestAdminCreateBookingEndDate,
  suggestAdminCreateBookingPaymentAmount,
} from "@/lib/bookings/adminCreateBookingDates";
import {
  handleAdminBookingAddPaymentPost,
  type AdminBookingAddPaymentRouteDeps,
} from "@/app/api/admin/bookings/[id]/add-payment/route";
import type { Queryable } from "@/lib/payments/pricing";

type MockResponse = {
  rows: unknown[];
  rowCount: number;
};

function createMockDb(responses: MockResponse[]) {
  const queue = [...responses];
  const calls: Array<{ text: string; params?: unknown[] }> = [];
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

test("admin create booking helper: builds full-day window from date-only inputs", () => {
  const window = buildAdminCreateBookingWindow("2026-04-10", "2026-04-12");

  assert.deepEqual(window, {
    startAt: "2026-04-10T00:00:00.000Z",
    endAt: "2026-04-13T00:00:00.000Z",
  });
});

test("admin create booking helper: suggests an end date two days after the selected start date", () => {
  assert.equal(suggestAdminCreateBookingEndDate("2026-05-18"), "2026-05-20");
});

test("admin create booking helper: treats same-day ranges as valid for initial availability filtering", () => {
  assert.equal(isAdminCreateBookingDateRangeValid("2026-05-18", "2026-05-18"), true);
  assert.equal(isAdminCreateBookingDateRangeValid("2026-05-18", "2026-05-17"), false);
});

test("admin create booking helper: suggests the deposit required as the default payment amount", () => {
  assert.equal(suggestAdminCreateBookingPaymentAmount(50000), "50000.00");
});

test("admin create booking helper: does not suggest a payment amount before preview data exists", () => {
  assert.equal(suggestAdminCreateBookingPaymentAmount(null), "");
  assert.equal(suggestAdminCreateBookingPaymentAmount(undefined), "");
});

test("admin create booking helper: computes pricing preview once dates and vehicle pricing are known", () => {
  const preview = computeAdminCreateBookingPricingPreview({
    dailyRateCents: 15000,
    depositCents: 50000,
    startDate: "2026-04-10",
    endDate: "2026-04-12",
  });

  assert.deepEqual(preview, {
    days: 3,
    dailyRateCents: 15000,
    subtotalCents: 45000,
    promoDiscountCents: 0,
    totalCents: 45000,
    depositRequiredCents: 50000,
    currency: "JMD",
  });
});

test("admin create booking helper: omits vehicles blocked by entitled overlapping bookings", async () => {
  const { db, calls } = createMockDb([
    {
      rows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          year: 2026,
          make: "Toyota",
          model: "Corolla",
          daily_rate_cents: 12000,
          deposit_cents: 25000,
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          year: 2026,
          make: "Nissan",
          model: "Patrol",
          daily_rate_cents: 28000,
          deposit_cents: 50000,
        },
      ],
      rowCount: 2,
    },
    {
      rows: [{ vehicle_id: "22222222-2222-4222-8222-222222222222" }],
      rowCount: 1,
    },
  ]);

  const availableVehicles = await listAdminCreateBookingAvailableVehicles(
    "2026-04-10",
    "2026-04-12",
    { client: db },
  );

  assert.deepEqual(
    availableVehicles.map((vehicle) => vehicle.id),
    ["11111111-1111-4111-8111-111111111111"],
  );
  assert.ok(calls[0]?.text.includes("deleted_at is null"));
});

test("admin create booking helper: preview ignores soft-deleted vehicles", async () => {
  const { db, calls } = createMockDb([{ rows: [], rowCount: 0 }]);

  const preview = await getAdminCreateBookingPricingPreview(
    "11111111-1111-4111-8111-111111111111",
    "2026-04-10",
    "2026-04-12",
    { client: db },
  );

  assert.equal(preview, null);
  assert.ok(calls[0]?.text.includes("deleted_at is null"));
});

test("admin bookings API: submit still rejects unavailable vehicles after UI prefiltering", async () => {
  const queries: string[] = [];
  const client = {
    async query(text: string) {
      queries.push(text);
      if (text === "begin") return { rowCount: 0, rows: [] };
      if (text === "rollback") return { rowCount: 0, rows: [] };
      if (text.includes("select id, year, make, model, daily_rate_cents, deposit_cents")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              year: 2026,
              make: "Toyota",
              model: "Corolla",
              daily_rate_cents: 12000,
              deposit_cents: 25000,
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {
      return undefined;
    },
  };

  const deps: AdminBookingsPostRouteDeps = {
    requireAdmin: async () =>
      ({
        ok: true,
        actor: {
          userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
          role: "ADMIN",
          appRole: "ADMIN",
          authSource: "legacy",
          clerkUserId: null,
          issuedAt: 999999000,
          expiresAt: 999999999,
        },
        session: {
          userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
          role: "ADMIN",
          issuedAt: 999999000,
          expiresAt: 999999999,
        },
      }) as Awaited<ReturnType<AdminBookingsPostRouteDeps["requireAdmin"]>>,
    requireCsrfToken: async () => true,
    getPool: () =>
      ({
        connect: async () => client,
      }) as ReturnType<AdminBookingsPostRouteDeps["getPool"]>,
    isVehicleUnavailable: async () => true,
    upsertCustomer: async () => {
      throw new Error("upsertCustomer should not be reached when vehicle is unavailable");
    },
    validatePromo: async () => {
      throw new Error("validatePromo should not be reached when vehicle is unavailable");
    },
    writeAudit: async () => undefined,
    sendCreatedEmail: async () => undefined,
    log: () => undefined,
  };

  const response = await handleAdminBookingsPost(
    new Request("http://localhost/api/admin/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        vehicleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        fullName: "Admin Booking Tester",
        email: "admin-booking@example.com",
        phone: "+18765550144",
        startDate: "2099-04-10",
        endDate: "2099-04-12",
        pickupLocation: "Montego Bay Airport",
      }),
    }),
    deps,
  );

  assert.equal(response.status, 409);
  assert.ok(queries.includes("rollback"));
});

test("admin bookings API: submit rejects soft-deleted vehicles even if posted directly", async () => {
  const queries: string[] = [];
  const client = {
    async query(text: string) {
      queries.push(text);
      if (text === "begin") return { rowCount: 0, rows: [] };
      if (text === "rollback") return { rowCount: 0, rows: [] };
      if (text.includes("select id, year, make, model, daily_rate_cents, deposit_cents")) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {
      return undefined;
    },
  };

  const deps: AdminBookingsPostRouteDeps = {
    requireAdmin: async () =>
      ({
        ok: true,
        actor: {
          userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
          role: "ADMIN",
          appRole: "ADMIN",
          authSource: "legacy",
          clerkUserId: null,
          issuedAt: 999999000,
          expiresAt: 999999999,
        },
        session: {
          userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
          role: "ADMIN",
          issuedAt: 999999000,
          expiresAt: 999999999,
        },
      }) as Awaited<ReturnType<AdminBookingsPostRouteDeps["requireAdmin"]>>,
    requireCsrfToken: async () => true,
    getPool: () =>
      ({
        connect: async () => client,
      }) as ReturnType<AdminBookingsPostRouteDeps["getPool"]>,
    isVehicleUnavailable: async () => {
      throw new Error("isVehicleUnavailable should not be reached when vehicle is not bookable");
    },
    upsertCustomer: async () => {
      throw new Error("upsertCustomer should not be reached when vehicle is not bookable");
    },
    validatePromo: async () => {
      throw new Error("validatePromo should not be reached when vehicle is not bookable");
    },
    writeAudit: async () => undefined,
    sendCreatedEmail: async () => undefined,
    log: () => undefined,
  };

  const response = await handleAdminBookingsPost(
    new Request("http://localhost/api/admin/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        vehicleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        fullName: "Admin Booking Tester",
        email: "admin-booking@example.com",
        phone: "+18765550144",
        startDate: "2099-04-10",
        endDate: "2099-04-12",
        pickupLocation: "Montego Bay Airport",
      }),
    }),
    deps,
  );

  assert.equal(response.status, 404);
  assert.ok(queries.some((query) => query.includes("deleted_at is null")));
  assert.ok(queries.includes("rollback"));
});

test("admin bookings API: create still succeeds when audit logging fails after commit", async () => {
  const queries: string[] = [];
  const client = {
    async query(text: string, params?: unknown[]) {
      queries.push(text);
      if (text === "begin" || text === "commit") return { rowCount: 0, rows: [] };
      if (text.includes("select id, year, make, model, daily_rate_cents, deposit_cents")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              year: 2026,
              make: "Toyota",
              model: "Corolla",
              daily_rate_cents: 12000,
              deposit_cents: 25000,
            },
          ],
        };
      }
      if (text.includes("insert into bookings")) {
        return {
          rowCount: 1,
          rows: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "PENDING_PAYMENT" }],
        };
      }
      throw new Error(`Unexpected query: ${text} ${JSON.stringify(params ?? [])}`);
    },
    release() {
      return undefined;
    },
  };

  const deps: AdminBookingsPostRouteDeps = {
    requireAdmin: async () =>
      ({
        ok: true,
        actor: {
          userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
          role: "ADMIN",
          appRole: "ADMIN",
          authSource: "legacy",
          clerkUserId: null,
          issuedAt: 999999000,
          expiresAt: 999999999,
        },
        session: {
          userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
          role: "ADMIN",
          issuedAt: 999999000,
          expiresAt: 999999999,
        },
      }) as Awaited<ReturnType<AdminBookingsPostRouteDeps["requireAdmin"]>>,
    requireCsrfToken: async () => true,
    getPool: () =>
      ({
        connect: async () => client,
      }) as ReturnType<AdminBookingsPostRouteDeps["getPool"]>,
    isVehicleUnavailable: async () => false,
    upsertCustomer: async () => ({
      customerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      created: true,
    }),
    validatePromo: async () => ({ ok: true, discountAmountCents: 0, promoId: null }),
    writeAudit: async () => {
      throw new Error("audit unavailable");
    },
    sendCreatedEmail: async () => undefined,
    log: () => undefined,
  };

  const response = await handleAdminBookingsPost(
    new Request("http://localhost/api/admin/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        vehicleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        fullName: "Admin Booking Tester",
        email: "admin-booking@example.com",
        phone: "+18765550144",
        startDate: "2099-04-10",
        endDate: "2099-04-12",
        pickupLocation: "Montego Bay Airport",
      }),
    }),
    deps,
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.bookingId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.ok(queries.includes("commit"));
});

test("admin add payment API: payment succeeds even when post-commit audit and emails fail", async () => {
  const queries: string[] = [];
  const client = {
    async query(text: string, params?: unknown[]) {
      queries.push(text);
      if (text === "begin" || text === "commit") return { rowCount: 0, rows: [] };
      if (text.includes("select b.id, b.vehicle_id, b.status")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              status: "PENDING_PAYMENT",
              start_date: "2099-04-10",
              end_date: "2099-04-12",
              pickup_location: "Montego Bay Airport",
              pricing_json: {},
              customer_name: "Admin Booking Tester",
              customer_email: "admin-booking@example.com",
              customer_phone: "+18765550144",
              vehicle_make: "Toyota",
              vehicle_model: "Corolla",
              vehicle_year: 2026,
              daily_rate_cents: 12000,
              deposit_cents: 25000,
            },
          ],
        };
      }
      if (text.includes("select id from payments where booking_id = $1 and provider = 'MANUAL' and status = 'DEPOSIT_PAID'")) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes("insert into payments")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected query: ${text} ${JSON.stringify(params ?? [])}`);
    },
    release() {
      return undefined;
    },
  };

  let maybeEntitleOptions: Record<string, unknown> | null = null;
  const deps: AdminBookingAddPaymentRouteDeps = {
    requireStaff: async () =>
      ({
        ok: true,
        actor: {
          userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
          role: "ADMIN",
          appRole: "ADMIN",
          authSource: "legacy",
          clerkUserId: null,
          issuedAt: 999999000,
          expiresAt: 999999999,
        },
        session: {
          userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
          role: "ADMIN",
          issuedAt: 999999000,
          expiresAt: 999999999,
        },
      }) as Awaited<ReturnType<AdminBookingAddPaymentRouteDeps["requireStaff"]>>,
    requireCsrfCheck: async () => true,
    getPool: () =>
      ({
        connect: async () => client,
      }) as ReturnType<AdminBookingAddPaymentRouteDeps["getPool"]>,
    maybeEntitle: async (_bookingId, options) => {
      maybeEntitleOptions = options as Record<string, unknown>;
      return {
        bookingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        state: "ENTITLED",
        status: "CONFIRMED",
        paidToDate: 25000,
        depositRequired: 25000,
        cancelledOverlaps: [],
        winnerBookingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      };
    },
    recalculate: async () => ({
      bookingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      days: 3,
      dailyRate: 12000,
      subtotalAmount: 36000,
      promoCode: null,
      promoDiscount: 0,
      totalAmount: 36000,
      depositAmount: 25000,
      paymentOption: "DEPOSIT",
      netPaidToDate: 25000,
      balanceDue: 11000,
      paymentStatus: "DEPOSIT_PAID",
      refundRequired: false,
    }),
    writeAudit: async () => {
      throw new Error("audit unavailable");
    },
    sendOverrideEmail: async () => {
      throw new Error("override email unavailable");
    },
    sendCompleteEmail: async () => {
      throw new Error("complete email unavailable");
    },
    sendUpdateEmail: async () => {
      throw new Error("update email unavailable");
    },
    getNotesRecipient: () => "ops@example.com",
    log: () => undefined,
  };

  const response = await handleAdminBookingAddPaymentPost(
    new Request("http://localhost/api/admin/bookings/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/add-payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        amount: 25000,
        method: "CASH",
        paidAt: "2099-04-10T12:00:00.000Z",
      }),
    }),
    { params: Promise.resolve({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }) },
    deps,
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.paidToDate, 25000);
  assert.equal(payload.balanceDue, 11000);
  assert.ok(queries.some((query) => query.includes("insert into payments")));
  assert.ok(queries.includes("commit"));
  assert.equal(maybeEntitleOptions?.auditUserId, undefined);
});
