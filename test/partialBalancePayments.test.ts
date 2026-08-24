import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatPaymentStatus } from "../src/lib/payments/formatPaymentStatus";
import {
  classifyExistingPaymentAttempt,
  isBookingPayableStatus,
  paymentAttemptMatches,
  stripeCheckoutIdempotencyKey,
  validatePartialPaymentAmount,
} from "../src/lib/payments/publicPaymentStart";
import { nextInvoiceRetryState } from "../src/lib/payments/invoiceRetry";

test("partial payment validation enforces whole JMD and minimum", () => {
  assert.equal(validatePartialPaymentAmount(1_000, 5_000).ok, true);
  assert.deepEqual(validatePartialPaymentAmount(999, 5_000), {
    ok: false,
    code: "below_minimum",
    error: "Partial payments must be at least J$1,000.",
  });
  assert.equal(validatePartialPaymentAmount(1_000.5, 5_000).code, "invalid_amount");
});

test("partial payment validation uses the latest balance and reserves full remainder mode", () => {
  assert.equal(validatePartialPaymentAmount(5_001, 5_000).code, "stale_balance");
  assert.equal(validatePartialPaymentAmount(5_000, 5_000).code, "pay_full_balance");
  assert.equal(validatePartialPaymentAmount(500, 500).code, "pay_full_balance");
  assert.equal(validatePartialPaymentAmount(1_000, 0).code, "already_paid");
});

test("active Stripe Checkout attempts are reused only when amount and type match", () => {
  const createdAt = new Date().toISOString();
  const attempt = {
    id: "payment-1",
    deposit_amount_cents: 1_000,
    created_at: createdAt,
    provider_ref: "cs_test_1",
    metadata_json: { payment_type: "partial_balance", hosted_page_url: "https://checkout.stripe.test/1" },
  };
  assert.equal(paymentAttemptMatches(attempt, "partial_balance", 1_000), true);
  assert.equal(paymentAttemptMatches(attempt, "partial_balance", 2_000), false);
  assert.equal(paymentAttemptMatches(attempt, "balance", 1_000), false);
  assert.equal(classifyExistingPaymentAttempt(attempt).type, "reuse");
});

test("Stripe Checkout idempotency keys are deterministic per payment", () => {
  assert.equal(stripeCheckoutIdempotencyKey("payment-1"), "ccr_checkout_payment-1");
  assert.equal(stripeCheckoutIdempotencyKey("payment-1"), stripeCheckoutIdempotencyKey("payment-1"));
  assert.notEqual(stripeCheckoutIdempotencyKey("payment-1"), stripeCheckoutIdempotencyKey("payment-2"));
});

test("partial payments retain status compatibility while displaying clearly", () => {
  assert.equal(
    formatPaymentStatus("DEPOSIT_PAID", { paymentType: "partial_balance" }),
    "Partial Payment Received",
  );
});

test("cancelled and returned bookings cannot be paid", () => {
  assert.equal(isBookingPayableStatus("CONFIRMED"), true);
  assert.equal(isBookingPayableStatus("PICKED_UP"), true);
  assert.equal(isBookingPayableStatus("cancelled"), false);
  assert.equal(isBookingPayableStatus("RETURNED"), false);
});

test("invoice retries advance through the approved schedule and exhaust after five attempts", () => {
  const now = Date.parse("2026-08-23T12:00:00.000Z");
  assert.equal(nextInvoiceRetryState(0, now).nextRetryAt, "2026-08-23T13:00:00.000Z");
  assert.equal(nextInvoiceRetryState(3, now).nextRetryAt, "2026-08-24T12:00:00.000Z");
  assert.deepEqual(nextInvoiceRetryState(4, now), { nextCount: 5, exhausted: true, nextRetryAt: null });
});

test("partial mode does not mutate the booking payment option", () => {
  const source = readFileSync("src/lib/payments/publicPaymentStart.ts", "utf8");
  assert.match(source, /if \(mode === "deposit" \|\| mode === "full" \|\| mode === "custom"\)/);
  assert.doesNotMatch(source, /if \(mode === "deposit" \|\| mode === "full" \|\| mode === "custom" \|\| mode === "partial"\)/);
});
