import { readBookingOverrideInfo } from "@/lib/bookings/holds";
import {
  decodeBookingsCursor,
  encodeBookingsCursor,
  normalizeBookingPageSize,
  type BookingPageSize,
} from "@/lib/bookings/adminBookingsPagination";
import { dbQuery } from "@/lib/db";
import { fmtDateNoSeconds } from "@/lib/dateFormat";
import {
  isNonBlockingBookingHold,
  readAmountPaid,
  readHoldMinimumAmount,
  readPaymentOption,
} from "@/lib/payments/pricing";
import { formatBookingStatusLabel } from "@/lib/bookings/formatBookingStatusLabel";

type BookingDbRow = {
  id: string;
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
  customerName: string;
  customerEmail: string;
  vehicleLabel: string;
  datesLabel: string;
  createdAtLabel: string;
  cancelledAtLabel: string | null;
  lostToFirstDeposit: boolean;
  status: string;
  statusLabel: string;
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

export type AdminBookingListQueryInput = {
  status?: string | null;
  q?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  archived?: string | null;
  includeArchived?: boolean;
  limit?: unknown;
  cursor?: unknown;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_MAP: Record<string, string[]> = {
  pending_payment: ["PENDING_PAYMENT"],
  confirmed: ["CONFIRMED"],
  completed: ["RETURNED"],
  cancelled: ["CANCELLED"],
};
const LOST_TO_FIRST_DEPOSIT_FILTER = "lost_to_first_deposit";

function normalizeStatusFilter(raw: unknown) {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "all") return undefined;
  if (normalized === LOST_TO_FIRST_DEPOSIT_FILTER) return undefined;
  return STATUS_MAP[normalized] ?? [normalized.toUpperCase()];
}

function asIsoTimestamp(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const date = new Date(String(value ?? ""));
  if (!Number.isNaN(date.getTime())) return date.toISOString();
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
    indicators.push({
      key: "overridden",
      variant: "overridden",
      message: `Overridden by paid booking ${input.overriddenByBookingId.slice(0, 8)}`,
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
    typeof input.dateFrom === "string" && DATE_RE.test(input.dateFrom) ? input.dateFrom : undefined;
  const dateTo =
    typeof input.dateTo === "string" && DATE_RE.test(input.dateTo) ? input.dateTo : undefined;
  const statusFilter = normalizeStatusFilter(input.status);
  const includeArchived =
    input.includeArchived === true || (typeof input.archived === "string" && input.archived === "1");
  const lostToFirstDepositOnly =
    typeof input.status === "string" &&
    input.status.trim().toLowerCase() === LOST_TO_FIRST_DEPOSIT_FILTER;
  const cursor = decodeBookingsCursor(input.cursor);

  return {
    limit,
    q,
    dateFrom,
    dateTo,
    statusFilter,
    includeArchived,
    lostToFirstDepositOnly,
    cursor,
  };
}

function buildBookingsQuery(input: {
  includeArchiveFilter: boolean;
  includeArchived: boolean;
  statusFilter?: string[];
  lostToFirstDepositOnly: boolean;
  q: string;
  dateFrom?: string;
  dateTo?: string;
  cursor: ReturnType<typeof decodeBookingsCursor>;
  limit: number;
}, options?: { countOnly?: boolean }) {
  const countOnly = options?.countOnly === true;
  const whereClauses: string[] = [];
  const values: Array<string | string[] | number> = [];
  let index = 1;

  if (input.includeArchiveFilter && !input.includeArchived) {
    whereClauses.push("b.archived_at is null");
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

  if (input.q) {
    whereClauses.push(
      `(c.full_name ilike $${index} or c.email ilike $${index} or c.phone ilike $${index} or b.id::text ilike $${index})`,
    );
    values.push(`${input.q}%`);
    index += 1;
  }

  if (input.dateFrom) {
    whereClauses.push(`b.start_date >= $${index}`);
    values.push(input.dateFrom);
    index += 1;
  }

  if (input.dateTo) {
    whereClauses.push(`b.end_date <= $${index}`);
    values.push(input.dateTo);
    index += 1;
  }

  if (!countOnly && input.cursor) {
    whereClauses.push(
      `(b.created_at < $${index}::timestamptz or (b.created_at = $${index}::timestamptz and b.id::text < $${index + 1}::text))`,
    );
    values.push(input.cursor.createdAt);
    values.push(input.cursor.id);
    index += 2;
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

  values.push(input.limit + 1);
  const limitIndex = values.length;
  const text =
    "select b.id, b.start_date, b.end_date, b.created_at, b.status, b.pricing_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, v.deposit_cents as vehicle_deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
    whereSql +
    ` order by b.created_at desc, b.id::text desc limit $${limitIndex}`;

  return { text, values };
}

export async function fetchAdminBookingsPage(input: AdminBookingListQueryInput): Promise<AdminBookingListPage> {
  const normalized = normalizeQueryInput(input);

  let archiveNotConfigured = false;
  let includeArchiveFilterInUse = true;

  const runPageQuery = async (includeArchiveFilter: boolean) => {
    const query = buildBookingsQuery({
      includeArchiveFilter,
      includeArchived: normalized.includeArchived,
      statusFilter: normalized.statusFilter,
      lostToFirstDepositOnly: normalized.lostToFirstDepositOnly,
      q: normalized.q,
      dateFrom: normalized.dateFrom,
      dateTo: normalized.dateTo,
      cursor: normalized.cursor,
      limit: normalized.limit,
    });
    return dbQuery<BookingDbRow>(query.text, query.values);
  };

  const runCountQuery = async (includeArchiveFilter: boolean) => {
    const query = buildBookingsQuery(
      {
        includeArchiveFilter,
        includeArchived: normalized.includeArchived,
        statusFilter: normalized.statusFilter,
        lostToFirstDepositOnly: normalized.lostToFirstDepositOnly,
        q: normalized.q,
        dateFrom: normalized.dateFrom,
        dateTo: normalized.dateTo,
        cursor: null,
        limit: normalized.limit,
      },
      { countOnly: true },
    );
    return dbQuery<{ total_count: unknown }>(query.text, query.values);
  };

  let pageResult: Awaited<ReturnType<typeof dbQuery<BookingDbRow>>>;

  try {
    pageResult = await runPageQuery(true);
  } catch (error) {
    if (!normalized.includeArchived && isUndefinedColumn(error, "archived_at")) {
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
  if (overriddenByBookingIds.length > 0) {
    const overriddenBookings = await dbQuery<{ id: string; customer_name: string }>(
      "select b.id::text as id, c.full_name as customer_name from bookings b join customers c on c.id = b.customer_id where b.id::text = any($1::text[])",
      [overriddenByBookingIds],
    );
    for (const row of overriddenBookings.rows) {
      const customerName = String(row.customer_name ?? "").trim();
      if (customerName) {
        overriddenByNameByBookingId.set(String(row.id), customerName);
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
    const cancelledAtLabel = cancelledAtRaw ? fmtDateNoSeconds(cancelledAtRaw) : null;

    return {
      id: row.id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      vehicleLabel: `${row.vehicle_make} ${row.vehicle_model}`.trim(),
      datesLabel: `${fmtDateNoSeconds(row.start_date)} → ${fmtDateNoSeconds(row.end_date)}`,
      createdAtLabel: fmtDateNoSeconds(row.created_at),
      cancelledAtLabel,
      lostToFirstDeposit,
      status: row.status,
      statusLabel: formatBookingStatusLabel(row.status, String(pricing.payment_status ?? "")),
      substatusIndicators: resolveSubstatusIndicators({
        bookingStatus: row.status,
        pricing,
        nonBlocking,
        overriddenByBookingId: overrideInfo.overriddenByBookingId,
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
