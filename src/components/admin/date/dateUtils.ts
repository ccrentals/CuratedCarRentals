export function parseDateOnly(value: string): Date | undefined {
  const normalized = value.trim();
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return undefined;
  const date = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseMonthOnly(value: string): Date | undefined {
  const normalized = value.trim();
  if (!normalized || !/^\d{4}-\d{2}$/.test(normalized)) return undefined;
  const date = new Date(`${normalized}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function toDateOnly(value?: Date) {
  if (!value) return "";
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toMonthOnly(value?: Date) {
  if (!value) return "";
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function dateRangeLabel(from: string, to: string, placeholder = "Select date range") {
  if (from && to) return `${from} - ${to}`;
  if (from) return `${from} - ...`;
  return placeholder;
}

export function splitDateTime(value: string) {
  const normalized = value.trim();
  if (!normalized) return { date: "", time: "" };
  const [datePart, timePart = ""] = normalized.split("T");
  return { date: datePart ?? "", time: (timePart ?? "").slice(0, 5) };
}

export function joinDateTime(date: string, time: string) {
  if (!date) return "";
  const safeTime = (time || "00:00").slice(0, 5);
  return `${date}T${safeTime}`;
}
