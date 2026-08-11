import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminBookingCancelPost } from "@/app/api/admin/bookings/[id]/cancel/implementation";
import { handleAdminBookingMarkDepositPaidPost } from "@/app/api/admin/bookings/[id]/mark-deposit-paid/route";
import { handleAdminBookingMarkFullyPaidPost } from "@/app/api/admin/bookings/[id]/mark-fully-paid/route";
import { handleAdminBookingResendEmailPost } from "@/app/api/admin/bookings/[id]/resend-email/route";

function operationsAuth() {
  return {
    ok: true as const,
    actor: {
      userId: "operations-user-id",
      role: "OPERATIONS",
      appRole: "OPERATIONS",
    },
  };
}

function deniedRateLimit(limit = 10) {
  return {
    count: limit + 1,
    limit,
    allowed: false,
    remaining: 0,
    resetAt: "2026-05-25T18:10:00.000Z",
    retryAfterSeconds: 600,
  };
}

test("admin booking cancel API: rate limits repeated cancellation attempts per user and booking", async () => {
  const response = await handleAdminBookingCancelPost(
    new Request("http://localhost/api/admin/bookings/booking-1/cancel", {
      method: "POST",
      headers: { "x-csrf-token": "token" },
    }),
    { params: Promise.resolve({ id: "booking-1" }) },
    {
      requireAdminAccess: async () => operationsAuth(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      getPool: () => {
        throw new Error("should not reach database");
      },
      syncPromoRedemption: async () => undefined,
      writeAudit: async () => undefined,
      log: () => undefined,
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
  const payload = (await response.json()) as { error?: string };
  assert.match(String(payload.error), /too many booking cancellation attempts/i);
});

test("admin booking mark deposit paid API: rate limits repeated deposit actions per user and booking", async () => {
  const response = await handleAdminBookingMarkDepositPaidPost(
    new Request("http://localhost/api/admin/bookings/booking-1/mark-deposit-paid", {
      method: "POST",
      headers: { "x-csrf-token": "token" },
    }),
    { params: Promise.resolve({ id: "booking-1" }) },
    {
      requireAdminAccess: async () => operationsAuth(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      getPool: () => {
        throw new Error("should not reach database");
      },
      maybeEntitle: async () => {
        throw new Error("should not reach entitlement");
      },
      recalculate: async () => {
        throw new Error("should not reach recalculation");
      },
      writeAudit: async () => undefined,
      sendOverrideEmail: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendCompleteEmail: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendUpdateEmail: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendInternalComplete: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendInternalUpdate: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      getNotesRecipient: () => "ops@example.com",
      log: () => undefined,
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
  const payload = (await response.json()) as { error?: string };
  assert.match(String(payload.error), /too many deposit payment actions/i);
});

test("admin booking mark fully paid API: rate limits repeated full payment actions per user and booking", async () => {
  const response = await handleAdminBookingMarkFullyPaidPost(
    new Request("http://localhost/api/admin/bookings/booking-1/mark-fully-paid", {
      method: "POST",
      headers: { "x-csrf-token": "token" },
    }),
    { params: Promise.resolve({ id: "booking-1" }) },
    {
      requireAdminAccess: async () => operationsAuth(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      getPool: () => {
        throw new Error("should not reach database");
      },
      maybeEntitle: async () => {
        throw new Error("should not reach entitlement");
      },
      recalculate: async () => {
        throw new Error("should not reach recalculation");
      },
      writeAudit: async () => undefined,
      sendOverrideEmail: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendCompleteEmail: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendUpdateEmail: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendInternalComplete: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendInternalUpdate: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      getNotesRecipient: () => "ops@example.com",
      log: () => undefined,
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
  const payload = (await response.json()) as { error?: string };
  assert.match(String(payload.error), /too many full payment actions/i);
});

test("admin booking resend email API: rate limits repeated resend actions per user and booking", async () => {
  const response = await handleAdminBookingResendEmailPost(
    new Request("http://localhost/api/admin/bookings/booking-1/resend-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ type: "booking_created" }),
    }),
    { params: Promise.resolve({ id: "booking-1" }) },
    {
      requireAdminAccess: async () => operationsAuth(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      query: async () => {
        throw new Error("should not reach database");
      },
      sendBookingCreated: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendDepositReceipt: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendPaymentComplete: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      acquireDedupe: async () => undefined,
      finalizeDedupe: async () => undefined,
      makeDedupeKey: () => "dedupe-key",
      randomId: () => "uuid",
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
  const payload = (await response.json()) as { error?: string };
  assert.match(String(payload.error), /too many resend email actions/i);
});

test("admin booking resend email API: sends the current repriced insurance and payment summary", async () => {
  let sentInput: Parameters<
    Parameters<typeof handleAdminBookingResendEmailPost>[2]["sendBookingCreated"]
  >[0] | null = null;

  const response = await handleAdminBookingResendEmailPost(
    new Request("http://localhost/api/admin/bookings/booking-1/resend-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ type: "booking_created" }),
    }),
    { params: Promise.resolve({ id: "booking-1" }) },
    {
      requireAdminAccess: async () => operationsAuth(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => ({
        count: 1,
        limit: 10,
        allowed: true,
        remaining: 9,
        resetAt: "2026-06-24T22:10:00.000Z",
        retryAfterSeconds: 600,
      }),
      query: async (text: string) => {
        if (text.includes("from bookings b join customers")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: "booking-1",
                status: "BOOKED",
                start_date: "2026-12-23",
                end_date: "2027-01-09",
                pickup_location: "41 Upper Waterloo Rd",
                pricing_json: {
                  days: 18,
                  daily_rate_cents: 8500,
                  base_total_cents: 153000,
                  insurance_selected: false,
                  insurance_price_per_day_cents: 0,
                  insurance_total_cents: 0,
                  subtotal_cents: 153000,
                  total_cents: 153000,
                  deposit_cents: 3400,
                  amount_paid: 3400,
                  balance_due: 149600,
                  payment_option_selected: "DEPOSIT",
                },
                customer_name: "Anslem George",
                customer_email: "anslem@example.com",
                vehicle_make: "Subaru",
                vehicle_model: "XV",
                vehicle_year: 2018,
                daily_rate_cents: 8500,
                deposit_cents: 3400,
              },
            ],
          };
        }
        throw new Error(`Unexpected query: ${text}`);
      },
      sendBookingCreated: async (input) => {
        sentInput = input;
        return {
          ok: true,
          skipped: false,
          delivered: 1,
          errors: [],
          providerMessageId: "email-1",
        };
      },
      sendDepositReceipt: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendPaymentComplete: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      acquireDedupe: async () => undefined,
      finalizeDedupe: async () => undefined,
      makeDedupeKey: () => "dedupe-key",
      randomId: () => "uuid",
    },
  );

  assert.equal(response.status, 200);
  assert.equal(sentInput?.insuranceTotal, 0);
  assert.equal(sentInput?.total, 153000);
  assert.equal(sentInput?.paidToDate, 3400);
  assert.equal(sentInput?.balanceDue, 149600);
  assert.equal(sentInput?.paymentOption, "DEPOSIT");
});

test("admin booking resend email API: supports full-payment receipts", async () => {
  let sentInput: Parameters<
    Parameters<typeof handleAdminBookingResendEmailPost>[2]["sendPaymentComplete"]
  >[0] | null = null;

  const response = await handleAdminBookingResendEmailPost(
    new Request("http://localhost/api/admin/bookings/booking-1/resend-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ type: "payment_complete" }),
    }),
    { params: Promise.resolve({ id: "booking-1" }) },
    {
      requireAdminAccess: async () => operationsAuth(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => ({ count: 1, limit: 10, allowed: true, remaining: 9, resetAt: "2026-06-24T22:10:00.000Z", retryAfterSeconds: 600 }),
      query: async (text: string) => {
        if (text.includes("from bookings b join customers")) {
          return {
            rowCount: 1,
            rows: [{
              id: "booking-1", status: "BOOKED", start_date: "2026-12-23", end_date: "2026-12-25", pickup_location: "41 Upper Waterloo Rd",
              pricing_json: { total_cents: 153000, deposit_cents: 3400 }, customer_name: "Customer", customer_email: "customer@example.com",
              vehicle_make: "Toyota", vehicle_model: "Aqua", vehicle_year: 2020, daily_rate_cents: 76500, deposit_cents: 3400,
            }],
          };
        }
        if (text.includes("sum(deposit_amount_cents)")) return { rowCount: 1, rows: [{ amount: 153000 }] };
        throw new Error(`Unexpected query: ${text}`);
      },
      sendBookingCreated: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendDepositReceipt: async () => ({ ok: true, skipped: false, delivered: 1, errors: [] }),
      sendPaymentComplete: async (input) => {
        sentInput = input;
        return { ok: true, skipped: false, delivered: 1, errors: [], providerMessageId: "email-1" };
      },
      acquireDedupe: async () => undefined,
      finalizeDedupe: async () => undefined,
      makeDedupeKey: () => "dedupe-key",
      randomId: () => "uuid",
    },
  );

  assert.equal(response.status, 200);
  assert.equal(sentInput?.total, 153000);
  assert.equal(sentInput?.paidToDate, 153000);
  assert.equal(sentInput?.balanceDue, 0);
  assert.equal(sentInput?.paymentMethod, "Recorded payment");
});
