type JsonValue = Record<string, unknown> | null | undefined;

const NON_BLOCKING_STATUSES = new Set(["CANCELLED", "RETURNED", "OVERRIDDEN"]);

function asObject(value: JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeUpper(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeAlias(alias: string) {
  const trimmed = alias.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(`Unsafe SQL alias: ${alias}`);
  }
  return trimmed;
}

export function isBookingMarkedLostOrOverridden(pricingJson: JsonValue) {
  const pricing = asObject(pricingJson);
  if (normalizeUpper(pricing.cancel_reason) === "LOST_TO_FIRST_DEPOSIT") return true;
  if (hasText(pricing.overridden_by_booking_id)) return true;
  if (normalizeUpper(pricing.entitlement_status) === "LOST") return true;
  return false;
}

export function isBookingBlockingAvailability(input: {
  status?: unknown;
  pricing_json?: JsonValue;
}) {
  const status = normalizeUpper(input.status);
  if (NON_BLOCKING_STATUSES.has(status)) return false;
  if (isBookingMarkedLostOrOverridden(input.pricing_json)) return false;
  return true;
}

export function buildBookingBlocksAvailabilitySql(alias = "b") {
  const safeAlias = normalizeAlias(alias);
  const statusExpr = `upper(coalesce(${safeAlias}.status, ''))`;
  const cancelReasonExpr = `upper(coalesce(${safeAlias}.pricing_json->>'cancel_reason', ''))`;
  const overriddenByExpr = `coalesce(${safeAlias}.pricing_json->>'overridden_by_booking_id', '')`;
  const entitlementExpr = `upper(coalesce(${safeAlias}.pricing_json->>'entitlement_status', ''))`;
  return `(${statusExpr} not in ('CANCELLED', 'RETURNED', 'OVERRIDDEN') and ${cancelReasonExpr} <> 'LOST_TO_FIRST_DEPOSIT' and ${overriddenByExpr} = '' and ${entitlementExpr} <> 'LOST')`;
}

export function buildBookingWindowStartSql(alias = "b") {
  const safeAlias = normalizeAlias(alias);
  return `coalesce(${safeAlias}.start_at, ${safeAlias}.start_date::timestamptz)`;
}

export function buildBookingWindowEndSql(alias = "b") {
  const safeAlias = normalizeAlias(alias);
  return `coalesce(${safeAlias}.end_at, (${safeAlias}.end_date::timestamptz + interval '1 day'))`;
}
