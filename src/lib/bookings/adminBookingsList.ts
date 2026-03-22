import { readBookingOverrideInfo } from "@/lib/bookings/holds";
import {
  decodeBookingsCursor,
  encodeBookingsCursor,
  normalizeBookingPageSize,
  type BookingPageSize,
} from "@/lib/bookings/adminBookingsPagination";
import { buildBookingRangeWhere, buildRange, type BookingDateRange } from "@/lib/bookings/dateRangeFilter";
import { buildUpcomingWhereSql } from "@/lib/bookings/upcoming";
import { dbQuery } from "@/lib/db";
import { fmtAdminDateTimeNoSeconds, fmtDateNoSeconds } from "@/lib/dateFormat";
import {
  isNonBlockingBookingHold,
  readAmountPaid,
  readHoldMinimumAmount,
  readPaymentOption,
} from "@/lib/payments/pricing";
import { formatBookingStatusLabel } from "@/lib/bookings/formatBookingStatusLabel";
import { deriveBookingPhase, type DerivedBookingPhase } from "@/lib/vehicles/vehicleStatus";

type BookingDbRow = {
  id: string;
  public_id: string;
  archived_at: string | Date | null;
  start_at: string | Date | null;
  end_at: string | Date | null;
  start_date: string | Date;
  end_date: string | Date;
  created_at: string | Date;
  status: string;
  pricing_json: Record<string, unknown> | null;
  vehicle_deposit_cents: number;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
};

export type BookingSubstatusVariant = "unpaid" | "due_on_pickup" | "overridden" | "refunded";

export type BookingSubstatusIndicator = {
  key: string;
  variant: BookingSubstatusVariant;
  message: string;
  priority: number;
};

export type AdminBookingListItem = {
  id: string;
  publicId: string;
  customerName: string;
  customerEmail: string;
  vehicleLabel: string;
  startDateLabel: string;
  endDateLabel: string;
  startDateIso: string;
  endDateIso: string;
  createdAtIso: string;
  createdAtLabel: string;
  cancelledAtLabel: string | null;
  lostToFirstDeposit: boolean;
  status: string;
  statusLabel: string;
  derivedPhase: DerivedBookingPhase;
  substatusIndicators: BookingSubstatusIndicator[];
  overriddenByBookingId: string | null;
  overriddenByCustomerName: string | null;
};

export type AdminBookingListPage = {
  bookings: AdminBookingListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  archiveNotConfigured: boolean;
  limit: BookingPageSize;
};

export type AdminBookingCountResult = {
  totalCount: number;
  archiveNotConfigured: boolean;
};

export type DashboardBookingSnapshot = {
  counts: {
    totalBookings: number;
    pendingPayment: number;
    confirmed: number;
  };
  recentBookings: AdminBookingListItem[];
  recentBookingsPagination: {
    page: number;
    totalPages: number;
    totalCount: number;
    from: number;
    to: number;
    hasPrev: boolean;
    hasNext: boolean;
    pageSize: number;
  };
  archiveNotConfigured: boolean;
};

export type AdminBookingListQueryInput = {
  status?: string | null;
  scope?: string | null;
  pickupDay?: string | null;
  sortBy?: string | null;
  sortDir?: string | null;
  q?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  archived?: string | null;
  includeArchived?: boolean;
  limit?: unknown;
  offset?: unknown;
  cursor?: unknown;
  now?: unknown;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_MAP: Record<string, string[]> = {
  pending_payment: ["PENDING_PAYMENT"],
  confirmed: ["CONFIRMED"],
  completed: ["RETURNED"],
  cancelled: ["CANCELLED"],
};
const LOST_TO_FIRST_DEPOSIT_FILTER = "lost_to_first_deposit";
const UPCOMING_SCOPE = "upcoming";
const PICKUP_DAY_TODAY = "today";
export const DEFAULT_HIDDEN_BOOKING_STATUSES = ["CANCELLED"] as const;
export const DASHBOARD_RECENT_BOOKINGS_PAGE_SIZE = 5;
const BOOKING_SORT_FIELDS = [
  "booking",
  "customer",
  "vehicle",
  "dates",
  "status",
  "created",
] as const;

type BookingSortBy = (typeof BOOKING_SORT_FIELDS)[number];
type BookingSortDir = "asc" | "desc";

function normalizeStatusFilter(raw: unknown) {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "all") return undefined;
  if (normalized === LOST_TO_FIRST_DEPOSIT_FILTER) return undefined;
  return STATUS_MAP[normalized] ?? [normalized.toUpperCase()];
}

