import assert from "node:assert/strict";
import test from "node:test";

import { classifyExistingPaymentAttempt } from "@/lib/payments/publicPaymentStart";

test("public payment start: reuses a recent initiated attempt with a hosted checkout URL", () => {
  const now = Date.parse("2026-03-14T12:00:00.000Z");
  const result = classifyExistingPaymentAttempt(
    {
      id: "payment-1",
      deposit_amount_cents: 5000,
      created_at: "2026-03-14T11:55:00.000Z",
      metadata_json: {
        hosted_page_url: "https://checkout.example.com/session-1",
      },
    },
    now,
  );

  assert.deepEqual(result, {
    type: "reuse",
    paymentId: "payment-1",
    redirectUrl: "https://checkout.example.com/session-1",
  });
});

test("public payment start: blocks duplicate starts while a fresh attempt is still pending", () => {
  const now = Date.parse("2026-03-14T12:00:00.000Z");
  const result = classifyExistingPaymentAttempt(
    {
      id: "payment-2",
      deposit_amount_cents: 5000,
      created_at: "2026-03-14T11:59:30.000Z",
      metadata_json: {},
    },
    now,
  );

  assert.deepEqual(result, {
    type: "pending",
    paymentId: "payment-2",
  });
});

test("public payment start: ignores stale initiated attempts so valid retries can proceed", () => {
  const now = Date.parse("2026-03-14T12:00:00.000Z");
  const result = classifyExistingPaymentAttempt(
    {
      id: "payment-3",
      deposit_amount_cents: 5000,
      created_at: "2026-03-14T10:00:00.000Z",
      metadata_json: {},
    },
    now,
  );

  assert.deepEqual(result, { type: "none" });
});
