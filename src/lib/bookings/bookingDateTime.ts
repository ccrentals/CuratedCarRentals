const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME_ONLY_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const JAMAICA_UTC_OFFSET = "-05:00";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function toBookingDateOnly(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(ISO_DATE_PREFIX_RE);
  if (!match) return null;

  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() + 1 !== Number(match[2]) ||
    parsed.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }

  return normalized;
}

export function formatBookingDateOnly(value: unknown, locale = "en-US") {
  const normalized = toBookingDateOnly(value);
  if (!normalized) return String(value ?? "");

  const match = normalized.match(ISO_DATE_ONLY_RE);
  if (!match) return normalized;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date);
}

export function addBookingCalendarDays(value: unknown, days: number) {
  const normalized = toBookingDateOnly(value);
  if (!normalized || !Number.isInteger(days)) return null;

  const match = normalized.match(ISO_DATE_ONLY_RE);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function bookingDateTimeToUtcIso(date: unknown, time: unknown) {
  const normalizedDate = toBookingDateOnly(date);
  const normalizedTime = String(time ?? "").trim();
  const timeMatch = normalizedTime.match(TIME_ONLY_RE);
  if (!normalizedDate || !timeMatch) return null;

  const seconds = timeMatch[3] ?? "00";
  const parsed = new Date(
    `${normalizedDate}T${timeMatch[1]}:${timeMatch[2]}:${seconds}${JAMAICA_UTC_OFFSET}`,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function buildBookingDateTimeLabel(input: {
  date: unknown;
  time?: unknown;
  at?: unknown;
  locale?: string;
}) {
  const locale = input.locale ?? "en-US";
  if (input.at) {
    const timestamp = input.at instanceof Date ? input.at : new Date(String(input.at));
    if (!Number.isNaN(timestamp.getTime())) {
      return timestamp.toLocaleString(locale, {
        timeZone: "America/Jamaica",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }

  const dateLabel = formatBookingDateOnly(input.date, locale);
  const normalizedTime = String(input.time ?? "").trim();
  const timeMatch = normalizedTime.match(TIME_ONLY_RE);
  if (!timeMatch) return dateLabel;

  const timestamp = bookingDateTimeToUtcIso(input.date, normalizedTime);
  if (!timestamp) return `${dateLabel}, ${normalizedTime}`;
  return new Date(timestamp).toLocaleString(locale, {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
