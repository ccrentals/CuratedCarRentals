import assert from "node:assert/strict";
import test from "node:test";

import type { getDbPool } from "@/lib/db";
import { reconcileWiPayPayment } from "@/lib/payments/wipayReconcile";
import { computeHash } from "@/lib/wipay";

test("reconcileWiPayPayment: payment email is deduped across replayed callbacks", async () => {
  const originalWipayApiKey = process.env.WIPAY_API_KEY;
  process.env.WIPAY_API_KEY = "test-wipay-key";

  const state = {
    sendCalls: 0,
    sentMarks: 0,
    failedMarks: 0,
    receiptMarkerUpdates: 0,
    dedupeKeys: new Set<string>(),
  };

  const input = {
    orderId: "order-dedupe-1",
    transactionId: "txn-dedupe-1",
    status: "SUCCESS",
    total: "10.00",
    hash: computeHash("txn-dedupe-1", "10.00", "test-wipay-key"),
    source: "webhook" as const,
  };

  const createDependencies = () => ({
    dbQuery: async <T = unknown>(text: string) => {
      if (text.startsWith("select id, booking_id, status, provider_transaction_id, metadata_json from payments")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "payment-dedupe-1",
              booking_id: "booking-dedupe-1",
              status: "INITIATED",
              provider_transaction_id: null,
              metadata_json: {
                total_decimal: "10.00",
                payment_type: "deposit",
                receipt_email_sent: false,
              },
            },
          ] as T[],
        };
      }

      if (
        text.startsWith(
          "update payments set metadata_json = jsonb_set(metadata_json, '{receipt_email_sent}', 'true'::jsonb, true)",
        )
      ) {
        state.receiptMarkerUpdates += 1;
        return { rowCount: 1, rows: [] as T[] };
      }

      throw new Error(`Unexpected dbQuery call: ${text}`);
    },
    getDbPool: (() => ({
      connect: async () => ({
        query: async (text: string) => {
          if (text === "begin") return { rowCount: 0, rows: [] };
          if (text === "commit") return { rowCount: 0, rows: [] };
          if (text === "rollback") return { rowCount: 0, rows: [] };

          if (text.startsWith("update payments set status = 'DEPOSIT_PAID'")) {
            return { rowCount: 1, rows: [] };
          }

          if (
            text.startsWith(
              "update payments set status = 'FAILED', metadata_json = jsonb_set(coalesce(metadata_json, '{}'::jsonb), '{superseded_by_payment_id}'",
            )
          ) {
            return { rowCount: 0, rows: [] };
          }

          if (text.startsWith("select b.id, b.start_date, b.end_date, b.status")) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: "booking-dedupe-1",
                  start_date: "2026-04-01",
                  end_date: "2026-04-03",
                  status: "CONFIRMED",
                  pickup_location: "Kingston",
                  pricing_json: {},
                  customer_name: "Dedupe Customer",
                  customer_email: "dedupe@example.com",
                  customer_phone: "+18765550000",
                  vehicle_make: "Toyota",
                  vehicle_model: "Yaris",
                  vehicle_year: 2025,
                  daily_rate_cents: 10000,
                  deposit_cents: 5000,
                },
              ],
            };
          }

          throw new Error(`Unexpected transaction query: ${text}`);
        },
        release: () => undefined,
      }),
    })) as ReturnType<typeof getDbPool>,
    writeAuditLog: async () => undefined,
    recalculateBookingPayments: async () => ({
      bookingId: "booking-dedupe-1",
      days: 2,
      dailyRate: 10000,
      subtotalAmount: 20000,
      promoCode: null,
      promoDiscount: 0,
      totalAmount: 20000,
      depositAmount: 5000,
      paymentOption: "DEPOSIT" as const,
      netPaidToDate: 5000,
      balanceDue: 15000,
      paymentStatus: "DEPOSIT_PAID" as const,
      refundRequired: false,
    }),
    readPromoPricingFields: () => ({ promoCode: null, promoDiscount: 0 }),
    maybeEntitleBookingAfterPayment: async () => ({
      bookingId: "booking-dedupe-1",
      state: "ENTITLED" as const,
      status: "CONFIRMED",
      paidToDate: 5000,
      depositRequired: 5000,
      winnerBookingId: "booking-dedupe-1",
      cancelledOverlaps: [],
    }),
    sendBookingOverriddenByPaidBookingEmail: async () => ({ ok: true }),
    sendDepositReceiptEmail: async () => {
      state.sendCalls += 1;
      return { ok: true };
    },
    sendPaymentCompleteEmail: async () => ({ ok: true }),
    getInternalNotesRecipient: () => "ops@example.com",
    tryAcquireDedupe: async ({ dedupeKey }: { dedupeKey: string }) => {
      if (state.dedupeKeys.has(dedupeKey)) return { ok: false, acquired: false };
      state.dedupeKeys.add(dedupeKey);
      return { ok: true, acquired: true };
    },
    markDedupeResult: async ({ status }: { status: string }) => {
      if (status === "SENT") {
        state.sentMarks += 1;
      } else if (status === "FAILED") {
        state.failedMarks += 1;
      }
    },
  });

  try {
    const first = await reconcileWiPayPayment(input, createDependencies());
    const second = await reconcileWiPayPayment({ ...input, source: "return" }, createDependencies());

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(state.sendCalls, 1);
    assert.equal(state.sentMarks, 1);
    assert.equal(state.failedMarks, 0);
    assert.equal(state.receiptMarkerUpdates, 2);
  } finally {
    if (originalWipayApiKey === undefined) {
      delete process.env.WIPAY_API_KEY;
    } else {
      process.env.WIPAY_API_KEY = originalWipayApiKey;
    }
  }
});
