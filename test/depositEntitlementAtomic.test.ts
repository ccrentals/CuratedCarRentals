import assert from "node:assert/strict";
import test from "node:test";

import { maybeEntitleBookingAfterPayment } from "@/lib/availability/entitlement";
import type { getDbPool } from "@/lib/db";
import type { Queryable } from "@/lib/payments/pricing";
import { reconcileWiPayPayment } from "@/lib/payments/wipayReconcile";
import { computeHash } from "@/lib/wipay";

type MockResponse = {
  rows: unknown[];
  rowCount: number;
};

function createMockDb(responses: MockResponse[]) {
  const queue = [...responses];
  const calls: Array<{ text: string; params: unknown[] | undefined }> = [];
  const db: Queryable = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      const next = queue.shift();
      if (!next) {
        throw new Error(`Unexpected query: ${text}`);
      }
      return next;
    },
  };
  return { db, calls };
}

test("maybeEntitleBookingAfterPayment: winner query uses deterministic entitlement ordering", async () => {
  const { db, calls } = createMockDb([
    {
      rows: [
        {
          id: "booking-current",
          status: "PENDING_PAYMENT",
          vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          start_date: "2026-04-01",
          end_date: "2026-04-03",
          start_at: "2026-04-01T10:00:00.000Z",
          end_at: "2026-04-03T10:00:00.000Z",
          pricing_json: {},
        },
      ],
      rowCount: 1,
    },
    { rows: [{}], rowCount: 1 },
    {
      rows: [
        {
          id: "booking-winner",
          status: "CONFIRMED",
          vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          start_date: "2026-04-01",
          end_date: "2026-04-03",
          start_at: "2026-04-01T10:00:00.000Z",
          end_at: "2026-04-03T10:00:00.000Z",
          amount_paid: 5000,
          deposit_required: 5000,
          entitlement_sort_at: "2026-03-01T09:00:00.000Z",
        },
      ],
      rowCount: 1,
    },
    {
      rows: [{ pricing_json: { payment_status: "DEPOSIT_PAID", amount_paid: 5000, deposit_cents: 5000 } }],
      rowCount: 1,
    },
    { rows: [], rowCount: 1 },
  ]);

  const resolution = await maybeEntitleBookingAfterPayment("booking-current", {
    client: db,
    recalculateBooking: async () => ({
      bookingId: "booking-current",
      days: 3,
      dailyRate: 12000,
      subtotalAmount: 36000,
      promoCode: null,
      promoDiscount: 0,
      totalAmount: 36000,
      depositAmount: 5000,
      paymentOption: "DEPOSIT",
      netPaidToDate: 5000,
      balanceDue: 31000,
      paymentStatus: "DEPOSIT_PAID",
      refundRequired: false,
    }),
  });

  assert.equal(resolution.state, "LOST");
  assert.equal(resolution.winnerBookingId, "booking-winner");

  const winnerQuery = calls.find((call) => call.text.includes("order by entitlement_sort_at asc"));
  assert.ok(winnerQuery, "expected winner query with deterministic ordering");
  assert.match(
    winnerQuery.text,
    /order by entitlement_sort_at asc, booking_created_at asc, b\.id asc limit 1/,
  );
});

