import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { config as loadEnv } from "dotenv";

import { fetchAdminPromoCodeById } from "@/app/api/admin/promo-codes/[id]/route";
import { dbQuery } from "@/lib/db";

loadEnv({ path: ".env.local" });
loadEnv();

function requireDatabaseOrSkip(t: TestContext) {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not set; skipping DB-backed admin promo detail history tests.");
  }
}

async function insertVehicle(runTag: string) {
  const result = await dbQuery<{ id: string }>(
    "insert into vehicles (make, model, year, seat_count, daily_rate_cents, deposit_cents, status, image_urls_json, features_json) values ($1, $2, $3, $4, $5, $6, 'AVAILABLE', $7::jsonb, $8::jsonb) returning id",
    [
      `Promo Detail Make ${runTag}`,
      `Promo Detail Model ${runTag}`,
      2034,
      5,
      12000,
      50000,
      JSON.stringify([]),
      JSON.stringify({ source: "test", runTag }),
    ],
  );
  return result.rows[0].id;
}

async function insertCustomer(runTag: string) {
  const result = await dbQuery<{ id: string }>(
    "insert into customers (full_name, email, phone) values ($1, $2, $3) returning id",
    [`Promo Detail Customer ${runTag}`, `${runTag}.promo-detail@example.com`, "+18765550123"],
  );
  return result.rows[0].id;
}

async function insertBooking(input: {
  vehicleId: string;
  customerId: string;
  pickupLocation: string;
  startDate: string;
  endDate: string;
  pricingJson: Record<string, unknown>;
}) {
  const result = await dbQuery<{ id: string }>(
    "insert into bookings (vehicle_id, customer_id, start_date, end_date, pickup_location, status, pricing_json) values ($1::uuid, $2::uuid, $3::date, $4::date, $5, 'CONFIRMED', $6::jsonb) returning id",
    [
      input.vehicleId,
      input.customerId,
      input.startDate,
      input.endDate,
      input.pickupLocation,
      JSON.stringify(input.pricingJson),
    ],
  );
  return result.rows[0].id;
}

async function insertPromo(runTag: string) {
  const result = await dbQuery<{ id: string }>(
    "insert into promo_codes (code, is_active, discount_type, apply_scope, discount_value, min_subtotal_cents, max_redemptions, max_redemptions_per_customer, start_at, end_at, allowed_vehicle_ids_json, excluded_vehicle_ids_json, blackout_dates_json) values ($1, true, 'FIXED', 'OVERALL_TOTAL', 2500, null, null, null, null, null, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb) returning id",
    [`DETAIL${runTag}`.toUpperCase()],
  );
  return result.rows[0].id;
}

async function cleanup(input: {
  promoIds: string[];
  bookingIds: string[];
  customerIds: string[];
  vehicleIds: string[];
}) {
  if (input.promoIds.length > 0) {
    await dbQuery("delete from promo_codes where id = any($1::uuid[])", [input.promoIds]);
  }
  if (input.bookingIds.length > 0) {
    await dbQuery("delete from bookings where id = any($1::uuid[])", [input.bookingIds]);
  }
  if (input.customerIds.length > 0) {
    await dbQuery("delete from customers where id = any($1::uuid[])", [input.customerIds]);
  }
  if (input.vehicleIds.length > 0) {
    await dbQuery("delete from vehicles where id = any($1::uuid[])", [input.vehicleIds]);
  }
}

test("admin promo detail exposes reconstructed-history metadata and row provenance", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `promo-detail-${randomUUID().slice(0, 8)}`;
  const promoIds: string[] = [];
  const bookingIds: string[] = [];
  const customerIds: string[] = [];
  const vehicleIds: string[] = [];

  try {
    const vehicleId = await insertVehicle(runTag);
    vehicleIds.push(vehicleId);
    const customerId = await insertCustomer(runTag);
    customerIds.push(customerId);
    const promoId = await insertPromo(runTag);
    promoIds.push(promoId);

    const reconstructedBookingId = await insertBooking({
      vehicleId,
      customerId,
      pickupLocation: `Airport ${runTag}`,
      startDate: "2036-04-10",
      endDate: "2036-04-13",
      pricingJson: { promo_code_id: promoId, promo_code: `DETAIL${runTag}`.toUpperCase(), promo_discount_cents: 2500 },
    });
    bookingIds.push(reconstructedBookingId);

    const liveBookingId = await insertBooking({
      vehicleId,
      customerId,
      pickupLocation: `Airport ${runTag}`,
      startDate: "2036-05-10",
      endDate: "2036-05-13",
      pricingJson: { promo_code_id: promoId, promo_code: `DETAIL${runTag}`.toUpperCase(), promo_discount_cents: 2500 },
    });
    bookingIds.push(liveBookingId);

    const reconstructedAt = "2026-03-21T09:00:00.000Z";
    const liveRedeemedAt = "2026-03-22T15:30:00.000Z";

    await dbQuery(
      "insert into promo_redemptions (promo_code_id, booking_id, customer_id, customer_email, discount_amount_cents, created_at) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::timestamptz)",
      [promoId, reconstructedBookingId, customerId, `${runTag}.promo-detail@example.com`, 2500, reconstructedAt],
    );
    await dbQuery(
      "insert into promo_redemption_events (promo_code_id, booking_id, customer_id, customer_email, discount_amount_cents, event_type, event_at, metadata_json) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'REDEEMED', $6::timestamptz, $7::jsonb)",
      [
        promoId,
        reconstructedBookingId,
        customerId,
        `${runTag}.promo-detail@example.com`,
        2500,
        reconstructedAt,
        JSON.stringify({ reconstructed: true, source: "legacy_reconstruction", timestampSource: "payment" }),
      ],
    );
    await dbQuery(
      "insert into promo_redemption_events (promo_code_id, booking_id, customer_id, customer_email, discount_amount_cents, event_type, event_at, metadata_json) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'REDEEMED', $6::timestamptz, $7::jsonb)",
      [
        promoId,
        liveBookingId,
        customerId,
        `${runTag}.promo-detail@example.com`,
        2500,
        liveRedeemedAt,
        JSON.stringify({ source: "test_live_event" }),
      ],
    );

    const detail = await fetchAdminPromoCodeById(promoId);

    assert.ok(detail);
    assert.equal(detail.historyCoverage, "COMPLETE_RECONSTRUCTED_HISTORY");
    assert.equal(detail.hasReconstructedHistory, true);
    assert.equal(detail.historyCoverageStartedAt, reconstructedAt);
    assert.equal(detail.summary.currentCount, 1);
    assert.equal(detail.activity.totalCount, 2);
    assert.ok(detail.activity.rows.some((row) => row.is_reconstructed === true));
    assert.ok(detail.activity.rows.some((row) => row.is_reconstructed === false));
    assert.ok(detail.activity.rows.some((row) => row.timestamp_source === "payment"));
  } finally {
    await cleanup({ promoIds, bookingIds, customerIds, vehicleIds });
  }
});
