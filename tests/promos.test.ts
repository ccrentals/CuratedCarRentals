import test from "node:test";
import assert from "node:assert/strict";

import { upsertPromoRedemption, validatePromoForBooking } from "../src/lib/promos";
import { computeBookingPricing } from "../src/lib/payments/pricing";

type QueryResult = { rows: unknown[]; rowCount: number };

type StubPromoRow = {
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

type RedemptionRow = {
  promo_code_id: string;
  booking_id: string;
  customer_id: string | null;
  customer_email: string | null;
  discount_amount_cents: number;
};

class PromoDbStub {
  private promo: StubPromoRow | null;
  public redemptions: RedemptionRow[] = [];

  constructor(promo: StubPromoRow | null) {
    this.promo = promo;
  }

  async query(text: string, params: unknown[] = []): Promise<QueryResult> {
    const sql = text.toLowerCase().replace(/\s+/g, " ").trim();

    if (sql.includes("from promo_codes where lower(code) = lower($1) limit 1")) {
      if (!this.promo) return { rows: [], rowCount: 0 };
      return { rows: [this.promo], rowCount: 1 };
    }

    if (
      sql.includes("count(*)::int as count from promo_redemptions where promo_code_id = $1 and customer_id = $2")
    ) {
      const promoId = String(params[0] ?? "");
      const customerId = String(params[1] ?? "");
      const count = this.redemptions.filter(
        (row) => row.promo_code_id === promoId && row.customer_id === customerId,
      ).length;
      return { rows: [{ count }], rowCount: 1 };
    }

    if (
      sql.includes(
        "count(*)::int as count from promo_redemptions where promo_code_id = $1 and lower(customer_email) = lower($2)",
      )
    ) {
      const promoId = String(params[0] ?? "");
      const email = String(params[1] ?? "").toLowerCase();
      const count = this.redemptions.filter(
        (row) => row.promo_code_id === promoId && String(row.customer_email ?? "").toLowerCase() === email,
      ).length;
      return { rows: [{ count }], rowCount: 1 };
    }

    if (sql.includes("count(*)::int as count from promo_redemptions where promo_code_id = $1")) {
      const promoId = String(params[0] ?? "");
      const count = this.redemptions.filter((row) => row.promo_code_id === promoId).length;
      return { rows: [{ count }], rowCount: 1 };
    }

    if (sql.startsWith("delete from promo_redemptions where booking_id = $1 and promo_code_id <> $2")) {
      const bookingId = String(params[0] ?? "");
      const promoId = String(params[1] ?? "");
      this.redemptions = this.redemptions.filter(
        (row) => !(row.booking_id === bookingId && row.promo_code_id !== promoId),
      );
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("insert into promo_redemptions")) {
      const promoId = String(params[0] ?? "");
      const bookingId = String(params[1] ?? "");
      const customerId = params[2] ? String(params[2]) : null;
      const customerEmail = params[3] ? String(params[3]) : null;
      const discountAmountCents = Number(params[4] ?? 0);

      const existingIndex = this.redemptions.findIndex(
        (row) => row.promo_code_id === promoId && row.booking_id === bookingId,
      );
      if (existingIndex >= 0) {
        this.redemptions[existingIndex] = {
          promo_code_id: promoId,
          booking_id: bookingId,
          customer_id: customerId,
          customer_email: customerEmail,
          discount_amount_cents: discountAmountCents,
        };
      } else {
        this.redemptions.push({
          promo_code_id: promoId,
          booking_id: bookingId,
          customer_id: customerId,
          customer_email: customerEmail,
          discount_amount_cents: discountAmountCents,
        });
      }
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled test query: ${text}`);
  }
}

function buildBasePromo(overrides: Partial<StubPromoRow> = {}): StubPromoRow {
  return {
    id: "promo-1",
    code: "SAVE10",
    is_active: true,
    discount_type: "PERCENT",
    apply_scope: "OVERALL_TOTAL",
    discount_value: 10,
    min_subtotal_cents: null,
    max_redemptions: null,
    max_redemptions_per_customer: null,
    start_at: "2026-01-01T00:00:00.000Z",
    end_at: "2026-12-31T23:59:59.999Z",
    allowed_vehicle_ids_json: [],
    excluded_vehicle_ids_json: [],
    blackout_dates_json: [],
    ...overrides,
  };
}

test("validatePromoForBooking applies percent discount for valid promo", async () => {
  const db = new PromoDbStub(buildBasePromo());

  const result = await validatePromoForBooking({
    code: " save10 ",
    vehicleId: "vehicle-1",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    subtotalCents: 20000,
    baseTotalCents: 20000,
    customerEmail: "customer@example.com",
    now: new Date("2026-06-01T12:00:00.000Z"),
    client: db,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.code, "SAVE10");
  assert.equal(result.discountType, "PERCENT");
  assert.equal(result.discountAmountCents, 2000);
  assert.equal(result.totalAfterDiscountCents, 18000);
});

test("validatePromoForBooking rejects outside date window and blackout/vehicle mismatches", async () => {
  const outsideWindowDb = new PromoDbStub(
    buildBasePromo({
      start_at: "2026-07-01T00:00:00.000Z",
      end_at: "2026-07-31T23:59:59.999Z",
    }),
  );

  const outsideWindow = await validatePromoForBooking({
    code: "SAVE10",
    vehicleId: "vehicle-1",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    subtotalCents: 20000,
    baseTotalCents: 20000,
    now: new Date("2026-06-01T12:00:00.000Z"),
    client: outsideWindowDb,
  });
  assert.equal(outsideWindow.ok, false);
  if (!outsideWindow.ok) {
    assert.equal(outsideWindow.reason, "outside_window");
  }

  const constrainedDb = new PromoDbStub(
    buildBasePromo({
      allowed_vehicle_ids_json: ["vehicle-allowed"],
      blackout_dates_json: ["2026-06-11"],
    }),
  );

  const disallowedVehicle = await validatePromoForBooking({
    code: "SAVE10",
    vehicleId: "vehicle-1",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    subtotalCents: 20000,
    baseTotalCents: 20000,
    now: new Date("2026-06-01T12:00:00.000Z"),
    client: constrainedDb,
  });
  assert.equal(disallowedVehicle.ok, false);
  if (!disallowedVehicle.ok) {
    assert.equal(disallowedVehicle.reason, "vehicle_not_allowed");
  }

  const blackoutMatch = await validatePromoForBooking({
    code: "SAVE10",
    vehicleId: "vehicle-allowed",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    subtotalCents: 20000,
    baseTotalCents: 20000,
    now: new Date("2026-06-01T12:00:00.000Z"),
    client: constrainedDb,
  });
  assert.equal(blackoutMatch.ok, false);
  if (!blackoutMatch.ok) {
    assert.equal(blackoutMatch.reason, "blackout_date");
  }
});

test("validatePromoForBooking rejects promo after end-of-life date", async () => {
  const db = new PromoDbStub(
    buildBasePromo({
      start_at: "2026-01-01T00:00:00.000Z",
      end_at: "2026-06-01T00:00:00.000Z",
    }),
  );

  const result = await validatePromoForBooking({
    code: "SAVE10",
    vehicleId: "vehicle-1",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    subtotalCents: 20000,
    baseTotalCents: 20000,
    now: new Date("2026-06-10T09:00:00.000Z"),
    client: db,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "outside_window");
  }
});

test("promo booking flow integration: redemption upsert is idempotent and per-customer limit enforced", async () => {
  const db = new PromoDbStub(
    buildBasePromo({
      discount_type: "FIXED",
      discount_value: 1500,
      max_redemptions_per_customer: 1,
      max_redemptions: 5,
    }),
  );

  const firstValidation = await validatePromoForBooking({
    code: "SAVE10",
    vehicleId: "vehicle-1",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    subtotalCents: 12000,
    baseTotalCents: 12000,
    customerId: "customer-1",
    now: new Date("2026-06-01T12:00:00.000Z"),
    client: db,
  });
  assert.equal(firstValidation.ok, true);
  if (!firstValidation.ok) return;

  await upsertPromoRedemption({
    bookingId: "booking-1",
    promoId: firstValidation.promoId,
    customerId: "customer-1",
    customerEmail: "customer@example.com",
    discountAmountCents: firstValidation.discountAmountCents,
    client: db,
  });
  assert.equal(db.redemptions.length, 1);

  // Re-applying for the same booking should replace, not stack.
  await upsertPromoRedemption({
    bookingId: "booking-1",
    promoId: firstValidation.promoId,
    customerId: "customer-1",
    customerEmail: "customer@example.com",
    discountAmountCents: firstValidation.discountAmountCents,
    client: db,
  });
  assert.equal(db.redemptions.length, 1);

  // Same customer should now hit per-customer limit for a new booking.
  const secondValidationSameCustomer = await validatePromoForBooking({
    code: "SAVE10",
    vehicleId: "vehicle-1",
    startDate: "2026-06-20",
    endDate: "2026-06-22",
    subtotalCents: 12000,
    baseTotalCents: 12000,
    customerId: "customer-1",
    now: new Date("2026-06-01T12:00:00.000Z"),
    client: db,
  });
  assert.equal(secondValidationSameCustomer.ok, false);
  if (!secondValidationSameCustomer.ok) {
    assert.equal(secondValidationSameCustomer.reason, "max_per_customer");
  }

  // Different customer can still redeem.
  const secondValidationDifferentCustomer = await validatePromoForBooking({
    code: "SAVE10",
    vehicleId: "vehicle-1",
    startDate: "2026-06-20",
    endDate: "2026-06-22",
    subtotalCents: 12000,
    baseTotalCents: 12000,
    customerId: "customer-2",
    now: new Date("2026-06-01T12:00:00.000Z"),
    client: db,
  });
  assert.equal(secondValidationDifferentCustomer.ok, true);
});

test("validatePromoForBooking applies DAYS_TOTAL scope to base rental only", async () => {
  const db = new PromoDbStub(
    buildBasePromo({
      apply_scope: "DAYS_TOTAL",
      discount_type: "PERCENT",
      discount_value: 50,
    }),
  );

  const result = await validatePromoForBooking({
    code: "SAVE10",
    vehicleId: "vehicle-1",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    subtotalCents: 30000, // includes non-day charges
    baseTotalCents: 20000, // rental days only
    now: new Date("2026-06-01T12:00:00.000Z"),
    client: db,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.applyScope, "DAYS_TOTAL");
  assert.equal(result.discountBaseCents, 20000);
  assert.equal(result.discountAmountCents, 10000);
  assert.equal(result.totalAfterDiscountCents, 20000);
});

test("applying a promo updates payable total used by final payment step", async () => {
  const base = computeBookingPricing({
    bookingId: "booking-1",
    bookingStatus: "PENDING_PAYMENT",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    dailyRate: 10000,
    deposit: 3000,
    netPaidToDate: 0,
    promoCode: null,
    promoDiscount: 0,
  });

  const discounted = computeBookingPricing({
    bookingId: "booking-1",
    bookingStatus: "PENDING_PAYMENT",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    dailyRate: 10000,
    deposit: 3000,
    netPaidToDate: 0,
    promoCode: "SAVE10",
    promoDiscount: 2000,
  });

  assert.equal(base.total, 20000);
  assert.equal(discounted.total, 18000);
  // Pay-in-full route charges summary.total from server-side pricing.
  assert.equal(discounted.total, 18000);
});

test("switching promo code on the same booking replaces prior redemption instead of stacking", async () => {
  const db = new PromoDbStub(buildBasePromo());

  await upsertPromoRedemption({
    bookingId: "booking-1",
    promoId: "promo-1",
    customerId: "customer-1",
    customerEmail: "customer@example.com",
    discountAmountCents: 1000,
    client: db,
  });
  await upsertPromoRedemption({
    bookingId: "booking-1",
    promoId: "promo-2",
    customerId: "customer-1",
    customerEmail: "customer@example.com",
    discountAmountCents: 1500,
    client: db,
  });

  assert.equal(db.redemptions.length, 1);
  assert.equal(db.redemptions[0]?.promo_code_id, "promo-2");
  assert.equal(db.redemptions[0]?.discount_amount_cents, 1500);
});
