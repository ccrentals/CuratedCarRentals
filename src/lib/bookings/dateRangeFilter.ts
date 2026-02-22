const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type BookingDateRange = {
  dateFrom: string;
  dateTo: string;
  rangeStart: Date;
  rangeEnd: Date;
  rangeStartIso: string;
  rangeEndIso: string;
};

type BuildBookingRangeWhereInput = {
  rangeStart: Date | string;
  rangeEnd: Date | string;
  paramStartIndex?: number;
  bookingAlias?: string;
};

type BuildBookingRangeWhereResult = {
  clause: string;
  values: [string, string];
  nextParamIndex: number;
};

type BookingRangeMatchInput = {
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  createdAt?: string | Date | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
};

function parseDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeDateOnly(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!DATE_RE.test(normalized)) return null;
  return normalized;
}

function startOfDayUtcIso(dateOnly: string) {
  return `${dateOnly}T00:00:00.000Z`;
}

function endOfDayUtcIso(dateOnly: string) {
  return `${dateOnly}T23:59:59.999Z`;
}

function resolveRangeBoundary(value: Date | string) {
  const parsed = parseDate(value);
  return parsed ? parsed.toISOString() : null;
}

function resolveBookingStart(input: BookingRangeMatchInput) {
  const startAt = parseDate(input.startAt);
  if (startAt) return startAt;
  const startDate = normalizeDateOnly(
    typeof input.startDate === "string" ? input.startDate : String(input.startDate ?? ""),
  );
  if (!startDate) return null;
  return parseDate(startOfDayUtcIso(startDate));
}

function resolveBookingEnd(input: BookingRangeMatchInput) {
  const endAt = parseDate(input.endAt);
  if (endAt) return endAt;
  const endDate = normalizeDateOnly(
    typeof input.endDate === "string" ? input.endDate : String(input.endDate ?? ""),
  );
  if (!endDate) return null;
  return parseDate(endOfDayUtcIso(endDate));
}

export function buildRange(fromDate?: string | null, toDate?: string | null): BookingDateRange | null {
  const normalizedFrom = normalizeDateOnly(fromDate);
  const normalizedTo = normalizeDateOnly(toDate);

  if (!normalizedFrom && !normalizedTo) return null;

  const dateFrom = normalizedFrom ?? normalizedTo;
  const dateTo = normalizedTo ?? normalizedFrom;
  if (!dateFrom || !dateTo) return null;

  const rangeStart = parseDate(startOfDayUtcIso(dateFrom));
  const rangeEnd = parseDate(endOfDayUtcIso(dateTo));
  if (!rangeStart || !rangeEnd) return null;

  return {
    dateFrom,
    dateTo,
    rangeStart,
    rangeEnd,
    rangeStartIso: rangeStart.toISOString(),
    rangeEndIso: rangeEnd.toISOString(),
  };
}

export function buildBookingRangeWhere(
  input: BuildBookingRangeWhereInput,
): BuildBookingRangeWhereResult {
  const rangeStartIso = resolveRangeBoundary(input.rangeStart);
  const rangeEndIso = resolveRangeBoundary(input.rangeEnd);
  if (!rangeStartIso || !rangeEndIso) {
    throw new Error("Invalid booking date range boundaries.");
  }

  const alias = input.bookingAlias ?? "b";
  const startParam = input.paramStartIndex ?? 1;
  const endParam = startParam + 1;

  const overlapStartExpr = `coalesce(${alias}.start_at, ${alias}.start_date::timestamptz)`;
  const overlapEndExpr = `coalesce(${alias}.end_at, (${alias}.end_date::timestamptz + interval '1 day' - interval '1 millisecond'))`;
  const createdExpr = `${alias}.created_at`;

  return {
    clause:
      `((${overlapStartExpr} <= $${endParam}::timestamptz and ${overlapEndExpr} >= $${startParam}::timestamptz) ` +
      `or (${createdExpr} between $${startParam}::timestamptz and $${endParam}::timestamptz))`,
    values: [rangeStartIso, rangeEndIso],
    nextParamIndex: endParam + 1,
  };
}

export function bookingMatchesDateRange(
  booking: BookingRangeMatchInput,
  range: Pick<BookingDateRange, "rangeStart" | "rangeEnd">,
) {
  const bookingStart = resolveBookingStart(booking);
  const bookingEnd = resolveBookingEnd(booking);
  const bookingCreated = parseDate(booking.createdAt);

  const rentalOverlap = Boolean(
    bookingStart && bookingEnd && bookingStart <= range.rangeEnd && bookingEnd >= range.rangeStart,
  );
  const createdInRange = Boolean(
    bookingCreated && bookingCreated >= range.rangeStart && bookingCreated <= range.rangeEnd,
  );

  return rentalOverlap || createdInRange;
}

