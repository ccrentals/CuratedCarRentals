import assert from "node:assert/strict";
import test from "node:test";

import {
  computeRemainingRedemptions,
  deriveReconstructedPromoLedgerState,
  derivePromoAdminState,
  syncPromoRedemptionStateForBooking,
  validatePromoForBooking,
} from "@/lib/promos";
import type { Queryable } from "@/lib/payments/pricing";

type PromoCodeFixture = {
  id: string;
  code: string;
  is_active: boolean;
  discount_type: "PERCENT" | "FIXED";
  apply_scope: "OVERALL_TOTAL" | "DAYS_TOTAL";
  discount_value: number;
  min_subtotal_cents: number | null;
  max_redemptions: number | null;
  max_redemptions_per_customer: number | null;
  start_at: string | null;
  end_at: string | null;
  allowed_vehicle_ids_json: string[];
  excluded_vehicle_ids_json: string[];
  blackout_dates_json: string[];
};

type CurrentRedemption = {
  id: string;
  promo_code_id: string;
  booking_id: string;
  customer_id: string | null;
  customer_email: string | null;
  discount_amount_cents: number;
};

type EventRow = {
  promo_code_id: string;
  booking_id: string;
  customer_id: string | null;
  customer_email: string | null;
  discount_amount_cents: number;
  event_type: "REDEEMED" | "REVERSED";
};

class PromoSyncDb implements Queryable {
  booking = {
    id: "booking-1",
    status: "PENDING_PAYMENT",
    customer_id: "customer-1",
    customer_email: "promo@example.com",
    pricing_json: {
      promo_code_id: "promo-1",
      promo_code: "SAVE5",
      promo_discount_cents: 5000,
    } as Record<string, unknown>,
  };

  promoCodes: PromoCodeFixture[] = [
    {
      id: "promo-1",
      code: "SAVE5",
      is_active: true,
      discount_type: "FIXED",
      apply_scope: "OVERALL_TOTAL",
      discount_value: 5000,
      min_subtotal_cents: null,
      max_redemptions: null,
      max_redemptions_per_customer: null,
      start_at: null,
      end_at: null,
      allowed_vehicle_ids_json: [],
      excluded_vehicle_ids_json: [],
      blackout_dates_json: [],
    },
  ];

  paymentsSum = 0;
  currentRedemptions: CurrentRedemption[] = [];
  events: EventRow[] = [];

  async query(text: string, params: unknown[] = []) {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();

    if (normalized.includes("select b.id, b.status, b.customer_id, c.email as customer_email, b.pricing_json from bookings")) {
      return {
        rowCount: 1,
        rows: [
          {
            id: this.booking.id,
            status: this.booking.status,
            customer_id: this.booking.customer_id,
            customer_email: this.booking.customer_email,
            pricing_json: this.booking.pricing_json,
          },
        ],
      };
    }

    if (normalized === "select id from promo_codes where id = $1 limit 1") {
      const promo = this.promoCodes.find((row) => row.id === params[0]);
      return { rowCount: promo ? 1 : 0, rows: promo ? [{ id: promo.id }] : [] };
    }

    if (normalized === "select id from promo_codes where lower(code) = lower($1) limit 1") {
      const code = String(params[0] ?? "").trim().toLowerCase();
      const promo = this.promoCodes.find((row) => row.code.toLowerCase() === code);
      return { rowCount: promo ? 1 : 0, rows: promo ? [{ id: promo.id }] : [] };
    }

    if (
      normalized.includes(
        "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and deleted_at is null",
      )
    ) {
      return { rowCount: 1, rows: [{ amount: this.paymentsSum }] };
    }

    if (
      normalized ===
      "select id, promo_code_id, booking_id, customer_id, customer_email, discount_amount_cents from promo_redemptions where booking_id = $1"
    ) {
      return {
        rowCount: this.currentRedemptions.length,
        rows: this.currentRedemptions.map((row) => ({ ...row })),
      };
    }

    if (
      normalized ===
      "insert into promo_redemptions (promo_code_id, booking_id, customer_id, customer_email, discount_amount_cents) values ($1, $2, $3, $4, $5)"
    ) {
      this.currentRedemptions.push({
        id: `current-${this.currentRedemptions.length + 1}`,
        promo_code_id: String(params[0]),
        booking_id: String(params[1]),
        customer_id: typeof params[2] === "string" ? params[2] : null,
        customer_email: typeof params[3] === "string" ? params[3] : null,
        discount_amount_cents: Number(params[4] ?? 0),
      });
      return { rowCount: 1, rows: [] };
    }

    if (normalized.startsWith("insert into promo_redemption_events")) {
      this.events.push({
        promo_code_id: String(params[0]),
        booking_id: String(params[1]),
        customer_id: typeof params[2] === "string" ? params[2] : null,
        customer_email: typeof params[3] === "string" ? params[3] : null,
        discount_amount_cents: Number(params[4] ?? 0),
        event_type: params[5] as EventRow["event_type"],
      });
      return { rowCount: 1, rows: [] };
    }

    if (normalized === "delete from promo_redemptions where id = $1") {
      this.currentRedemptions = this.currentRedemptions.filter((row) => row.id !== params[0]);
      return { rowCount: 1, rows: [] };
    }

    if (
      normalized.startsWith(
        "select id, code, is_active, discount_type, apply_scope, discount_value, min_subtotal_cents, max_redemptions",
      )
    ) {
      const code = String(params[0] ?? "").trim().toLowerCase();
      const promo = this.promoCodes.find((row) => row.code.toLowerCase() === code);
      return { rowCount: promo ? 1 : 0, rows: promo ? [{ ...promo }] : [] };
    }

    if (normalized === "select count(*)::int as count from promo_redemptions where promo_code_id = $1") {
      const count = this.currentRedemptions.filter((row) => row.promo_code_id === params[0]).length;
      return { rowCount: 1, rows: [{ count }] };
    }

    if (
      normalized === "select count(*)::int as count from promo_redemptions where promo_code_id = $1 and customer_id = $2"
    ) {
      const count = this.currentRedemptions.filter(
        (row) => row.promo_code_id === params[0] && row.customer_id === params[1],
      ).length;
      return { rowCount: 1, rows: [{ count }] };
    }

    if (
      normalized ===
      "select count(*)::int as count from promo_redemptions where promo_code_id = $1 and lower(customer_email) = lower($2)"
    ) {
      const email = String(params[1] ?? "").toLowerCase();
      const count = this.currentRedemptions.filter(
        (row) => row.promo_code_id === params[0] && String(row.customer_email ?? "").toLowerCase() === email,
      ).length;
      return { rowCount: 1, rows: [{ count }] };
    }

    throw new Error(`Unexpected query: ${text}`);
  }
}

