import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQuotePaymentPreview,
  handlePublicPricingQuotePost,
} from "@/app/api/public/pricing/quote/implementation";

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

test("public pricing quote route: returns 429 when rate limited", async () => {
  const response = await handlePublicPricingQuotePost(
    new Request("http://localhost/api/public/pricing/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicleId: "11111111-1111-4111-8111-111111111111",
        startAt: "2026-06-01T11:00:00.000Z",
        endAt: "2026-06-03T11:00:00.000Z",
      }),
    }),
    {
      getClientIp: () => "203.0.113.9",
      consumeRateLimitCheck: async () => ({
        count: 61,
        limit: 60,
        allowed: false,
        remaining: 0,
        resetAt: "2026-06-01T11:01:00.000Z",
        retryAfterSeconds: 60,
      }),
      buildQuoteSnapshot: async () => {
        throw new Error("buildQuoteSnapshot should not run when rate limited");
      },
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");

  const body = (await response.json()) as { ok?: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.match(String(body.error), /too many requests/i);
});
