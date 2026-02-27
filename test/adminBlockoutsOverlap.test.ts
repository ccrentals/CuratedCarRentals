import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildBookingBlocksAvailabilitySql,
  buildBookingWindowEndSql,
  buildBookingWindowStartSql,
  isBookingBlockingAvailability,
} from "@/lib/bookings/bookingBlocking";

test("blockout overlap semantics: timestamp overlap uses start_at fallback first", () => {
  const startSql = buildBookingWindowStartSql("b");
  assert.equal(startSql, "coalesce(b.start_at, b.start_date::timestamptz)");
});

test("blockout overlap semantics: date-only end window is normalized with +1 day", () => {
  const endSql = buildBookingWindowEndSql("b");
  assert.equal(endSql, "coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day'))");
});

test("blockout overlap semantics: cancelled/returned/overridden statuses are non-blocking", () => {
  assert.equal(isBookingBlockingAvailability({ status: "CANCELLED" }), false);
  assert.equal(isBookingBlockingAvailability({ status: "RETURNED" }), false);
  assert.equal(isBookingBlockingAvailability({ status: "OVERRIDDEN" }), false);
});

test("blockout overlap semantics: lost or overridden pricing markers are non-blocking", () => {
  assert.equal(
    isBookingBlockingAvailability({
      status: "CONFIRMED",
      pricing_json: { cancel_reason: "LOST_TO_FIRST_DEPOSIT" },
    }),
    false,
  );
  assert.equal(
    isBookingBlockingAvailability({
      status: "PENDING_PAYMENT",
      pricing_json: { overridden_by_booking_id: "winner-booking-id" },
    }),
    false,
  );
  assert.equal(
    isBookingBlockingAvailability({
      status: "PENDING_PAYMENT",
      pricing_json: { entitlement_status: "LOST" },
    }),
    false,
  );
});

test("blockout overlap semantics: active booking with no loss markers remains blocking", () => {
  assert.equal(
    isBookingBlockingAvailability({
      status: "CONFIRMED",
      pricing_json: { payment_status: "DEPOSIT_PAID" },
    }),
    true,
  );
});

test("blockout overlap semantics: SQL exclusion includes statuses and lost markers", () => {
  const sql = buildBookingBlocksAvailabilitySql("b");
  assert.match(sql, /not in \('CANCELLED', 'RETURNED', 'OVERRIDDEN'\)/);
  assert.match(sql, /cancel_reason/);
  assert.match(sql, /LOST_TO_FIRST_DEPOSIT/);
  assert.match(sql, /overridden_by_booking_id/);
  assert.match(sql, /entitlement_status/);
});

test("admin blockouts API routes use normalized overlap and blocking helpers", () => {
  const postRoute = readFileSync(
    path.join(process.cwd(), "src/app/api/admin/blockouts/route.ts"),
    "utf8",
  );
  const patchRoute = readFileSync(
    path.join(process.cwd(), "src/app/api/admin/blockouts/[id]/route.ts"),
    "utf8",
  );

  for (const file of [postRoute, patchRoute]) {
    assert.match(file, /buildBookingWindowStartSql/);
    assert.match(file, /buildBookingWindowEndSql/);
    assert.match(file, /buildBookingBlocksAvailabilitySql/);
    assert.match(file, /isBookingBlockingAvailability/);
    assert.match(file, /< \$3::timestamptz/);
    assert.match(file, /> \$2::timestamptz/);
  }
});
