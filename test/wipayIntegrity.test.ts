import assert from "node:assert/strict";
import test from "node:test";

import { reconcileWiPayPayment } from "@/lib/payments/wipayReconcile";
import { buildCanonicalSiteUrl, computeHash, getCanonicalSiteUrl } from "@/lib/wipay";

test("reconcileWiPayPayment rejects invalid hash even in sandbox", async () => {
  const originalEnv = process.env.WIPAY_ENV;
  const originalApiKey = process.env.WIPAY_API_KEY;
  const originalSiteUrl = process.env.SITE_URL;
  process.env.WIPAY_ENV = "sandbox";
  process.env.WIPAY_API_KEY = "test-wipay-key";
  process.env.SITE_URL = "https://example.com";

  let updateCalled = false;

  try {
    const result = await reconcileWiPayPayment(
      {
        orderId: "order-bad-hash",
        transactionId: "txn-bad-hash",
        status: "SUCCESS",
        total: "10.00",
        hash: "invalid-hash",
        source: "webhook",
      },
      {
        dbQuery: async <T = unknown>(text: string) => {
          if (
            text.startsWith(
              "select id, booking_id, status, provider_transaction_id, metadata_json from payments",
            )
          ) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: "payment-bad-hash",
                  booking_id: "booking-bad-hash",
                  status: "INITIATED",
                  provider_transaction_id: null,
                  metadata_json: {
                    total_decimal: "10.00",
                    payment_type: "deposit",
                  },
                },
              ] as T[],
            };
          }

          updateCalled = true;
          throw new Error(`Unexpected dbQuery call: ${text}`);
        },
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "bad_hash");
    assert.equal(updateCalled, false);
  } finally {
    if (originalEnv === undefined) {
      delete process.env.WIPAY_ENV;
    } else {
      process.env.WIPAY_ENV = originalEnv;
    }
    if (originalApiKey === undefined) {
      delete process.env.WIPAY_API_KEY;
    } else {
      process.env.WIPAY_API_KEY = originalApiKey;
    }
    if (originalSiteUrl === undefined) {
      delete process.env.SITE_URL;
    } else {
      process.env.SITE_URL = originalSiteUrl;
    }
  }
});

test("reconcileWiPayPayment accepts successful callbacks when final returned total differs from original request total", async () => {
  const originalApiKey = process.env.WIPAY_API_KEY;
  process.env.WIPAY_API_KEY = "test-wipay-key";

  try {
    const result = await reconcileWiPayPayment(
      {
        orderId: "order-customer-pay",
        transactionId: "txn-customer-pay",
        status: "success",
        total: "12.05",
        currency: "JMD",
        hash: computeHash("txn-customer-pay", "10.00", "test-wipay-key"),
        source: "return",
      },
      {
        dbQuery: async <T = unknown>(text: string, params?: unknown[]) => {
          if (
            text.startsWith(
              "select id, booking_id, status, provider_transaction_id, metadata_json from payments",
            )
          ) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: "payment-customer-pay",
                  booking_id: "booking-customer-pay",
                  status: "DEPOSIT_PAID",
                  provider_transaction_id: "txn-customer-pay",
                  metadata_json: {
                    total_decimal: "10.00",
                    payment_type: "deposit",
                  },
                },
              ] as T[],
            };
          }

          throw new Error(`Unexpected dbQuery call: ${text} :: ${JSON.stringify(params ?? [])}`);
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.bookingId, "booking-customer-pay");
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.WIPAY_API_KEY;
    } else {
      process.env.WIPAY_API_KEY = originalApiKey;
    }
  }
});

