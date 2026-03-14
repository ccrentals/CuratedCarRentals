import test from "node:test";
import assert from "node:assert/strict";

import {
  computeBookingPricing,
  computeBookingPricingFromStoredSnapshot,
  isBlockingBookingHold,
  isNonBlockingBookingHold,
  normalizePaymentOption,
  parsePaymentOptionInput,
} from "@/lib/payments/pricing";

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
  assert.equal(summary.baseTotal, 19000);
  assert.equal(summary.insuranceTotal, 0);
  assert.equal(summary.total, 19000);
  assert.equal(summary.balanceDue, 19000);
  assert.equal(summary.paymentStatus, "UNPAID");
  assert.equal(summary.refundRequired, false);
});

test("computeBookingPricing: insurance is included in subtotal and total", () => {
  const summary = computeBookingPricing({
    bookingId: "b1",
    bookingStatus: "PENDING_PAYMENT",
    startDate: "2026-03-19",
    endDate: "2026-03-21",
    dailyRate: 10000,
    deposit: 4000,
    insuranceSelected: true,
    insurancePricePerDay: 1200,
    netPaidToDate: 0,
  });

  assert.equal(summary.days, 3);
  assert.equal(summary.baseTotal, 30000);
  assert.equal(summary.insuranceTotal, 3600);
  assert.equal(summary.subtotal, 33600);
  assert.equal(summary.total, 33600);
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

test("computeBookingPricing: no payment keeps booking unpaid with full balance due", () => {
  const summary = computeBookingPricing({
    bookingId: "b1",
    bookingStatus: "PENDING_PAYMENT",
    startDate: "2026-03-19",
    endDate: "2026-03-21",
    dailyRate: 10000,
    deposit: 4000,
    paymentOption: "NONE",
    netPaidToDate: 0,
  });

  assert.equal(summary.total, 30000);
  assert.equal(summary.netPaidToDate, 0);
  assert.equal(summary.balanceDue, 30000);
  assert.equal(summary.paymentOption, "NONE");
  assert.equal(summary.paymentStatus, "DUE_ON_PICKUP");
});

test("computeBookingPricing: promo discount is applied against subtotal including insurance", () => {
  const summary = computeBookingPricing({
    bookingId: "b1",
    bookingStatus: "PENDING_PAYMENT",
    startDate: "2026-03-19",
    endDate: "2026-03-21",
    dailyRate: 10000,
    deposit: 4000,
    insuranceSelected: true,
    insurancePricePerDay: 1500,
    promoCode: "SAVE10",
    promoDiscount: 4500,
    paymentOption: "DEPOSIT",
    netPaidToDate: 0,
  });

  assert.equal(summary.baseTotal, 30000);
  assert.equal(summary.insuranceTotal, 4500);
  assert.equal(summary.subtotal, 34500);
  assert.equal(summary.discountTotal, 4500);
  assert.equal(summary.total, 30000);
  assert.equal(summary.amountDue, 30000);
});

test("computeBookingPricing: explicit base total and extra fees are preserved", () => {
  const summary = computeBookingPricing({
    bookingId: "b1",
    bookingStatus: "PENDING_PAYMENT",
    startDate: "2026-03-19",
    endDate: "2026-03-21",
    dailyRate: 10000,
    deposit: 4000,
    baseTotal: 42000,
    extraFeesTotal: 5000,
    promoCode: "SAVE",
    promoDiscount: 7000,
    netPaidToDate: 0,
  });

  assert.equal(summary.days, 3);
  assert.equal(summary.baseTotal, 42000);
  assert.equal(summary.extraFeesTotal, 5000);
  assert.equal(summary.subtotal, 47000);
  assert.equal(summary.discountTotal, 7000);
  assert.equal(summary.total, 40000);
});

test("computeBookingPricingFromStoredSnapshot: stored pricing drives totals", () => {
  const summary = computeBookingPricingFromStoredSnapshot({
    bookingId: "b2",
    bookingStatus: "CONFIRMED",
    startDate: "2026-03-19",
    endDate: "2026-03-21",
    pricing: {
      daily_rate_cents: 14000,
      deposit_required_cents: 12000,
      base_total_cents: 42000,
      extra_fees_cents: 6000,
      insurance_selected: true,
      insurance_price_per_day_cents: 1500,
      insurance_total_cents: 4500,
      promo_code: "VIP",
      promo_discount_cents: 5000,
      payment_option_selected: "DEPOSIT",
    },
    fallbackDailyRate: 10000,
    fallbackDeposit: 4000,
    netPaidToDate: 12000,
  });

  assert.equal(summary.dailyRate, 14000);
  assert.equal(summary.baseTotal, 42000);
  assert.equal(summary.extraFeesTotal, 6000);
  assert.equal(summary.insuranceTotal, 4500);
  assert.equal(summary.subtotal, 52500);
  assert.equal(summary.discountTotal, 5000);
  assert.equal(summary.total, 47500);
  assert.equal(summary.deposit, 12000);
  assert.equal(summary.balanceDue, 35500);
});

test("payment options: CUSTOM/NONE are preserved and legacy pay-on-pickup maps to NONE", () => {
  assert.equal(parsePaymentOptionInput("CUSTOM"), "CUSTOM");
  assert.equal(parsePaymentOptionInput("NONE"), "NONE");
  assert.equal(parsePaymentOptionInput("pay_on_pickup"), "NONE");
  assert.equal(normalizePaymentOption("CUSTOM"), "CUSTOM");
  assert.equal(normalizePaymentOption("NONE"), "NONE");
  assert.equal(normalizePaymentOption("PAY_ON_PICKUP"), "NONE");
});

test("payment options: invalid values do not silently normalize", () => {
  assert.throws(() => normalizePaymentOption("LATER"), /Invalid payment option/i);
});

test("hold classification: bookings block only after hold minimum is met", () => {
  assert.equal(
    isNonBlockingBookingHold({
      paymentStatus: "UNPAID",
      amountPaid: 0,
      holdMinimumAmount: 3000,
    }),
    true,
  );
  assert.equal(
    isNonBlockingBookingHold({
      paymentStatus: "DUE_ON_PICKUP",
      amountPaid: 0,
      holdMinimumAmount: 3000,
    }),
    true,
  );
  assert.equal(
    isNonBlockingBookingHold({
      paymentStatus: "DEPOSIT_PAID",
      amountPaid: 1500,
      holdMinimumAmount: 3000,
    }),
    true,
  );
  assert.equal(
    isBlockingBookingHold({
      paymentStatus: "DEPOSIT_PAID",
      amountPaid: 3000,
      holdMinimumAmount: 3000,
    }),
    true,
  );
  assert.equal(
    isBlockingBookingHold({ paymentStatus: "UNPAID", amountPaid: 2500 }),
    true,
  );
});
