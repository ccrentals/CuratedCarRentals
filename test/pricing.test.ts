import test from "node:test";
import assert from "node:assert/strict";

import { computeBookingPricing } from "@/lib/payments/pricing";

test("computeBookingPricing: totals align with inclusive days * daily rate", () => {
  const summary = computeBookingPricing({
    bookingId: "b1",
    bookingStatus: "PENDING_PAYMENT",
    startDate: "2026-03-19",
    endDate: "2026-03-20",
    dailyRate: 9500,
    deposit: 3000,
    netPaidToDate: 0,
  });

  assert.equal(summary.days, 2);
  assert.equal(summary.total, 19000);
  assert.equal(summary.balanceDue, 19000);
  assert.equal(summary.paymentStatus, "UNPAID");
  assert.equal(summary.refundRequired, false);
});

test("computeBookingPricing: deposit paid drives DEPOSIT_PAID until balance reaches 0", () => {
  const summary = computeBookingPricing({
    bookingId: "b1",
    bookingStatus: "CONFIRMED",
    startDate: "2026-03-19",
    endDate: "2026-03-20",
    dailyRate: 9500,
    deposit: 3000,
    netPaidToDate: 3000,
  });

  assert.equal(summary.total, 19000);
  assert.equal(summary.netPaidToDate, 3000);
  assert.equal(summary.balanceDue, 16000);
  assert.equal(summary.paymentStatus, "DEPOSIT_PAID");
  assert.equal(summary.refundRequired, false);
});

test("computeBookingPricing: paid-in-full results in PAID_IN_FULL + zero balance", () => {
  const summary = computeBookingPricing({
    bookingId: "b1",
    bookingStatus: "CONFIRMED",
    startDate: "2026-03-19",
    endDate: "2026-03-20",
    dailyRate: 9500,
    deposit: 3000,
    netPaidToDate: 19000,
  });

  assert.equal(summary.balanceDue, 0);
  assert.equal(summary.paymentStatus, "PAID_IN_FULL");
  assert.equal(summary.refundRequired, false);
});

test("computeBookingPricing: refunds/overpayments trigger refundRequired", () => {
  const summary = computeBookingPricing({
    bookingId: "b1",
    bookingStatus: "CONFIRMED",
    startDate: "2026-03-19",
    endDate: "2026-03-20",
    dailyRate: 9500,
    deposit: 3000,
    netPaidToDate: 20000,
  });

  assert.equal(summary.total, 19000);
  assert.equal(summary.refundRequired, true);
});

test("computeBookingPricing: cancelled + any paid amount triggers refundRequired", () => {
  const summary = computeBookingPricing({
    bookingId: "b1",
    bookingStatus: "CANCELLED",
    startDate: "2026-03-19",
    endDate: "2026-03-20",
    dailyRate: 9500,
    deposit: 3000,
    netPaidToDate: 1,
  });

  assert.equal(summary.refundRequired, true);
});

