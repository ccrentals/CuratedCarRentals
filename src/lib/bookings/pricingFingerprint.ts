import { createHash } from "node:crypto";

/** Compares reviewed commercial terms; never grants access or trusts client prices. */
export function pricingFingerprint(pricing: Record<string, unknown>) {
  const fields = ["days", "currency", "daily_rate_cents", "base_total_cents", "insurance_selected",
    "insurance_plan_id", "insurance_price_per_day_cents", "insurance_total_cents", "delivery_selected",
    "delivery_zone_label", "extra_fees_cents", "promo_code", "discount_total_cents", "total_cents",
    "deposit_required_cents", "duration_tier", "rate_breakdown"];
  return createHash("sha256").update(JSON.stringify(fields.map(key => pricing[key] ?? null))).digest("hex");
}
