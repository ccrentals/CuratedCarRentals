const ADMIN_DATE_TIME_LOCALE = "en-US";
const ADMIN_TIME_ZONE = "America/Jamaica";
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function asDate(value: unknown) {
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateOnlyParts(value: string) {
  const match = value.match(DATE_ONLY_RE);
  if (!match) return null;
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

export function fmtDate(value: unknown) {
  if (!value) return "";
  const raw = String(value);
  const dateOnly = formatDateOnlyParts(raw);
  if (dateOnly) return dateOnly;
  const d = asDate(value);
  return d ? fmtAdminDateTimeNoSeconds(d) : raw;
}

export function fmtAdminDateTimeNoSeconds(value: unknown) {
  if (!value) return "";
  const d = asDate(value);
  if (!d) return String(value);
  return d.toLocaleString(ADMIN_DATE_TIME_LOCALE, {
    timeZone: ADMIN_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDateNoSeconds(value: unknown) {
  if (!value) return "";
  const raw = String(value);
  const dateOnly = formatDateOnlyParts(raw);
  if (dateOnly) return dateOnly;
  return fmtAdminDateTimeNoSeconds(value);
}

export function fmtDateOnly(value: unknown) {
  if (!value) return "";
  const raw = String(value);
  const dateOnly = formatDateOnlyParts(raw);
  if (dateOnly) return dateOnly;
  const d = asDate(value);
  if (!d) return raw;
  return d.toLocaleDateString(ADMIN_DATE_TIME_LOCALE, {
    timeZone: ADMIN_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}
