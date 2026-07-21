import assert from "node:assert/strict";
import test from "node:test";

import promoModel from "../src/admin/promoModel.ts";

const { EMPTY_PROMO_DRAFT, validatePromoDraft, promoDraftFromItem } = promoModel;

test("mobile promo model prepares Jamaica-local windows and deduplicates blackout dates", () => {
  const result = validatePromoDraft({ ...EMPTY_PROMO_DRAFT, code: " island10 ", discountValue: "10", startDate: "2026-08-01", startTime: "09:30", endDate: "2026-08-31", endTime: "17:00", maxRedemptions: "100", maxPerCustomer: "1", blackoutDates: "2026-08-06, 2026-08-06\n2026-08-17", allowedVehicleIds: ["vehicle-1"] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.input.code, "ISLAND10");
  assert.equal(result.input.startAt, "2026-08-01T14:30:00.000Z");
  assert.equal(result.input.endAt, "2026-08-31T22:00:00.000Z");
  assert.deepEqual(result.input.blackoutDates, ["2026-08-06", "2026-08-17"]);
  assert.deepEqual(result.input.allowedVehicleIds, ["vehicle-1"]);
});

test("mobile promo model rejects invalid discounts, caps, windows, and blackout dates", () => {
  assert.equal(validatePromoDraft({ ...EMPTY_PROMO_DRAFT, code: "TOO-MUCH", discountValue: "101" }).ok, false);
  assert.equal(validatePromoDraft({ ...EMPTY_PROMO_DRAFT, code: "BAD-CAP", discountValue: "10", maxRedemptions: "1.5" }).ok, false);
  assert.equal(validatePromoDraft({ ...EMPTY_PROMO_DRAFT, code: "BAD-MIN", discountValue: "10", minSubtotal: "500.5" }).ok, false);
  assert.equal(validatePromoDraft({ ...EMPTY_PROMO_DRAFT, code: "BAD-WINDOW", discountValue: "10", startDate: "2026-09-02", endDate: "2026-09-01" }).ok, false);
  assert.equal(validatePromoDraft({ ...EMPTY_PROMO_DRAFT, code: "BAD-DATE", discountValue: "10", blackoutDates: "2026-02-30" }).ok, false);
});

test("mobile promo model round-trips server timestamps in Jamaica time", () => {
  const draft = promoDraftFromItem({ id: "promo-1", public_id: "PR000001", code: "LOCAL", is_active: true, discount_type: "FIXED", apply_scope: "OVERALL_TOTAL", discount_value: 5000, min_subtotal_cents: null, max_redemptions: null, max_redemptions_per_customer: null, start_at: "2026-08-01T14:30:00.000Z", end_at: "2026-08-31T22:00:00.000Z", allowed_vehicle_ids_json: [], excluded_vehicle_ids_json: ["vehicle-2"], blackout_dates_json: [], created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z", current_redemption_count: 0, remaining_redemptions: null, admin_state: "SCHEDULED" });
  assert.equal(draft.startDate, "2026-08-01");
  assert.equal(draft.startTime, "09:30");
  assert.equal(draft.endTime, "17:00");
  assert.deepEqual(draft.excludedVehicleIds, ["vehicle-2"]);
});
