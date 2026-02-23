export const MAINTENANCE_SCHEDULE_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED"] as const;
export type MaintenanceScheduleStatus = (typeof MAINTENANCE_SCHEDULE_STATUSES)[number];

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function normalizeNullableText(value: unknown, max = 255) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.slice(0, max);
}

export function normalizeNullableDate(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function normalizeNullableInt(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

export function normalizeNullablePositiveInt(value: unknown) {
  const parsed = normalizeNullableInt(value);
  if (parsed === null) return null;
  return parsed >= 1 ? parsed : null;
}

export function normalizeNullableNonNegativeInt(value: unknown) {
  const parsed = normalizeNullableInt(value);
  if (parsed === null) return null;
  return parsed >= 0 ? parsed : null;
}

export function normalizeMaintenanceStatus(
  value: unknown,
  fallback: MaintenanceScheduleStatus = "ACTIVE",
): MaintenanceScheduleStatus {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "PAUSED") return "PAUSED";
  if (normalized === "COMPLETED") return "COMPLETED";
  if (normalized === "ACTIVE") return "ACTIVE";
  return fallback;
}

export function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return fallback;
}

export function normalizeStringList(value: unknown, maxItems = 40, maxLength = 120) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,;]/)
      : [];

  return rawItems
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .map((entry) => entry.slice(0, maxLength))
    .slice(0, maxItems);
}

