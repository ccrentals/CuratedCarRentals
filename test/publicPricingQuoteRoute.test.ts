import assert from "node:assert/strict";
import test from "node:test";

import { buildQuotePaymentPreview } from "@/app/api/public/pricing/quote/route";

test("pricing quote preview: deposit shows deposit due now and remaining balance on pickup", () => {
  const preview = buildQuotePaymentPreview({
    amountDue: 30000,
    depositRequired: 7000,
    paymentOption: "DEPOSIT",
    customAmount: null,
  });

  assert.deepEqual(preview, {
    dueNow: 7000,
    dueOnPickup: 23000,
    reserveShortfall: 0,
    balanceDue: 23000,
  });
});

test("pricing quote preview: full payment clears pickup balance", () => {
  const preview = buildQuotePaymentPreview({
    amountDue: 30000,
    depositRequired: 7000,
    paymentOption: "FULL",
    customAmount: null,
  });

  assert.deepEqual(preview, {
    dueNow: 30000,
    dueOnPickup: 0,
    reserveShortfall: 0,
    balanceDue: 0,
  });
});

test("pricing quote preview: custom payment uses the requested amount and shows the remainder", () => {
  const preview = buildQuotePaymentPreview({
    amountDue: 30000,
    depositRequired: 7000,
    paymentOption: "CUSTOM",
    customAmount: 11000,
  });

  assert.deepEqual(preview, {
    dueNow: 11000,
    dueOnPickup: 19000,
    reserveShortfall: 0,
    balanceDue: 19000,
  });
});

test("pricing quote preview: custom payment below deposit keeps the shortfall visible", () => {
  const preview = buildQuotePaymentPreview({
    amountDue: 30000,
    depositRequired: 7000,
    paymentOption: "CUSTOM",
    customAmount: 5000,
  });

  assert.deepEqual(preview, {
    dueNow: 5000,
    dueOnPickup: 25000,
    reserveShortfall: 2000,
    balanceDue: 25000,
  });
});

test("pricing quote preview: invalid custom payment does not silently fall back to deposit math", () => {
  const preview = buildQuotePaymentPreview({
    amountDue: 30000,
    depositRequired: 7000,
    paymentOption: "CUSTOM",
    customAmount: 50000,
  });

  assert.deepEqual(preview, {
    dueNow: 0,
    dueOnPickup: 30000,
    reserveShortfall: 7000,
    balanceDue: 30000,
  });
});

test("pricing quote preview: no payment keeps the full balance due on pickup", () => {
  const preview = buildQuotePaymentPreview({
    amountDue: 30000,
    depositRequired: 7000,
    paymentOption: "NONE",
    customAmount: null,
  });

  assert.deepEqual(preview, {
    dueNow: 0,
    dueOnPickup: 30000,
    reserveShortfall: 7000,
    balanceDue: 30000,
  });
});
