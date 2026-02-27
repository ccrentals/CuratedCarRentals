import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminPaymentsReplayPost } from "@/app/api/admin/payments/replay/route";

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: Date.now() + 60_000,
    issuedAt: Date.now(),
  };
}

function buildRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/payments/replay", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": "token",
    },
    body: JSON.stringify({ csrfToken: "token", ...body }),
  });
}

function paymentFixture(overrides: Partial<{
  id: string;
  bookingId: string;
  providerRef: string | null;
  providerTransactionId: string | null;
  status: string;
  metadataJson: Record<string, unknown> | null;
}> = {}) {
  return {
    id: "f6e08be6-66ff-4be8-a291-43906d0fd67c",
    bookingId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    providerRef: "order-123",
    providerTransactionId: "txn-123",
    status: "DEPOSIT_PAID",
    metadataJson: {
      total_decimal: "1000.00",
      wipay_last: {
        status: "SUCCESS",
        total: "1000.00",
        currency: "JMD",
        hash: "abc123",
        transaction_id: "txn-123",
      },
    },
    ...overrides,
  };
}

function createDeps(overrides: Partial<Parameters<typeof handleAdminPaymentsReplayPost>[1]> = {}) {
  return {
    getSession: async () => adminSession(),
    requireCsrfCheck: async () => true,
    findLatestPaymentByOrderId: async () => null,
    findLatestPaymentByTransactionId: async () => null,
    findLatestPaymentByBookingId: async () => null,
    reconcilePayment: async () => ({ ok: true as const, bookingId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b" }),
    writeAudit: async () => undefined,
    ...overrides,
  };
}

test("admin payments replay API: missing lookup inputs returns INVALID_INPUT", async () => {
  const response = await handleAdminPaymentsReplayPost(
    buildRequest({}),
    createDeps(),
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as { ok: boolean; code?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "INVALID_INPUT");
});

test("admin payments replay API: invalid bookingId format returns INVALID_INPUT", async () => {
  const response = await handleAdminPaymentsReplayPost(
    buildRequest({ bookingId: "not-a-uuid" }),
    createDeps(),
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as { ok: boolean; code?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "INVALID_INPUT");
});

test("admin payments replay API: orderId lookup resolves payment and replays reconciliation", async () => {
  let reconcileOrderId = "";
  let reconcileSource = "";

  const payment = paymentFixture();
  const response = await handleAdminPaymentsReplayPost(
    buildRequest({ orderId: "order-123", source: "admin_replay" }),
    createDeps({
      findLatestPaymentByOrderId: async () => payment,
      reconcilePayment: async (input) => {
        reconcileOrderId = input.orderId;
        reconcileSource = input.source;
        return { ok: true, bookingId: payment.bookingId };
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    bookingId?: string;
    paymentId?: string;
    outcome?: { ok: boolean };
  };
  assert.equal(body.ok, true);
  assert.equal(body.bookingId, payment.bookingId);
  assert.equal(body.paymentId, payment.id);
  assert.equal(body.outcome?.ok, true);
  assert.equal(reconcileOrderId, "order-123");
  assert.equal(reconcileSource, "webhook");
});

test("admin payments replay API: bookingId lookup resolves payment and replays reconciliation", async () => {
  const bookingId = "123e4567-e89b-42d3-a456-426614174000";
  const payment = paymentFixture({ bookingId, providerRef: "order-booking-lookup" });
  let lookupCalled = false;

  const response = await handleAdminPaymentsReplayPost(
    buildRequest({ bookingId }),
    createDeps({
      findLatestPaymentByBookingId: async (id) => {
        lookupCalled = id === bookingId;
        return payment;
      },
      reconcilePayment: async () => ({ ok: true, bookingId }),
    }),
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; bookingId?: string };
  assert.equal(body.ok, true);
  assert.equal(body.bookingId, bookingId);
  assert.equal(lookupCalled, true);
});

test("admin payments replay API: missing payment returns PAYMENT_NOT_FOUND", async () => {
  const response = await handleAdminPaymentsReplayPost(
    buildRequest({ orderId: "unknown-order" }),
    createDeps({
      findLatestPaymentByOrderId: async () => null,
    }),
  );

  assert.equal(response.status, 404);
  const body = (await response.json()) as { ok: boolean; code?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "PAYMENT_NOT_FOUND");
});

test("admin payments replay API: missing provider context in non-sandbox returns MISSING_PROVIDER_CONTEXT", async () => {
  const previousEnv = process.env.WIPAY_ENV;
  process.env.WIPAY_ENV = "live";

  try {
    const response = await handleAdminPaymentsReplayPost(
      buildRequest({ orderId: "order-ctx-missing", status: "SUCCESS" }),
      createDeps({
        findLatestPaymentByOrderId: async () =>
          paymentFixture({
            providerRef: "order-ctx-missing",
            providerTransactionId: null,
            status: "INITIATED",
            metadataJson: {},
          }),
      }),
    );

    assert.equal(response.status, 409);
    const body = (await response.json()) as {
      ok: boolean;
      code?: string;
      details?: { missingContext?: string[] };
    };
    assert.equal(body.ok, false);
    assert.equal(body.code, "MISSING_PROVIDER_CONTEXT");
    assert.equal(Array.isArray(body.details?.missingContext), true);
    assert.equal(body.details?.missingContext?.includes("hash"), true);
  } finally {
    if (previousEnv === undefined) {
      delete process.env.WIPAY_ENV;
    } else {
      process.env.WIPAY_ENV = previousEnv;
    }
  }
});

test("admin payments replay API: repeated replay calls remain idempotent", async () => {
  const payment = paymentFixture({ providerRef: "order-idempotent" });
  let reconcileCalls = 0;

  const deps = createDeps({
    findLatestPaymentByOrderId: async () => payment,
    reconcilePayment: async () => {
      reconcileCalls += 1;
      return { ok: true, bookingId: payment.bookingId };
    },
  });

  const first = await handleAdminPaymentsReplayPost(
    buildRequest({ orderId: "order-idempotent" }),
    deps,
  );
  const second = await handleAdminPaymentsReplayPost(
    buildRequest({ orderId: "order-idempotent" }),
    deps,
  );

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(reconcileCalls, 2);
});