test("reconcileWiPayPayment: replay paths dedupe loser emails", async () => {
  const originalWipayApiKey = process.env.WIPAY_API_KEY;
  process.env.WIPAY_API_KEY = "test-wipay-key";

  const state = {
    lostEmailMarked: false,
    overrideEmailCalls: 0,
    commits: 0,
  };

  const input = {
    orderId: "order-1",
    transactionId: "txn-1",
    status: "SUCCESS",
    total: "10.00",
    hash: computeHash("txn-1", "10.00", "test-wipay-key"),
    source: "webhook" as const,
  };

  const createDependencies = () => ({
    dbQuery: async <T = unknown>(text: string) => {
      if (text.startsWith("select id, booking_id, status, provider_transaction_id, metadata_json from payments")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "payment-1",
              booking_id: "booking-winner",
              status: "PENDING",
              provider_transaction_id: null,
              metadata_json: {
                total_decimal: "10.00",
                payment_type: "deposit",
                receipt_email_sent: true,
              },
            },
          ] as T[],
        };
      }

      if (text.startsWith("update bookings set pricing_json = jsonb_set")) {
        if (state.lostEmailMarked) {
          return { rowCount: 0, rows: [] as T[] };
        }
        state.lostEmailMarked = true;
        return { rowCount: 1, rows: [{ id: "booking-loser" }] as T[] };
      }

      if (text.startsWith("update payments set metadata_json")) {
        return { rowCount: 1, rows: [] as T[] };
      }

      throw new Error(`Unexpected dbQuery call: ${text}`);
    },
    getDbPool: (() => ({
      connect: async () => ({
        query: async (text: string) => {
          if (text === "begin") return { rowCount: 0, rows: [] };
          if (text === "commit") {
            state.commits += 1;
            return { rowCount: 0, rows: [] };
          }
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

          if (text.startsWith("select b.id, b.public_id, b.start_date, b.end_date, b.status")) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: "booking-winner",
                  public_id: "BK000001",
                  start_date: "2026-04-01",
                  end_date: "2026-04-03",
                  status: "CONFIRMED",
                  pickup_location: "Kingston",
                  pricing_json: {},
                  customer_name: "Winner Customer",
                  customer_email: "winner@example.com",
                  customer_phone: "+18765551234",
                  vehicle_make: "Toyota",
                  vehicle_model: "Yaris",
                  vehicle_year: 2024,
                  daily_rate_cents: 10000,
                  deposit_cents: 5000,
                },
              ],
            };
          }

          if (text.startsWith("update payments set metadata_json = jsonb_set")) {
            return { rowCount: 1, rows: [] };
          }

          throw new Error(`Unexpected transaction query: ${text}`);
        },
        release: () => undefined,
      }),
    })) as ReturnType<typeof getDbPool>,
    maybeEntitleBookingAfterPayment: async () => ({
      bookingId: "booking-winner",
      state: "ENTITLED" as const,
      status: "CONFIRMED",
      paidToDate: 5000,
      depositRequired: 5000,
      winnerBookingId: "booking-winner",
      cancelledOverlaps: [
        {
          id: "booking-loser",
          customerName: "Loser Customer",
          customerEmail: "loser@example.com",
          vehicleLabel: "Toyota Yaris",
          startDate: "2026-04-01",
          endDate: "2026-04-03",
          pickupLocation: "Kingston",
        },
      ],
    }),
    recalculateBookingPayments: async () => ({
      bookingId: "booking-winner",
      days: 3,
      dailyRate: 12000,
      subtotalAmount: 36000,
      promoCode: null,
      promoDiscount: 0,
      totalAmount: 36000,
      depositAmount: 5000,
      paymentOption: "DEPOSIT" as const,
      netPaidToDate: 5000,
      balanceDue: 31000,
      paymentStatus: "DEPOSIT_PAID" as const,
      refundRequired: false,
    }),
    writeAuditLog: async () => undefined,
    readPromoPricingFields: () => ({ promoCode: null, promoDiscount: 0 }),
    sendDepositReceiptEmail: async () => ({ ok: true }),
    sendPaymentCompleteEmail: async () => ({ ok: true }),
    sendBookingOverriddenByPaidBookingEmail: async () => {
      state.overrideEmailCalls += 1;
      return { ok: true };
    },
    getInternalNotesRecipient: () => "ops@example.com",
    tryAcquireDedupe: async () => ({ ok: true, acquired: true }),
    markDedupeResult: async () => undefined,
  });

  try {
    const first = await reconcileWiPayPayment(input, createDependencies());
    const second = await reconcileWiPayPayment({ ...input, source: "return" }, createDependencies());

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(state.overrideEmailCalls, 2, "expected customer+internal loser notifications exactly once");
    assert.equal(state.commits, 2);
  } finally {
    if (originalWipayApiKey === undefined) {
      delete process.env.WIPAY_API_KEY;
    } else {
      process.env.WIPAY_API_KEY = originalWipayApiKey;
    }
  }
});