test("reconcileWiPayPayment accepts localhost sandbox success callbacks when WiPay sandbox hash is inconsistent", async () => {
  const originalEnv = process.env.WIPAY_ENV;
  const originalApiKey = process.env.WIPAY_API_KEY;
  const originalSiteUrl = process.env.SITE_URL;
  process.env.WIPAY_ENV = "sandbox";
  process.env.WIPAY_API_KEY = "123";
  process.env.SITE_URL = "http://localhost:3000";

  let updatedMetadata: Record<string, unknown> | null = null;

  try {
    const result = await reconcileWiPayPayment(
      {
        orderId: "BK4sandboxcompat",
        transactionId: "SB-94-1-BK4sandboxcompat-20260324040138",
        status: "success",
        total: "1740",
        currency: "JMD",
        hash: "e8dd607dff579d166866ca3953f9f08c",
        message: "[1-R00]: Approved or completed successfully.",
        source: "return",
      },
      {
        dbQuery: async <T = unknown>(text: string, params?: unknown[]) => {
          if (
            text.startsWith(
              "select id, booking_id, status, provider_transaction_id, metadata_json from payments",
            )
          ) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: "payment-sandbox-compat",
                  booking_id: "booking-sandbox-compat",
                  status: "INITIATED",
                  provider_transaction_id: null,
                  metadata_json: {
                    total_decimal: "1740.00",
                    payment_type: "deposit",
                  },
                },
              ] as T[],
            };
          }

          if (text.startsWith("update payments set status = 'DEPOSIT_PAID'")) {
            updatedMetadata = (params?.[1] as Record<string, unknown>) ?? null;
            return { rowCount: 1, rows: [] as T[] };
          }

          if (text.includes("from bookings where id = $1")) {
            return {
              rowCount: 0,
              rows: [] as T[],
            };
          }

          if (text.startsWith("select id, booking_id from payments where provider_transaction_id = $1")) {
            return {
              rowCount: 0,
              rows: [] as T[],
            };
          }

          if (text.startsWith("select exists(")) {
            return {
              rowCount: 1,
              rows: [{ blocked: false }] as T[],
            };
          }

          if (text.startsWith("update payments set metadata_json = jsonb_set(metadata_json, '{receipt_email_sent}'")) {
            return { rowCount: 1, rows: [] as T[] };
          }

          throw new Error(`Unexpected dbQuery call: ${text} :: ${JSON.stringify(params ?? [])}`);
        },
        getDbPool: () =>
          ({
            connect: async () => ({
              query: async (text: string, params?: unknown[]) => {
                if (text.startsWith("begin") || text.startsWith("commit") || text.startsWith("rollback")) {
                  return { rows: [] };
                }

                if (text.startsWith("update payments set status = 'DEPOSIT_PAID'")) {
                  updatedMetadata = (params?.[1] as Record<string, unknown>) ?? null;
                  return { rows: [] };
                }

                if (text.startsWith("update payments set status = 'FAILED'")) {
                  return { rows: [] };
                }

                if (text.startsWith("update payments set metadata_json = jsonb_set")) {
                  return { rows: [] };
                }

                if (
                  text.startsWith(
                    "select b.id, b.public_id, b.start_date, b.end_date, b.status, b.pickup_location, b.pricing_json",
                  )
                ) {
                  return {
                    rowCount: 1,
                    rows: [
                      {
                        id: "booking-sandbox-compat",
                        public_id: "BK4sandboxcompat",
                        start_date: "2026-04-15",
                        end_date: "2026-04-17",
                        status: "CONFIRMED",
                        pickup_location: "166 old hope road",
                        pricing_json: {},
                        customer_name: "Sandbox Compat",
                        customer_email: "sandbox@example.com",
                        customer_phone: "8765551234",
                        vehicle_make: "Toyota",
                        vehicle_model: "Yaris",
                        vehicle_year: 2020,
                        daily_rate_cents: 0,
                        deposit_cents: 1740,
                      },
                    ],
                  };
                }

                throw new Error(`Unexpected client query: ${text} :: ${JSON.stringify(params ?? [])}`);
              },
              release: () => undefined,
            }),
          }) as never,
        maybeEntitleBookingAfterPayment: async () => ({
          state: "WON",
          cancelledOverlaps: [],
        }),
        recalculateBookingPayments: async () => ({
          netPaidToDate: 1740,
          balanceDue: 0,
        }),
        writeAuditLog: async () => undefined,
        sendDepositReceiptEmail: async () => ({ ok: true }),
        sendPaymentCompleteEmail: async () => ({ ok: true }),
        sendBookingOverriddenByPaidBookingEmail: async () => undefined,
        getInternalNotesRecipient: () => "ops@example.com",
        tryAcquireDedupe: async () => ({ acquired: true }),
        markDedupeResult: async () => undefined,
        readPromoPricingFields: () => ({
          promoCode: null,
          promoDiscount: 0,
        }),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.bookingId, "booking-sandbox-compat");
    assert.equal(
      (updatedMetadata?.wipay_last as Record<string, unknown> | undefined)?.hash_verified,
      false,
    );
    assert.equal(
      (updatedMetadata?.wipay_last as Record<string, unknown> | undefined)?.hash_compatibility_mode,
      "local_sandbox_success",
    );
  } finally {
    if (originalEnv === undefined) {
      delete process.env.WIPAY_ENV;
    } else {
      process.env.WIPAY_ENV = originalEnv;
    }
    if (originalApiKey === undefined) {
      delete process.env.WIPAY_API_KEY;
    } else {
      process.env.WIPAY_API_KEY = originalApiKey;
    }
    if (originalSiteUrl === undefined) {
      delete process.env.SITE_URL;
    } else {
      process.env.SITE_URL = originalSiteUrl;
    }
  }
});