export function shouldExcludeCancelledFromDefaultBookingsScope(rawStatus: unknown) {
  if (typeof rawStatus !== "string") return true;
  const normalized = rawStatus.trim().toLowerCase();
  if (!normalized || normalized === "all") return true;
  return normalized !== LOST_TO_FIRST_DEPOSIT_FILTER && !Boolean(STATUS_MAP[normalized]);
}

function normalizeScope(raw: unknown) {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "all") return undefined;
  if (normalized !== UPCOMING_SCOPE) return undefined;
  return normalized;
}

function normalizePickupDay(raw: unknown) {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized !== PICKUP_DAY_TODAY) return undefined;
  return normalized;
}

function normalizeBookingSortBy(raw: unknown): BookingSortBy | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (BOOKING_SORT_FIELDS.some((field) => field === normalized)) {
    return normalized as BookingSortBy;
  }
  return undefined;
}

function normalizeBookingSortDir(raw: unknown): BookingSortDir | undefined {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "asc") return "asc";
  if (normalized === "desc") return "desc";
  return undefined;
}

function asIsoTimestamp(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const date = new Date(String(value ?? ""));
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return String(value ?? "");
}

function asIsoDateOnly(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && DATE_RE.test(value)) {
    return value;
  }
  const date = new Date(String(value ?? ""));
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value ?? "");
}

