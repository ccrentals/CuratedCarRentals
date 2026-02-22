const MS_PER_DAY = 24 * 60 * 60 * 1000;

const UPCOMING_EXCLUDED_STATUSES = new Set([
  "CANCELLED",
  "RETURNED",
  "COMPLETED",
  "OVERRIDDEN",
  "ARCHIVED",
]);

const UPCOMING_EXCLUDED_STATUS_SQL = Array.from(UPCOMING_EXCLUDED_STATUSES)
  .map((status) => `'${status}'`)
  .join(", ");

export type UpcomingSqlMode = "upcoming" | "pickup_today";

export type UpcomingBookingLike = {
  status?: unknown;
  start_at?: unknown;
  startAt?: unknown;
  start_date?: unknown;
  startDate?: unknown;
  archived_at?: unknown;
  archivedAt?: unknown;
};

type BuildUpcomingWhereSqlInput = {
  bookingAlias?: string;
  paramStartIndex?: number;
  now?: Date;
  mode?: UpcomingSqlMode;
};

type BuildUpcomingWhereSqlResult = {
  clause: string;
  values: string[];
  nextParamIndex: number;
};

function asDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeStatus(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function isArchivedBooking(booking: UpcomingBookingLike) {
  if (booking.archived_at || booking.archivedAt) return true;
  return normalizeStatus(booking.status) === "ARCHIVED";
}

export function getStartOfToday(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function getStartOfTomorrow(now: Date) {
  return new Date(getStartOfToday(now).getTime() + MS_PER_DAY);
}

export function bookingStartSqlExpr(alias = "b") {
  return `coalesce(${alias}.start_at, ${alias}.start_date::timestamptz)`;
}

export function getBookingStartAt(booking: UpcomingBookingLike) {
  const startAt = asDate(booking.start_at ?? booking.startAt);
  if (startAt) return startAt;

  const startDateRaw = booking.start_date ?? booking.startDate;
  if (!startDateRaw) return null;

  const startDateText = String(startDateRaw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDateText)) {
    return asDate(`${startDateText}T00:00:00.000Z`);
  }

  return asDate(startDateRaw);
}

export function isUpcomingBooking(booking: UpcomingBookingLike, now = new Date()) {
  if (isArchivedBooking(booking)) return false;

  const normalizedStatus = normalizeStatus(booking.status);
  if (UPCOMING_EXCLUDED_STATUSES.has(normalizedStatus)) return false;

  const startAt = getBookingStartAt(booking);
  if (!startAt) return false;

  return startAt >= getStartOfToday(now);
}

export function isPickupToday(booking: UpcomingBookingLike, now = new Date()) {
  if (!isUpcomingBooking(booking, now)) return false;

  const startAt = getBookingStartAt(booking);
  if (!startAt) return false;

  return startAt < getStartOfTomorrow(now);
}

export function buildUpcomingWhereSql(input: BuildUpcomingWhereSqlInput = {}): BuildUpcomingWhereSqlResult {
  const alias = input.bookingAlias ?? "b";
  const mode: UpcomingSqlMode = input.mode ?? "upcoming";
  const now = input.now ?? new Date();
  const values: string[] = [];
  const clauses: string[] = [];
  let paramIndex = input.paramStartIndex ?? 1;

  clauses.push(`${bookingStartSqlExpr(alias)} >= $${paramIndex}::timestamptz`);
  values.push(getStartOfToday(now).toISOString());
  paramIndex += 1;

  clauses.push(`upper(coalesce(${alias}.status, '')) not in (${UPCOMING_EXCLUDED_STATUS_SQL})`);

  if (mode === "pickup_today") {
    clauses.push(`${bookingStartSqlExpr(alias)} < $${paramIndex}::timestamptz`);
    values.push(getStartOfTomorrow(now).toISOString());
    paramIndex += 1;
  }

  return {
    clause: clauses.join(" and "),
    values,
    nextParamIndex: paramIndex,
  };
}