test("derivePromoAdminState applies precedence for expired, inactive, scheduled, limit reached, and active", () => {
  assert.equal(
    derivePromoAdminState({
      isActive: true,
      startAt: "2026-03-10T00:00:00.000Z",
      endAt: "2026-03-20T00:00:00.000Z",
      maxRedemptions: 5,
      currentRedemptionCount: 5,
      now: new Date("2026-03-21T00:00:00.000Z"),
    }),
    "EXPIRED",
  );
  assert.equal(
    derivePromoAdminState({
      isActive: false,
      startAt: "2026-03-30T00:00:00.000Z",
      endAt: null,
      maxRedemptions: 1,
      currentRedemptionCount: 1,
      now: new Date("2026-03-22T00:00:00.000Z"),
    }),
    "INACTIVE",
  );
  assert.equal(
    derivePromoAdminState({
      isActive: true,
      startAt: "2026-03-30T00:00:00.000Z",
      endAt: null,
      maxRedemptions: 3,
      currentRedemptionCount: 3,
      now: new Date("2026-03-22T00:00:00.000Z"),
    }),
    "SCHEDULED",
  );
  assert.equal(
    derivePromoAdminState({
      isActive: true,
      startAt: null,
      endAt: null,
      maxRedemptions: 3,
      currentRedemptionCount: 3,
      now: new Date("2026-03-22T00:00:00.000Z"),
    }),
    "LIMIT_REACHED",
  );
  assert.equal(
    derivePromoAdminState({
      isActive: true,
      startAt: null,
      endAt: null,
      maxRedemptions: 3,
      currentRedemptionCount: 1,
      now: new Date("2026-03-22T00:00:00.000Z"),
    }),
    "ACTIVE",
  );
});

test("computeRemainingRedemptions clamps values and preserves unlimited promos", () => {
  assert.equal(computeRemainingRedemptions(null, 9), null);
  assert.equal(computeRemainingRedemptions(5, 2), 3);
  assert.equal(computeRemainingRedemptions(5, 9), 0);
});

test("deriveReconstructedPromoLedgerState builds redeemed and reversed history for a cancelled booking", () => {
  const result = deriveReconstructedPromoLedgerState({
    promoCodeId: "promo-1",
    bookingId: "booking-1",
    bookingStatus: "CANCELLED",
    customerId: "customer-1",
    customerEmail: "promo@example.com",
    discountAmountCents: 5000,
    netPaidToDate: 0,
    redeemedAt: "2026-03-20T10:00:00.000Z",
    refundedAt: null,
    cancelledAt: "2026-03-21T12:00:00.000Z",
    updatedAt: "2026-03-21T12:05:00.000Z",
  });

  assert.equal(result.events.length, 2);
  assert.equal(result.events[0]?.eventType, "REDEEMED");
  assert.equal(result.events[0]?.metadata.timestampSource, "payment");
  assert.equal(result.events[1]?.eventType, "REVERSED");
  assert.equal(result.events[1]?.metadata.timestampSource, "cancel_audit");
  assert.equal(result.currentRedemption, null);
});

