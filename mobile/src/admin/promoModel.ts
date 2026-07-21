import type { AdminPromoInput, AdminPromoItem } from "./api";

export type PromoDraft = {
  code: string; isActive: boolean; discountType: "PERCENT" | "FIXED"; applyScope: "OVERALL_TOTAL" | "DAYS_TOTAL"; discountValue: string;
  minSubtotal: string; maxRedemptions: string; maxPerCustomer: string; startDate: string; startTime: string; endDate: string; endTime: string;
  allowedVehicleIds: string[]; excludedVehicleIds: string[]; blackoutDates: string;
};

export const EMPTY_PROMO_DRAFT: PromoDraft = { code: "", isActive: true, discountType: "PERCENT", applyScope: "DAYS_TOTAL", discountValue: "", minSubtotal: "", maxRedemptions: "", maxPerCustomer: "", startDate: "", startTime: "", endDate: "", endTime: "", allowedVehicleIds: [], excludedVehicleIds: [], blackoutDates: "" };

export function validatePromoDraft(draft: PromoDraft): { ok: true; input: AdminPromoInput } | { ok: false; error: string } {
  const code = draft.code.trim().toUpperCase(); const discountValue = Number(draft.discountValue.replaceAll(",", ""));
  if (!code) return { ok: false, error: "Enter a promo code." };
  if (!Number.isFinite(discountValue) || discountValue <= 0) return { ok: false, error: "Discount value must be greater than zero." };
  if (draft.discountType === "PERCENT" && discountValue > 100) return { ok: false, error: "Percentage discounts cannot exceed 100%." };
  const minSubtotal = optionalNumber(draft.minSubtotal, false); const maxRedemptions = optionalNumber(draft.maxRedemptions, true); const maxPerCustomer = optionalNumber(draft.maxPerCustomer, true);
  if (minSubtotal === "invalid" || maxRedemptions === "invalid" || maxPerCustomer === "invalid") return { ok: false, error: "Limits must be valid non-negative values; redemption caps must be whole numbers greater than zero." };
  const startAt = jamaicaIso(draft.startDate, draft.startTime, false); const endAt = jamaicaIso(draft.endDate, draft.endTime, true);
  if (startAt === "invalid" || endAt === "invalid") return { ok: false, error: "Use valid dates as YYYY-MM-DD and times as HH:mm." };
  if (startAt && endAt && new Date(endAt) < new Date(startAt)) return { ok: false, error: "The end of the eligibility window must be after its start." };
  const blackoutDates = draft.blackoutDates.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  if (blackoutDates.some((item) => !validDate(item))) return { ok: false, error: "Every blackout date must use YYYY-MM-DD." };
  return { ok: true, input: { code, isActive: draft.isActive, discountType: draft.discountType, applyScope: draft.applyScope, discountValue, minSubtotalCents: minSubtotal, maxRedemptions, maxRedemptionsPerCustomer: maxPerCustomer, startAt, endAt, allowedVehicleIds: draft.allowedVehicleIds, excludedVehicleIds: draft.excludedVehicleIds, blackoutDates: [...new Set(blackoutDates)] } };
}

export function promoDraftFromItem(promo: AdminPromoItem): PromoDraft { const start = jamaicaParts(promo.start_at); const end = jamaicaParts(promo.end_at); return { code: promo.code, isActive: promo.is_active, discountType: promo.discount_type, applyScope: promo.apply_scope, discountValue: String(promo.discount_value), minSubtotal: promo.min_subtotal_cents === null ? "" : String(promo.min_subtotal_cents), maxRedemptions: promo.max_redemptions === null ? "" : String(promo.max_redemptions), maxPerCustomer: promo.max_redemptions_per_customer === null ? "" : String(promo.max_redemptions_per_customer), startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time, allowedVehicleIds: [...promo.allowed_vehicle_ids_json], excludedVehicleIds: [...promo.excluded_vehicle_ids_json], blackoutDates: promo.blackout_dates_json.join(", ") }; }

function optionalNumber(value: string, requirePositive: boolean): number | null | "invalid" { if (!value.trim()) return null; const number = Number(value.replaceAll(",", "")); if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0 || (requirePositive && number < 1)) return "invalid"; return number; }
function jamaicaIso(date: string, time: string, end: boolean): string | null | "invalid" { if (!date.trim() && !time.trim()) return null; if (!validDate(date)) return "invalid"; const clock = time.trim() || (end ? "23:59" : "00:00"); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return "invalid"; const parsed = new Date(`${date}T${clock}:00-05:00`); return Number.isNaN(parsed.getTime()) ? "invalid" : parsed.toISOString(); }
function validDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T12:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function jamaicaParts(value: string | null) { if (!value) return { date: "", time: "" }; const date = new Date(value); if (Number.isNaN(date.getTime())) return { date: "", time: "" }; const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Jamaica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date); const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ""; return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` }; }

export default { EMPTY_PROMO_DRAFT, validatePromoDraft, promoDraftFromItem };