test("reconcileWiPayPayment marks documented failed returns without hash as failed_status", async () => {
  let updateCalled = false;
  let updatedStatus = "";
  let updatedMetadata: Record<string, unknown> | null = null;

  const result = await reconcileWiPayPayment(
    {
      orderId: "order-failed-return",
      transactionId: "",
      status: "failed",
      message: "Transaction declined",
      total: "",
      hash: "",
      source: "return",
    },
    {
      dbQuery: async <T = unknown>(text: string, params?: unknown[]) => {
        if (
          text.startsWith(
            "select id, booking_id, status, provider_transaction_id, metadata_json from payments",
          )
        ) {
          return {
            rowCount: 1,
            rows: [
              {
                id: "payment-failed-return",
                booking_id: "booking-failed-return",
                status: "INITIATED",
                provider_transaction_id: null,
                metadata_json: {
                  total_decimal: "10.00",
                  payment_type: "deposit",
                },
              },
            ] as T[],
          };
        }

        if (text.startsWith("update payments set status = 'FAILED'")) {
          updateCalled = true;
          updatedStatus = "FAILED";
          updatedMetadata = (params?.[0] as Record<string, unknown>) ?? null;
          return { rowCount: 1, rows: [] as T[] };
        }

        throw new Error(`Unexpected dbQuery call: ${text}`);
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "failed_status");
  assert.equal(updateCalled, true);
  assert.equal(updatedStatus, "FAILED");
  assert.equal(
    (updatedMetadata?.wipay_last as Record<string, unknown> | undefined)?.hash_verified,
    false,
  );
});

test("reconcileWiPayPayment rejects transaction mismatch on already-paid rows", async () => {
  const originalApiKey = process.env.WIPAY_API_KEY;
  process.env.WIPAY_API_KEY = "test-wipay-key";

  try {
    const result = await reconcileWiPayPayment(
      {
        orderId: "order-paid",
        transactionId: "txn-forged",
        status: "SUCCESS",
        total: "10.00",
        hash: computeHash("txn-forged", "10.00", "test-wipay-key"),
        source: "return",
      },
      {
        dbQuery: async <T = unknown>(text: string) => {
          if (
            text.startsWith(
              "select id, booking_id, status, provider_transaction_id, metadata_json from payments",
            )
          ) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: "payment-paid",
                  booking_id: "booking-paid",
                  status: "DEPOSIT_PAID",
                  provider_transaction_id: "txn-real",
                  metadata_json: {
                    total_decimal: "10.00",
                    payment_type: "deposit",
                  },
                },
              ] as T[],
            };
          }

          throw new Error(`Unexpected dbQuery call: ${text}`);
        },
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "bad_hash");
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.WIPAY_API_KEY;
    } else {
      process.env.WIPAY_API_KEY = originalApiKey;
    }
  }
});

test("reconcileWiPayPayment accepts successful status alias when hash is valid", async () => {
  const originalApiKey = process.env.WIPAY_API_KEY;
  process.env.WIPAY_API_KEY = "test-wipay-key";

  let depositPaidUpdated = false;

  try {
    const result = await reconcileWiPayPayment(
      {
        orderId: "order-successful",
        transactionId: "txn-successful",
        status: "successful",
        total: "10.00",
        currency: "JMD",
        hash: computeHash("txn-successful", "10.00", "test-wipay-key"),
        source: "return",
      },
      {
        dbQuery: async <T = unknown>(text: string) => {
          if (
            text.startsWith(
              "select id, booking_id, status, provider_transaction_id, metadata_json from payments",
            )
          ) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: "payment-successful",
                  booking_id: "booking-successful",
                  status: "DEPOSIT_PAID",
                  provider_transaction_id: "txn-successful",
                  metadata_json: {
                    total_decimal: "10.00",
                    payment_type: "deposit",
                  },
                },
              ] as T[],
            };
          }

          depositPaidUpdated = true;
          throw new Error(`Unexpected dbQuery call: ${text}`);
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.bookingId, "booking-successful");
    assert.equal(depositPaidUpdated, false);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.WIPAY_API_KEY;
    } else {
      process.env.WIPAY_API_KEY = originalApiKey;
    }
  }
});

test("WiPay canonical site URL helpers require SITE_URL and build callback URLs from it", () => {
  const originalSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = "https://curatedcarrentals.com";

  try {
    assert.equal(getCanonicalSiteUrl().toString(), "https://curatedcarrentals.com/");
    assert.equal(
      buildCanonicalSiteUrl("/api/payments/wipay/return"),
      "https://curatedcarrentals.com/api/payments/wipay/return",
    );
  } finally {
    if (originalSiteUrl === undefined) {
      delete process.env.SITE_URL;
    } else {
      process.env.SITE_URL = originalSiteUrl;
    }
  }
});