test("deriveReconstructedPromoLedgerState keeps a partially refunded booking counted when net paid remains positive", () => {
  const result = deriveReconstructedPromoLedgerState({
    promoCodeId: "promo-1",
    bookingId: "booking-1",
    bookingStatus: "CONFIRMED",
    customerId: "customer-1",
    customerEmail: "promo@example.com",
    discountAmountCents: 5000,
    netPaidToDate: 2500,
    redeemedAt: "2026-03-20T10:00:00.000Z",
    refundedAt: "2026-03-21T12:00:00.000Z",
    cancelledAt: null,
    updatedAt: "2026-03-21T12:05:00.000Z",
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.eventType, "REDEEMED");
  assert.ok(result.currentRedemption);
  assert.equal(result.currentRedemption?.promoCodeId, "promo-1");
});

test("syncPromoRedemptionStateForBooking does not count unpaid promo applications", async () => {
  const db = new PromoSyncDb();

  await syncPromoRedemptionStateForBooking(db.booking.id, { client: db, source: "test_unpaid" });

  assert.equal(db.currentRedemptions.length, 0);
  assert.equal(db.events.length, 0);
});

test("syncPromoRedemptionStateForBooking counts the first paid state and is idempotent", async () => {
  const db = new PromoSyncDb();
  db.paymentsSum = 5000;

  await syncPromoRedemptionStateForBooking(db.booking.id, { client: db, source: "test_paid" });
  await syncPromoRedemptionStateForBooking(db.booking.id, { client: db, source: "test_paid_repeat" });

  assert.equal(db.currentRedemptions.length, 1);
  assert.equal(db.events.length, 1);
  assert.equal(db.events[0]?.event_type, "REDEEMED");
  assert.equal(db.currentRedemptions[0]?.discount_amount_cents, 5000);
});

test("syncPromoRedemptionStateForBooking reverses a counted promo when the promo is removed", async () => {
  const db = new PromoSyncDb();
  db.paymentsSum = 5000;

  await syncPromoRedemptionStateForBooking(db.booking.id, { client: db, source: "test_apply" });
  db.booking.pricing_json = {
    promo_code: null,
    promo_code_id: null,
    promo_discount_cents: 0,
  };
  await syncPromoRedemptionStateForBooking(db.booking.id, { client: db, source: "test_remove" });

  assert.equal(db.currentRedemptions.length, 0);
  assert.equal(db.events.length, 2);
  assert.equal(db.events[1]?.event_type, "REVERSED");
});

test("syncPromoRedemptionStateForBooking releases promo capacity when a counted booking is cancelled", async () => {
  const db = new PromoSyncDb();
  db.paymentsSum = 5000;

  await syncPromoRedemptionStateForBooking(db.booking.id, { client: db, source: "test_apply" });
  db.booking.status = "CANCELLED";
  await syncPromoRedemptionStateForBooking(db.booking.id, { client: db, source: "test_cancel" });

  assert.equal(db.currentRedemptions.length, 0);
  assert.equal(db.events.length, 2);
  assert.equal(db.events[1]?.event_type, "REVERSED");
});

test("validatePromoForBooking enforces max redemptions from current paid rows only", async () => {
  const db = new PromoSyncDb();
  db.promoCodes[0].max_redemptions = 1;
  db.currentRedemptions.push({
    id: "current-1",
    promo_code_id: "promo-1",
    booking_id: "booking-2",
    customer_id: "customer-2",
    customer_email: "other@example.com",
    discount_amount_cents: 5000,
  });

  const result = await validatePromoForBooking({
    code: "SAVE5",
    vehicleId: "vehicle-1",
    startDate: "2026-04-10",
    endDate: "2026-04-12",
    subtotalCents: 30000,
    baseTotalCents: 30000,
    customerId: "customer-3",
    customerEmail: "third@example.com",
    client: db,
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    assert.fail("Expected max redemptions failure");
  }
  assert.equal(result.reason, "max_redemptions");
});

test("validatePromoForBooking enforces per-customer limits from current paid rows only", async () => {
  const db = new PromoSyncDb();
  db.promoCodes[0].max_redemptions_per_customer = 1;
  db.currentRedemptions.push({
    id: "current-1",
    promo_code_id: "promo-1",
    booking_id: "booking-2",
    customer_id: "customer-1",
    customer_email: "promo@example.com",
    discount_amount_cents: 5000,
  });

  const result = await validatePromoForBooking({
    code: "SAVE5",
    vehicleId: "vehicle-1",
    startDate: "2026-04-10",
    endDate: "2026-04-12",
    subtotalCents: 30000,
    baseTotalCents: 30000,
    customerId: "customer-1",
    customerEmail: "promo@example.com",
    client: db,
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    assert.fail("Expected max per customer failure");
  }
  assert.equal(result.reason, "max_per_customer");
});
