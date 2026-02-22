import { fmtDateNoSeconds } from "@/lib/dateFormat";

export type DateTimeInput = Date | string | number | null | undefined;

export type DateTimeParts = {
  dateText: string;
  timeText: string | null;
};

export function coerceDateTimeLabel(value: Date | string | number) {
  if (value instanceof Date || typeof value === "number") {
    return fmtDateNoSeconds(value);
  }

  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return fmtDateNoSeconds(parsed);
  }

  return raw;
}

export function splitDateTimeLabel(label: string): DateTimeParts | null {
  const normalized = String(label ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const commaIndex = normalized.indexOf(",");
  if (commaIndex >= 0) {
    const dateText = normalized.slice(0, commaIndex).trim();
    const timeText = normalized.slice(commaIndex + 1).trim();
    return {
      dateText,
      timeText: timeText || null,
    };
  }

  const dateAndTimeMatch = normalized.match(/^(.*?)(\d{1,2}:\d{2}\s?[AP]M)$/i);
  if (dateAndTimeMatch) {
    return {
      dateText: dateAndTimeMatch[1].trim().replace(/[,\s]+$/, ""),
      timeText: dateAndTimeMatch[2].replace(/\s+/g, " ").trim(),
    };
  }

  return {
    dateText: normalized.replace(/[,\s]+$/, ""),
    timeText: null,
  };
}