function asMoneyLike(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function resolveSubstatusIndicators(input: {
  bookingStatus: string;
  pricing: Record<string, unknown>;
  nonBlocking: boolean;
  overriddenByBookingId: string | null;
  overriddenByPublicId: string | null;
}) {
  const indicators: BookingSubstatusIndicator[] = [];
  const bookingStatus = String(input.bookingStatus ?? "")
    .trim()
    .toUpperCase();
  const paymentStatusRaw = String(input.pricing.payment_status ?? "")
    .trim()
    .toUpperCase();
  const paymentOption = readPaymentOption(input.pricing);
  const isClosed = ["CANCELLED", "RETURNED", "COMPLETED"].includes(bookingStatus);

  if (input.overriddenByBookingId) {
    const overriddenLabel = input.overriddenByPublicId || input.overriddenByBookingId;
    indicators.push({
      key: "overridden",
      variant: "overridden",
      message: `Overridden by paid booking ${overriddenLabel}`,
      priority: 1,
    });
  }

  if (input.nonBlocking) {
    indicators.push({
      key: "unpaid_non_blocking",
      variant: "unpaid",
      message: "Unpaid - Not holding vehicle",
      priority: 2,
    });
  }

  if (!isClosed && paymentOption === "NONE") {
    indicators.push({
      key: "due_on_pickup",
      variant: "due_on_pickup",
      message: "Due on pickup",
      priority: 3,
    });
  }

  if (paymentStatusRaw.includes("REFUND") || input.pricing.refund_required === true) {
    indicators.push({
      key: "refunded",
      variant: "refunded",
      message: "Refunded payment activity",
      priority: 4,
    });
  }

  return indicators.sort((left, right) => left.priority - right.priority).slice(0, 2);
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (code !== "42703") return false;
  const haystack = message.toLowerCase();
  const needle = column.toLowerCase();
  return (
    haystack.includes("does not exist") &&
    (haystack.includes(`"${needle}"`) || haystack.includes(`.${needle}`) || haystack.includes(needle))
  );
}

function normalizeQueryInput(input: AdminBookingListQueryInput) {
  const limit = normalizeBookingPageSize(input.limit);
  const q = typeof input.q === "string" ? input.q.trim() : "";
  const dateFrom =
    typeof input.dateFrom === "string" && DATE_RE.test(input.dateFrom) ? input.dateFrom : null;
  const dateTo =
    typeof input.dateTo === "string" && DATE_RE.test(input.dateTo) ? input.dateTo : null;
  const dateRange = buildRange(dateFrom, dateTo);
  const statusFilter = normalizeStatusFilter(input.status);
  const scope = normalizeScope(input.scope);
  const pickupDay = normalizePickupDay(input.pickupDay);
  const includeArchived =
    input.includeArchived === true || (typeof input.archived === "string" && input.archived === "1");
  const lostToFirstDepositOnly =
    typeof input.status === "string" &&
    input.status.trim().toLowerCase() === LOST_TO_FIRST_DEPOSIT_FILTER;
  const excludeCancelledFromDefaultScope =
    !statusFilter && !lostToFirstDepositOnly && shouldExcludeCancelledFromDefaultBookingsScope(input.status);
  const directOffset = Number(input.offset);
  const normalizedDirectOffset =
    Number.isInteger(directOffset) && directOffset >= 0 ? directOffset : null;
  const cursor = decodeBookingsCursor(input.cursor);
  const offset =
    normalizedDirectOffset !== null
      ? normalizedDirectOffset
      : cursor && Number.isInteger(cursor.offset) && Number(cursor.offset) >= 0
      ? Number(cursor.offset)
      : 0;
  const now = input.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date();
  const defaultSortBy: BookingSortBy =
    scope === UPCOMING_SCOPE || pickupDay === PICKUP_DAY_TODAY ? "dates" : "created";
  const defaultSortDir: BookingSortDir = defaultSortBy === "created" ? "desc" : "asc";
  const sortBy = normalizeBookingSortBy(input.sortBy) ?? defaultSortBy;
  const sortDir = normalizeBookingSortDir(input.sortDir) ?? defaultSortDir;

  return {
    limit,
    q,
    dateRange,
    statusFilter,
    scope,
    pickupDay,
    includeArchived,
    lostToFirstDepositOnly,
    excludeCancelledFromDefaultScope,
    cursor,
    offset,
    now,
    sortBy,
    sortDir,
  };
}

function buildBookingsQuery(input: {
  includeArchiveFilter: boolean;
  includeArchived: boolean;
  statusFilter?: string[];
  scope?: string;
  pickupDay?: string;
  lostToFirstDepositOnly: boolean;
  excludeCancelledFromDefaultScope: boolean;
  q: string;
  dateRange: BookingDateRange | null;
  offset: number;
  sortBy: BookingSortBy;
  sortDir: BookingSortDir;
  limit: number;
  now: Date;
}, options?: { countOnly?: boolean }) {
  const countOnly = options?.countOnly === true;
  const whereClauses: string[] = [];
  const values: Array<string | string[] | number> = [];
  let index = 1;
  const customerNameExpr = "coalesce(nullif(b.pricing_json->>'customer_name_snapshot', ''), c.full_name)";
  const customerEmailExpr = "coalesce(nullif(b.pricing_json->>'customer_email_snapshot', ''), c.email)";
  const customerPhoneExpr = "coalesce(nullif(b.pricing_json->>'customer_phone_snapshot', ''), c.phone)";

  const forceExcludeArchived = input.scope === UPCOMING_SCOPE;
  if (input.includeArchiveFilter && (!input.includeArchived || forceExcludeArchived)) {
    whereClauses.push("b.archived_at is null");
  }

  if (input.excludeCancelledFromDefaultScope) {
    whereClauses.push(
      `upper(coalesce(b.status, '')) <> all($${index}::text[])`,
    );
    values.push([...DEFAULT_HIDDEN_BOOKING_STATUSES]);
    index += 1;
  }

  if (input.statusFilter) {
    if (input.statusFilter.length === 1) {
      whereClauses.push(`b.status = $${index}`);
      values.push(input.statusFilter[0]);
      index += 1;
    } else {
      whereClauses.push(`b.status = ANY($${index})`);
      values.push(input.statusFilter);
      index += 1;
    }
  }

  if (input.lostToFirstDepositOnly) {
    whereClauses.push(
      "upper(coalesce(b.status, '')) = 'CANCELLED' and upper(coalesce(b.pricing_json->>'cancel_reason', '')) = 'LOST_TO_FIRST_DEPOSIT'",
    );
  }

  if (input.scope === UPCOMING_SCOPE || input.pickupDay === PICKUP_DAY_TODAY) {
    const upcomingWhere = buildUpcomingWhereSql({
      bookingAlias: "b",
      paramStartIndex: index,
      now: input.now,
      mode: input.pickupDay === PICKUP_DAY_TODAY ? "pickup_today" : "upcoming",
    });
    whereClauses.push(upcomingWhere.clause);
    values.push(...upcomingWhere.values);
    index = upcomingWhere.nextParamIndex;
  }

  if (input.q) {
    whereClauses.push(
      `(${customerNameExpr} ilike $${index} or ${customerEmailExpr} ilike $${index} or ${customerPhoneExpr} ilike $${index} or b.id::text ilike $${index} or b.public_id ilike $${index})`,
    );
    values.push(`${input.q}%`);
    index += 1;
  }

  if (input.dateRange) {
    const rangeFilter = buildBookingRangeWhere({
      rangeStart: input.dateRange.rangeStartIso,
      rangeEnd: input.dateRange.rangeEndIso,
      paramStartIndex: index,
      bookingAlias: "b",
    });
    whereClauses.push(rangeFilter.clause);
    values.push(...rangeFilter.values);
    index = rangeFilter.nextParamIndex;
  }

  const whereSql = whereClauses.length > 0 ? `where ${whereClauses.join(" and ")}` : "";

  if (countOnly) {
    return {
      text:
        "select count(*)::int as total_count from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
        whereSql,
      values,
    };
  }

  const directionSql = input.sortDir === "asc" ? "asc" : "desc";
  const orderBySql =
    input.sortBy === "booking"
      ? `order by b.public_id ${directionSql}, b.id::text ${directionSql}`
      : input.sortBy === "customer"
        ? `order by lower(${customerNameExpr}) ${directionSql}, lower(${customerEmailExpr}) ${directionSql}, b.id::text ${directionSql}`
        : input.sortBy === "vehicle"
          ? `order by lower(v.make) ${directionSql}, lower(v.model) ${directionSql}, b.id::text ${directionSql}`
          : input.sortBy === "dates"
            ? `order by coalesce(b.start_at, b.start_date::timestamptz) ${directionSql}, coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day')) ${directionSql}, b.id::text ${directionSql}`
            : input.sortBy === "status"
              ? `order by upper(b.status) ${directionSql}, b.id::text ${directionSql}`
              : `order by b.created_at ${directionSql}, b.id::text ${directionSql}`;

  values.push(input.limit + 1);
  const limitIndex = values.length;
  values.push(Math.max(0, input.offset));
  const offsetIndex = values.length;
  const text =
    `select b.id, b.public_id, b.archived_at, b.start_at, b.end_at, b.start_date, b.end_date, b.created_at, b.status, b.pricing_json, ${customerNameExpr} as customer_name, ${customerEmailExpr} as customer_email, v.make as vehicle_make, v.model as vehicle_model, v.deposit_cents as vehicle_deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id ` +
    whereSql +
    ` ${orderBySql} limit $${limitIndex} offset $${offsetIndex}`;

  return { text, values };
}

export async function fetchAdminBookingCount(
  input: AdminBookingListQueryInput,
): Promise<AdminBookingCountResult> {
  const normalized = normalizeQueryInput(input);
  const requiresArchiveFilter = !normalized.includeArchived || normalized.scope === UPCOMING_SCOPE;

  const runCountQuery = async (includeArchiveFilter: boolean) => {
    const query = buildBookingsQuery(
      {
        includeArchiveFilter,
        includeArchived: normalized.includeArchived,
        statusFilter: normalized.statusFilter,
        scope: normalized.scope,
        pickupDay: normalized.pickupDay,
        lostToFirstDepositOnly: normalized.lostToFirstDepositOnly,
        excludeCancelledFromDefaultScope: normalized.excludeCancelledFromDefaultScope,
        q: normalized.q,
        dateRange: normalized.dateRange,
        offset: 0,
        sortBy: normalized.sortBy,
        sortDir: normalized.sortDir,
        limit: normalized.limit,
        now: normalized.now,
      },
      { countOnly: true },
    );
    return dbQuery<{ total_count: unknown }>(query.text, query.values);
  };

  let archiveNotConfigured = false;
  let countResult: Awaited<ReturnType<typeof dbQuery<{ total_count: unknown }>>>;
  try {
    countResult = await runCountQuery(true);
  } catch (error) {
    if (requiresArchiveFilter && isUndefinedColumn(error, "archived_at")) {
      archiveNotConfigured = true;
      countResult = await runCountQuery(false);
    } else {
      throw error;
    }
  }

  return {
    totalCount: Number(countResult.rows[0]?.total_count ?? 0),
    archiveNotConfigured,
  };
}

export async function fetchDashboardBookingSnapshot(input?: {
  now?: Date;
  recentBookingsPage?: unknown;
}): Promise<DashboardBookingSnapshot> {
  const now = input?.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date();
  const parsedRecentBookingsPage = Number(input?.recentBookingsPage);
  const requestedRecentBookingsPage =
    Number.isInteger(parsedRecentBookingsPage) && parsedRecentBookingsPage > 0
      ? parsedRecentBookingsPage
      : 1;

  const [totalBookings, pendingPayment, confirmed] = await Promise.all([
    fetchAdminBookingCount({ now }),
    fetchAdminBookingCount({ status: "pending_payment", now }),
    fetchAdminBookingCount({ status: "confirmed", now }),
  ]);
  const totalRecentBookingsPages = Math.max(
    1,
    Math.ceil(totalBookings.totalCount / DASHBOARD_RECENT_BOOKINGS_PAGE_SIZE),
  );
  const currentRecentBookingsPage = Math.min(requestedRecentBookingsPage, totalRecentBookingsPages);
  const recentBookingsPage = await fetchAdminBookingsPage({
    // The shared booking pager only supports 10/30/50 page sizes, so fetch the
    // minimum supported page and trim it down for the dashboard card.
    limit: "10",
    offset: (currentRecentBookingsPage - 1) * DASHBOARD_RECENT_BOOKINGS_PAGE_SIZE,
    now,
  });
  const dashboardRecentBookings = recentBookingsPage.bookings.slice(0, DASHBOARD_RECENT_BOOKINGS_PAGE_SIZE);
  const recentBookingsFrom =
    totalBookings.totalCount === 0
      ? 0
      : (currentRecentBookingsPage - 1) * DASHBOARD_RECENT_BOOKINGS_PAGE_SIZE + 1;
  const recentBookingsTo =
    totalBookings.totalCount === 0
      ? 0
      : Math.min(
          currentRecentBookingsPage * DASHBOARD_RECENT_BOOKINGS_PAGE_SIZE,
          totalBookings.totalCount,
        );

  return {
    counts: {
      totalBookings: totalBookings.totalCount,
      pendingPayment: pendingPayment.totalCount,
      confirmed: confirmed.totalCount,
    },
    recentBookings: dashboardRecentBookings,
    recentBookingsPagination: {
      page: currentRecentBookingsPage,
      totalPages: totalRecentBookingsPages,
      totalCount: totalBookings.totalCount,
      from: recentBookingsFrom,
      to: recentBookingsTo,
      hasPrev: currentRecentBookingsPage > 1,
      hasNext: currentRecentBookingsPage < totalRecentBookingsPages,
      pageSize: DASHBOARD_RECENT_BOOKINGS_PAGE_SIZE,
    },
    archiveNotConfigured:
      recentBookingsPage.archiveNotConfigured ||
      totalBookings.archiveNotConfigured ||
      pendingPayment.archiveNotConfigured ||
      confirmed.archiveNotConfigured,
  };
}

export async function fetchAdminBookingsPage(input: AdminBookingListQueryInput): Promise<AdminBookingListPage> {
  const normalized = normalizeQueryInput(input);
  const requiresArchiveFilter = !normalized.includeArchived || normalized.scope === UPCOMING_SCOPE;

  let archiveNotConfigured = false;
  let includeArchiveFilterInUse = true;

  const runPageQuery = async (includeArchiveFilter: boolean) => {
    const query = buildBookingsQuery({
      includeArchiveFilter,
      includeArchived: normalized.includeArchived,
      statusFilter: normalized.statusFilter,
      scope: normalized.scope,
      pickupDay: normalized.pickupDay,
      lostToFirstDepositOnly: normalized.lostToFirstDepositOnly,
      excludeCancelledFromDefaultScope: normalized.excludeCancelledFromDefaultScope,
      q: normalized.q,
      dateRange: normalized.dateRange,
      offset: normalized.offset,
      sortBy: normalized.sortBy,
      sortDir: normalized.sortDir,
      limit: normalized.limit,
      now: normalized.now,
    });
    return dbQuery<BookingDbRow>(query.text, query.values);
  };

  const runCountQuery = async (includeArchiveFilter: boolean) => {
    const query = buildBookingsQuery(
      {
        includeArchiveFilter,
        includeArchived: normalized.includeArchived,
        statusFilter: normalized.statusFilter,
        scope: normalized.scope,
        pickupDay: normalized.pickupDay,
        lostToFirstDepositOnly: normalized.lostToFirstDepositOnly,
        excludeCancelledFromDefaultScope: normalized.excludeCancelledFromDefaultScope,
        q: normalized.q,
        dateRange: normalized.dateRange,
        offset: 0,
        sortBy: normalized.sortBy,
        sortDir: normalized.sortDir,
        limit: normalized.limit,
        now: normalized.now,
      },
      { countOnly: true },
    );
    return dbQuery<{ total_count: unknown }>(query.text, query.values);
  };

  let pageResult: Awaited<ReturnType<typeof dbQuery<BookingDbRow>>>;

  try {
    pageResult = await runPageQuery(true);
  } catch (error) {
    if (requiresArchiveFilter && isUndefinedColumn(error, "archived_at")) {
      archiveNotConfigured = true;
      includeArchiveFilterInUse = false;
      pageResult = await runPageQuery(false);
    } else {
      throw error;
    }
  }

  const countResult = await runCountQuery(includeArchiveFilterInUse);
  const totalCount = Number(countResult.rows[0]?.total_count ?? 0);

  const hasMore = pageResult.rows.length > normalized.limit;
  const visibleRows: BookingDbRow[] = hasMore
    ? pageResult.rows.slice(0, normalized.limit)
    : pageResult.rows;

  const bookingIds = visibleRows.map((row) => row.id);
  const paidToDateByBookingId = new Map<string, number>();
  if (bookingIds.length > 0) {
    const paymentTotals = await dbQuery<{ booking_id: string; paid_to_date: unknown }>(
      "select booking_id::text as booking_id, coalesce(sum(deposit_amount_cents), 0) as paid_to_date from payments where booking_id::text = any($1::text[]) and status in ('DEPOSIT_PAID', 'REFUNDED') group by booking_id",
      [bookingIds],
    );
    for (const row of paymentTotals.rows) {
      paidToDateByBookingId.set(row.booking_id, asMoneyLike(row.paid_to_date));
    }
  }

  const overriddenByBookingIds = Array.from(
    new Set(
      visibleRows
        .map((row) => {
          const pricing = row.pricing_json ?? {};
          return readBookingOverrideInfo(pricing).overriddenByBookingId;
        })
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );
  const overriddenByNameByBookingId = new Map<string, string>();
  const overriddenByPublicIdByBookingId = new Map<string, string>();
  if (overriddenByBookingIds.length > 0) {
    const overriddenBookings = await dbQuery<{ id: string; public_id: string; customer_name: string }>(
      "select b.id::text as id, b.public_id, coalesce(nullif(b.pricing_json->>'customer_name_snapshot', ''), c.full_name) as customer_name from bookings b join customers c on c.id = b.customer_id where b.id::text = any($1::text[])",
      [overriddenByBookingIds],
    );
    for (const row of overriddenBookings.rows) {
      const customerName = String(row.customer_name ?? "").trim();
      if (customerName) {
        overriddenByNameByBookingId.set(String(row.id), customerName);
      }
      const publicId = String(row.public_id ?? "").trim();
      if (publicId) {
        overriddenByPublicIdByBookingId.set(String(row.id), publicId);
      }
    }
  }

  const bookings: AdminBookingListItem[] = visibleRows.map((row) => {
    const pricing = row.pricing_json ?? {};
    const livePaidToDate = paidToDateByBookingId.has(row.id)
      ? paidToDateByBookingId.get(row.id) ?? 0
      : readAmountPaid(pricing);
    const holdMinimum = readHoldMinimumAmount({
      ...pricing,
      deposit_cents: pricing.deposit_cents ?? row.vehicle_deposit_cents,
    });
    const nonBlocking =
      isNonBlockingBookingHold({
        paymentStatus: pricing.payment_status,
        amountPaid: livePaidToDate,
        holdMinimumAmount: holdMinimum,
      }) && !["CANCELLED", "RETURNED"].includes(row.status.toUpperCase());

    const overrideInfo = readBookingOverrideInfo(pricing);
    const cancelReason = String(pricing.cancel_reason ?? "")
      .trim()
      .toUpperCase();
    const lostToFirstDeposit = cancelReason === "LOST_TO_FIRST_DEPOSIT";
    const cancelledAtRaw =
      typeof pricing.cancelled_at === "string" ? pricing.cancelled_at : null;
    const cancelledAtLabel = cancelledAtRaw ? fmtAdminDateTimeNoSeconds(cancelledAtRaw) : null;
    const derivedPhase = deriveBookingPhase(
      {
        status: row.status,
        archived_at: row.archived_at,
        start_at: row.start_at,
        start_date: row.start_date,
        end_at: row.end_at,
        end_date: row.end_date,
        pricing_json: row.pricing_json,
        vehicle_deposit_cents: row.vehicle_deposit_cents,
      },
      normalized.now,
    );

    return {
      id: row.id,
      publicId: row.public_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      vehicleLabel: `${row.vehicle_make} ${row.vehicle_model}`.trim(),
      startDateLabel: fmtDateNoSeconds(row.start_date),
      endDateLabel: fmtDateNoSeconds(row.end_date),
      startDateIso: asIsoDateOnly(row.start_date),
      endDateIso: asIsoDateOnly(row.end_date),
      createdAtIso: asIsoTimestamp(row.created_at),
      createdAtLabel: fmtAdminDateTimeNoSeconds(row.created_at),
      cancelledAtLabel,
      lostToFirstDeposit,
      status: row.status,
      statusLabel: formatBookingStatusLabel(row.status, String(pricing.payment_status ?? "")),
      derivedPhase,
      substatusIndicators: resolveSubstatusIndicators({
        bookingStatus: row.status,
        pricing,
        nonBlocking,
        overriddenByBookingId: overrideInfo.overriddenByBookingId,
        overriddenByPublicId: overrideInfo.overriddenByBookingId
          ? overriddenByPublicIdByBookingId.get(overrideInfo.overriddenByBookingId) ?? null
          : null,
      }),
      overriddenByBookingId: overrideInfo.overriddenByBookingId,
      overriddenByCustomerName: overrideInfo.overriddenByBookingId
        ? overriddenByNameByBookingId.get(overrideInfo.overriddenByBookingId) ?? null
        : null,
    };
  });

  const nextCursor =
    hasMore && visibleRows.length > 0
      ? encodeBookingsCursor({
          createdAt: asIsoTimestamp(visibleRows[visibleRows.length - 1].created_at),
          startDate: asIsoDateOnly(visibleRows[visibleRows.length - 1].start_date),
          sortValue:
            normalized.sortBy === "booking"
              ? visibleRows[visibleRows.length - 1].id
              : normalized.sortBy === "customer"
                ? String(visibleRows[visibleRows.length - 1].customer_name ?? "")
                : normalized.sortBy === "vehicle"
                  ? `${visibleRows[visibleRows.length - 1].vehicle_make} ${visibleRows[visibleRows.length - 1].vehicle_model}`
                  : normalized.sortBy === "dates"
                    ? asIsoDateOnly(visibleRows[visibleRows.length - 1].start_date)
                    : normalized.sortBy === "status"
                      ? String(visibleRows[visibleRows.length - 1].status ?? "")
                      : asIsoTimestamp(visibleRows[visibleRows.length - 1].created_at),
          offset: normalized.offset + visibleRows.length,
          id: visibleRows[visibleRows.length - 1].id,
        })
      : null;

  return {
    bookings,
    nextCursor,
    hasMore: Boolean(nextCursor),
    totalCount: Number.isFinite(totalCount) ? totalCount : 0,
    archiveNotConfigured,
    limit: normalized.limit,
  };
}
