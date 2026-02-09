const MS_PER_DAY = 1000 * 60 * 60 * 24;

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Normalize to date-only at T00:00:00Z, regardless of input timezone/time-of-day.
export function dateOnlyUtc(value: unknown): Date | null {
  const d = asDate(value);
  if (!d) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Inclusive day count: 2026-03-19 -> 2026-03-20 == 2 days.
export function calcDaysInclusive(start: unknown, end: unknown) {
  const s = dateOnlyUtc(start);
  const e = dateOnlyUtc(end);
  if (!s || !e) return 0;
  const diff = Math.floor((e.getTime() - s.getTime()) / MS_PER_DAY);
  return diff >= 0 ? diff + 1 : 0;
}

