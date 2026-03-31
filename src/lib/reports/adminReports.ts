import { dbQuery } from "@/lib/db";
import { buildBookingRangeWhere, buildRange } from "@/lib/bookings/dateRangeFilter";
import { dateOnlyUtc } from "@/lib/payments/dateMath";
import {
  isBlockingBookingHold,
  isNonBlockingBookingHold,
  normalizePaymentStatus,
  readHoldMinimumAmount,
  type Queryable,
} from "@/lib/payments/pricing";

export type ReportGranularity = "day" | "week" | "month";

export type ReportsFilterInput = {
  snapshotDate?: string | null;
  rangeFrom?: string | null;
  rangeTo?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  vehicleId?: string | null;
  pickupLocationType?: string | null;
  dropoffLocationType?: string | null;
  locationLabel?: string | null;
  revenueGranularity?: string | null;
};

export type ReportsFilters = {
  snapshotDate: string;
  rangeFrom: string;
  rangeTo: string;
  vehicleId: string;
  pickupLocationType: string;
  dropoffLocationType: string;
  locationLabel: string;
  revenueGranularity: ReportGranularity;
};

export type RevenuePoint = {
  periodStart: string;
  periodLabel: string;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  paymentCount: number;
};

export type RevenueReport = {
  granularity: ReportGranularity;
  totals: {
    grossRevenue: number;
    refunds: number;
    netRevenue: number;
    paymentCount: number;
  };
  points: RevenuePoint[];
};

export type UtilizationRow = {
  vehicleId: string;
  vehicleLabel: string;
  bookedDays: number;
  blockoutDays: number;
  availableDays: number;
  utilizationPercent: number;
};

export type UtilizationReport = {
  rangeDays: number;
  includesBlockouts: boolean;
  rows: UtilizationRow[];
};

export type OutstandingBalanceRow = {
  bookingId: string;
  bookingDbId: string;
  customerName: string;
  vehicleLabel: string;
  pickupDate: string;
  returnDate: string;
  status: string;
  paymentOption: string;
  paymentStatus: string;
  isNonBlocking: boolean;
  total: number;
  amountPaid: number;
  balanceDue: number;
  daysFromPickup: number;
};

export type OutstandingBalancesReport = {
  totals: {
    totalOutstandingAmount: number;
    outstandingCount: number;
  };
  rows: OutstandingBalanceRow[];
};

export type FunnelReport = {
  counts: {
    pendingPayment: number;
    confirmedActive: number;
    completedReturned: number;
    cancelled: number;
    overridden: number;
    totalCreated: number;
  };
  conversion: {
    pendingToConfirmed: number | null;
    confirmedToCompleted: number | null;
    cancellationRate: number | null;
  };
};

export type UpcomingRow = {
  bookingId: string;
  bookingDbId: string;
  customerName: string;
  vehicleLabel: string;
  status: string;
  paymentStatus: string;
  paymentOption: string;
  isNonBlocking: boolean;
  pickupDate: string;
  returnDate: string;
  eventDate: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
};

export type UpcomingPickupsReturnsReport = {
  pickups: UpcomingRow[];
  returns: UpcomingRow[];
};

export type CancellationRow = {
  bookingId: string;
  bookingDbId: string;
  customerName: string;
  vehicleLabel: string;
  status: string;
  isOverridden: boolean;
  cancelledAt: string;
  cancellationReason: string;
};

export type RefundRow = {
  paymentId: string;
  bookingId: string;
  bookingDbId: string;
  customerName: string;
  vehicleLabel: string;
  refundedAt: string;
  provider: string;
  amount: number;
};

export type CancellationBreakdownPoint = {
  periodStart: string;
  periodLabel: string;
  cancellations: number;
  refundTotal: number;
};

export type CancellationRefundImpactReport = {
  summary: {
    cancelledCount: number;
    refundCount: number;
    refundTotal: number;
    grossPayments: number;
    netImpact: number;
  };
  breakdown: CancellationBreakdownPoint[];
  cancellations: CancellationRow[];
  refunds: RefundRow[];
  excludedUnknownTimestampCount: number;
};

export type VehicleProfitabilityRow = {
  vehicleId: string;
  vehicleLabel: string;
  bookingCount: number;
  grossRevenue: number;
  refunds: number;
  maintenanceCost: number;
  netProfit: number;
  marginPercent: number;
};

export type VehicleProfitabilityReport = {
  totals: {
    vehicleCount: number;
    grossRevenue: number;
    refunds: number;
    maintenanceCost: number;
    netProfit: number;
  };
  includesMaintenanceData: boolean;
  rows: VehicleProfitabilityRow[];
};

export type ReportSectionMode = "operational" | "historical";

export type ReportSectionMeta = {
  mode: ReportSectionMode;
  dateBasisLabel: string;
  supportsExport: boolean;
  warnings: string[];
};

export type AdminReportsSectionMeta = {
  revenue: ReportSectionMeta;
  vehicleProfitability: ReportSectionMeta;
  utilization: ReportSectionMeta;
  outstandingBalances: ReportSectionMeta;
  agingReceivables: ReportSectionMeta;
  customerCohort: ReportSectionMeta;
  locationPerformance: ReportSectionMeta;
  funnel: ReportSectionMeta;
  upcoming: ReportSectionMeta;
  cancellationRefundImpact: ReportSectionMeta;
};

export type AgingReceivableBucketLabel = "Current" | "1-15 days" | "16-30 days" | "30+ days";

export type AgingReceivablesRow = {
  bookingId: string;
  bookingDbId: string;
  customerName: string;
  vehicleLabel: string;
  pickupDate: string;
  returnDate: string;
  balanceDue: number;
  daysPastDue: number;
  bucket: AgingReceivableBucketLabel;
};

export type AgingReceivablesReport = {
  totals: {
    totalOutstandingAmount: number;
    outstandingCount: number;
    overdueAmount: number;
    overdueCount: number;
  };
  buckets: Array<{
    label: AgingReceivableBucketLabel;
    count: number;
    amount: number;
  }>;
  rows: AgingReceivablesRow[];
};

export type CustomerCohortRow = {
  cohortMonth: string;
  cohortLabel: string;
  customerCount: number;
  bookingCount: number;
  revenue: number;
};

export type CustomerCohortReport = {
  summary: {
    totalCustomers: number;
    newCustomers: number;
    repeatCustomers: number;
    repeatRate: number | null;
  };
  rows: CustomerCohortRow[];
};

export type LocationPerformanceRow = {
  locationLabel: string;
  pickupLabel: string;
  dropoffLabel: string;
  pickupType: string;
  dropoffType: string;
  bookingCount: number;
  revenue: number;
  amountPaid: number;
  outstanding: number;
  cancellationCount: number;
};

export type LocationPerformanceReport = {
  totals: {
    bookingCount: number;
    revenue: number;
    amountPaid: number;
    outstanding: number;
    cancellationCount: number;
  };
  rows: LocationPerformanceRow[];
};

export type AdminReportsPayload = {
  filters: ReportsFilters;
  generatedAt: string;
  sectionMeta: AdminReportsSectionMeta;
  revenue: RevenueReport;
  vehicleProfitability: VehicleProfitabilityReport;
  utilization: UtilizationReport;
  outstandingBalances: OutstandingBalancesReport;
  agingReceivables: AgingReceivablesReport;
  customerCohort: CustomerCohortReport;
  locationPerformance: LocationPerformanceReport;
  funnel: FunnelReport;
  upcoming: UpcomingPickupsReturnsReport;
  cancellationRefundImpact: CancellationRefundImpactReport;
};

type CsvExportReportKey =
  | "cash_collections"
  | "vehicle_profitability"
  | "vehicle_utilization"
  | "outstanding_balances"
  | "aging_receivables"
  | "location_performance"
  | "booking_status_funnel"
  | "customer_cohort"
  | "pickups"
  | "returns"
  | "cancellations_refunds";

const NUMERIC_PATTERN = "^-?[0-9]+(\\.[0-9]+)?$";
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PAYMENT_SUCCESS_STATUSES = ["DEPOSIT_PAID", "SUCCESS"] as const;
const PAYMENT_NET_STATUSES = ["DEPOSIT_PAID", "SUCCESS", "REFUNDED"] as const;
const PICKUP_LOCATION_TYPE_SQL =
  "upper(coalesce(nullif(b.pricing_json->'booking_location_details'->'pickup'->>'typeKey', ''), nullif(b.pricing_json->'booking_location_details'->'pickup'->>'type', ''), 'UNKNOWN'))";
const DROPOFF_LOCATION_TYPE_SQL =
  "upper(coalesce(nullif(b.pricing_json->'booking_location_details'->'dropoff'->>'typeKey', ''), nullif(b.pricing_json->'booking_location_details'->'dropoff'->>'type', ''), 'UNKNOWN'))";
const PICKUP_LOCATION_LABEL_SQL =
  "coalesce(nullif(b.pricing_json->'booking_location_details'->'pickup'->>'label', ''), nullif(trim(b.pickup_location_text_snapshot), ''), nullif(trim(b.pickup_location), ''), 'Unknown')";
const DROPOFF_LOCATION_LABEL_SQL =
  `coalesce(nullif(b.pricing_json->'booking_location_details'->'dropoff'->>'label', ''), nullif(trim(b.dropoff_location_text_snapshot), ''), nullif(trim(b.dropoff_location), ''), ${PICKUP_LOCATION_LABEL_SQL})`;

/**
 * Canonical booking amount source for reports:
 * - Prefer persisted pricing_json totals captured at booking pricing time (computeBookingPricing snapshot)
 * - Fall back to legacy daily-rate math only when snapshot fields are missing
 */
const PROMO_DISCOUNT_SQL = `coalesce(
  case
    when coalesce(b.pricing_json->>'promo_discount_cents', '') ~ '${NUMERIC_PATTERN}' then (b.pricing_json->>'promo_discount_cents')::numeric
    else 0
  end,
  0
)`;

const SUBTOTAL_SQL = `coalesce(
  case
    when coalesce(b.pricing_json->>'subtotal_cents', '') ~ '${NUMERIC_PATTERN}' then (b.pricing_json->>'subtotal_cents')::numeric
    else null
  end,
  (v.daily_rate_cents::numeric * greatest((b.end_date - b.start_date + 1), 1))
)`;

const TOTAL_SQL = `greatest(
  0,
  coalesce(
    case
      when coalesce(b.pricing_json->>'total_cents', '') ~ '${NUMERIC_PATTERN}' then (b.pricing_json->>'total_cents')::numeric
      else null
    end,
    ${SUBTOTAL_SQL} - ${PROMO_DISCOUNT_SQL}
  )
)`;

function getQueryable(db?: Queryable) {
  if (db) return db;
  return {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };
}

function normalizeGranularity(value: unknown): ReportGranularity {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "week") return "week";
  if (normalized === "month") return "month";
  return "day";
}

function dateFromKey(value: unknown) {
  const date = dateOnlyUtc(value);
  if (!date) return "";
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeekMonday(date: Date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = copy.getUTCDay();
  const shift = weekday === 0 ? -6 : 1 - weekday;
  copy.setUTCDate(copy.getUTCDate() + shift);
  return copy;
}

function startOfUtcBucket(date: Date, granularity: ReportGranularity) {
  if (granularity === "month") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
  if (granularity === "week") {
    return startOfUtcWeekMonday(date);
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcBucket(date: Date, granularity: ReportGranularity) {
  const copy = new Date(date);
  if (granularity === "month") {
    copy.setUTCMonth(copy.getUTCMonth() + 1);
    return copy;
  }
  if (granularity === "week") {
    copy.setUTCDate(copy.getUTCDate() + 7);
    return copy;
  }
  copy.setUTCDate(copy.getUTCDate() + 1);
  return copy;
}

function bucketLabel(bucketStart: string, granularity: ReportGranularity) {
  if (granularity === "day") return bucketStart;
  if (granularity === "week") return `Week of ${bucketStart}`;
  return bucketStart.slice(0, 7);
}

function bucketExpression(column: string, granularity: ReportGranularity) {
  if (granularity === "month") return `date_trunc('month', ${column})::date`;
  if (granularity === "week") return `date_trunc('week', ${column})::date`;
  return `date_trunc('day', ${column})::date`;
}

function buildBucketSeries(dateFrom: string, dateTo: string, granularity: ReportGranularity) {
  const fromDate = dateOnlyUtc(`${dateFrom}T00:00:00Z`);
  const toDate = dateOnlyUtc(`${dateTo}T00:00:00Z`);
  if (!fromDate || !toDate) return [] as string[];
  const start = startOfUtcBucket(fromDate, granularity);
  const end = startOfUtcBucket(toDate, granularity);
  const buckets: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addUtcBucket(cursor, granularity)) {
    buckets.push(dateFromKey(cursor));
  }
  return buckets;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function normalizeRevenueBarWidthPercent(value: number, maxValue: number, minPercent = 2) {
  const safeValue = asNumber(value);
  const safeMax = asNumber(maxValue);
  if (safeValue <= 0 || safeMax <= 0) return 0;
  const normalized = clampPercent((safeValue / safeMax) * 100);
  return Math.max(Math.min(minPercent, 100), normalized);
}

export function summarizeRevenuePoints(points: RevenuePoint[]) {
  return {
    grossRevenue: points.reduce((sum, point) => sum + asNumber(point.grossRevenue), 0),
    refunds: points.reduce((sum, point) => sum + asNumber(point.refunds), 0),
    netRevenue: points.reduce((sum, point) => sum + asNumber(point.netRevenue), 0),
    paymentCount: points.reduce((sum, point) => sum + asNumber(point.paymentCount), 0),
  };
}

export function summarizeOutstandingBalanceRows(
  rows: Array<{ balanceDue: number }>,
): OutstandingBalancesReport["totals"] {
  return {
    totalOutstandingAmount: rows.reduce((sum, row) => sum + asNumber(row.balanceDue), 0),
    outstandingCount: rows.length,
  };
}

function maybeText(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function toDateOnlyText(value: unknown) {
  const date = dateOnlyUtc(value);
  if (date) return dateFromKey(date);
  if (typeof value === "string") return value;
  return "";
}

function toDateTimeText(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
}

function asNumber(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
}

function toCohortLabel(value: string) {
  const date = dateOnlyUtc(`${value}T00:00:00Z`);
  if (!date) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function agingBucketForDaysPastDue(daysPastDue: number): AgingReceivableBucketLabel {
  if (daysPastDue <= 0) return "Current";
  if (daysPastDue <= 15) return "1-15 days";
  if (daysPastDue <= 30) return "16-30 days";
  return "30+ days";
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function overlapDaysInclusive(
  rangeStart: unknown,
  rangeEnd: unknown,
  bookingStart: unknown,
  bookingEnd: unknown,
) {
  const rs = dateOnlyUtc(rangeStart);
  const re = dateOnlyUtc(rangeEnd);
  const bs = dateOnlyUtc(bookingStart);
  const be = dateOnlyUtc(bookingEnd);
  if (!rs || !re || !bs || !be) return 0;
  const start = bs > rs ? bs : rs;
  const end = be < re ? be : re;
  const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return days > 0 ? days : 0;
}

export function isDateInInclusiveRange(dateValue: unknown, rangeStart: unknown, rangeEnd: unknown) {
  const date = dateOnlyUtc(dateValue);
  const start = dateOnlyUtc(rangeStart);
  const end = dateOnlyUtc(rangeEnd);
  if (!date || !start || !end) return false;
  return date >= start && date <= end;
}

export function normalizeReportsFilters(input: ReportsFilterInput): ReportsFilters {
  const today = startOfUtcDay(dateOnlyUtc(new Date()) ?? new Date());
  const rawSnapshotDate =
    typeof input.snapshotDate === "string" && DATE_ONLY_PATTERN.test(input.snapshotDate)
      ? input.snapshotDate
      : null;
  const parsedSnapshot =
    dateOnlyUtc(rawSnapshotDate ? `${rawSnapshotDate}T00:00:00Z` : today) ?? today;
  const defaultRangeFrom = startOfUtcMonth(parsedSnapshot);
  const defaultRangeTo = parsedSnapshot;
  const rawRangeFrom =
    typeof input.rangeFrom === "string" && DATE_ONLY_PATTERN.test(input.rangeFrom)
      ? input.rangeFrom
      : typeof input.dateFrom === "string" && DATE_ONLY_PATTERN.test(input.dateFrom)
        ? input.dateFrom
        : null;
  const rawRangeTo =
    typeof input.rangeTo === "string" && DATE_ONLY_PATTERN.test(input.rangeTo)
      ? input.rangeTo
      : typeof input.dateTo === "string" && DATE_ONLY_PATTERN.test(input.dateTo)
        ? input.dateTo
        : null;

  const parsedFrom =
    dateOnlyUtc(rawRangeFrom ? `${rawRangeFrom}T00:00:00Z` : defaultRangeFrom) ?? defaultRangeFrom;
  const parsedTo =
    dateOnlyUtc(rawRangeTo ? `${rawRangeTo}T00:00:00Z` : defaultRangeTo) ?? defaultRangeTo;

  const fromDate = parsedFrom <= parsedTo ? parsedFrom : parsedTo;
  const toDate = parsedFrom <= parsedTo ? parsedTo : parsedFrom;

  return {
    snapshotDate: dateFromKey(parsedSnapshot),
    rangeFrom: dateFromKey(fromDate),
    rangeTo: dateFromKey(toDate),
    vehicleId: maybeText(input.vehicleId),
    pickupLocationType: maybeText(input.pickupLocationType).toUpperCase(),
    dropoffLocationType: maybeText(input.dropoffLocationType).toUpperCase(),
    locationLabel: maybeText(input.locationLabel),
    revenueGranularity: normalizeGranularity(input.revenueGranularity),
  };
}

function buildVehicleFilterClause(vehicleId: string, values: unknown[], prefix = "b.vehicle_id") {
  if (!vehicleId) return "";
  values.push(vehicleId);
  return ` and ${prefix} = $${values.length} `;
}

function buildLocationFilterClause(filters: ReportsFilters, values: unknown[]) {
  let clause = "";
  if (filters.pickupLocationType) {
    values.push(filters.pickupLocationType);
    clause += ` and ${PICKUP_LOCATION_TYPE_SQL} = $${values.length} `;
  }
  if (filters.dropoffLocationType) {
    values.push(filters.dropoffLocationType);
    clause += ` and ${DROPOFF_LOCATION_TYPE_SQL} = $${values.length} `;
  }
  if (filters.locationLabel) {
    values.push(filters.locationLabel);
    clause +=
      ` and (${PICKUP_LOCATION_LABEL_SQL} = $${values.length} or ${DROPOFF_LOCATION_LABEL_SQL} = $${values.length}) `;
  }
  return clause;
}

async function buildRevenueReport(db: Queryable, filters: ReportsFilters): Promise<RevenueReport> {
  const paymentValues: unknown[] = [
    filters.rangeFrom,
    filters.rangeTo,
    [...PAYMENT_SUCCESS_STATUSES],
    [...PAYMENT_NET_STATUSES],
  ];
  const paymentVehicleClause = buildVehicleFilterClause(filters.vehicleId, paymentValues, "b.vehicle_id");
  const paymentBucketSql = bucketExpression("p.created_at", filters.revenueGranularity);

  const paymentRows = await db.query(
    "select " +
      paymentBucketSql +
      " as bucket_start, " +
      "count(*) filter (where p.status = any($3::text[]) and p.deposit_amount_cents > 0)::int as payment_count, " +
      "coalesce(sum(case when p.status = any($3::text[]) and p.deposit_amount_cents > 0 then p.deposit_amount_cents else 0 end), 0)::numeric as gross_revenue, " +
      "coalesce(sum(case when p.status = 'REFUNDED' or p.deposit_amount_cents < 0 then abs(p.deposit_amount_cents) else 0 end), 0)::numeric as refunds, " +
      "coalesce(sum(case when p.status = any($4::text[]) then p.deposit_amount_cents else 0 end), 0)::numeric as net_revenue " +
      "from payments p join bookings b on b.id = p.booking_id " +
      "where p.deleted_at is null and p.created_at::date between $1 and $2 " +
      paymentVehicleClause +
      "group by 1 order by 1",
    paymentValues,
  );
  const buckets = buildBucketSeries(filters.rangeFrom, filters.rangeTo, filters.revenueGranularity);
  const rowsByBucket = new Map<string, RevenuePoint>();

  for (const bucket of buckets) {
    rowsByBucket.set(bucket, {
      periodStart: bucket,
      periodLabel: bucketLabel(bucket, filters.revenueGranularity),
      grossRevenue: 0,
      refunds: 0,
      netRevenue: 0,
      paymentCount: 0,
    });
  }

  for (const row of paymentRows.rows as Array<{
    bucket_start: string | Date;
    payment_count: number;
    gross_revenue: number;
    refunds: number;
    net_revenue: number;
  }>) {
    const bucket = dateFromKey(row.bucket_start);
    if (!rowsByBucket.has(bucket)) {
      rowsByBucket.set(bucket, {
        periodStart: bucket,
        periodLabel: bucketLabel(bucket, filters.revenueGranularity),
        grossRevenue: 0,
        refunds: 0,
        netRevenue: 0,
        paymentCount: 0,
      });
    }
    const current = rowsByBucket.get(bucket)!;
    current.paymentCount += asNumber(row.payment_count);
    current.grossRevenue += asNumber(row.gross_revenue);
    current.refunds += asNumber(row.refunds);
    current.netRevenue += asNumber(row.net_revenue);
  }

  const points = Array.from(rowsByBucket.values()).sort((a, b) =>
    a.periodStart.localeCompare(b.periodStart),
  );
  const totals = summarizeRevenuePoints(points);

  return {
    granularity: filters.revenueGranularity,
    totals,
    points,
  };
}

async function buildVehicleProfitabilityReport(
  db: Queryable,
  filters: ReportsFilters,
): Promise<VehicleProfitabilityReport> {
  const range = buildRange(filters.rangeFrom, filters.rangeTo);
  if (!range) {
    throw new Error("Unable to normalize reports date range.");
  }

  const bookingRangeWhere = buildBookingRangeWhere({
    rangeStart: range.rangeStartIso,
    rangeEnd: range.rangeEndIso,
    bookingAlias: "b",
  });
  const bookingValues: unknown[] = [...bookingRangeWhere.values];
  const vehicleClause = buildVehicleFilterClause(filters.vehicleId, bookingValues, "b.vehicle_id");

  const bookingRows = await db.query(
    "select b.vehicle_id, " +
      "count(*)::int as booking_count, " +
      `coalesce(sum(${TOTAL_SQL}), 0)::numeric as gross_revenue, ` +
      "coalesce(sum(( " +
      "  select coalesce(sum(case when p.status = 'REFUNDED' or p.deposit_amount_cents < 0 then abs(p.deposit_amount_cents) else 0 end), 0)::numeric " +
      "  from payments p where p.booking_id = b.id and p.deleted_at is null " +
      ")), 0)::numeric as refunds " +
      "from bookings b " +
      "join vehicles v on v.id = b.vehicle_id " +
      `where ${bookingRangeWhere.clause} ` +
      "and b.status not in ('CANCELLED','OVERRIDDEN') " +
      "and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = '' " +
      vehicleClause +
      "group by b.vehicle_id",
    bookingValues,
  );

  const maintenanceValues: unknown[] = [filters.rangeFrom, filters.rangeTo];
  const maintenanceVehicleClause = buildVehicleFilterClause(
    filters.vehicleId,
    maintenanceValues,
    "m.vehicle_id",
  );
  let maintenanceRows:
    | {
        rows: Array<{
          vehicle_id: string;
          maintenance_cost: number;
        }>;
      }
    | { rows: [] } = { rows: [] };
  let includesMaintenanceData = true;
  try {
    maintenanceRows = await db.query(
      "select m.vehicle_id, " +
        "coalesce(sum(coalesce(m.total_cost_cents, coalesce(m.labor_cost_cents, 0) + coalesce(m.parts_cost_cents, 0) + coalesce(m.tax_cost_cents, 0))), 0)::numeric as maintenance_cost " +
        "from vehicle_maintenance_records m " +
        "where m.archived_at is null " +
        "and coalesce(m.service_date, m.scheduled_date, m.created_at::date) between $1 and $2 " +
        maintenanceVehicleClause +
        "group by m.vehicle_id",
      maintenanceValues,
    ) as {
      rows: Array<{
        vehicle_id: string;
        maintenance_cost: number;
      }>;
    };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "42P01") throw error;
    includesMaintenanceData = false;
    maintenanceRows = { rows: [] };
  }

  const vehicleValues: unknown[] = [];
  const filteredVehicleClause = buildVehicleFilterClause(filters.vehicleId, vehicleValues, "v.id");
  const vehicles = await db.query(
    "select v.id, v.make, v.model, v.status from vehicles v where true " +
      filteredVehicleClause +
      "order by v.make, v.model",
    vehicleValues,
  );

  const vehicleLabelById = new Map<string, string>();
  for (const row of vehicles.rows as Array<{ id: string; make: string; model: string; status?: string }>) {
    const suffix = String(row.status ?? "").toUpperCase() === "INACTIVE" ? " (Inactive)" : "";
    vehicleLabelById.set(row.id, `${row.make} ${row.model}`.trim() + suffix);
  }

  const bookingsByVehicle = new Map<
    string,
    {
      bookingCount: number;
      grossRevenue: number;
      refunds: number;
    }
  >();
  for (const row of bookingRows.rows as Array<{
    vehicle_id: string;
    booking_count: number;
    gross_revenue: number;
    refunds: number;
  }>) {
    bookingsByVehicle.set(row.vehicle_id, {
      bookingCount: asNumber(row.booking_count),
      grossRevenue: asNumber(row.gross_revenue),
      refunds: asNumber(row.refunds),
    });
  }

  const maintenanceByVehicle = new Map<string, number>();
  for (const row of maintenanceRows.rows as Array<{ vehicle_id: string; maintenance_cost: number }>) {
    maintenanceByVehicle.set(row.vehicle_id, asNumber(row.maintenance_cost));
  }

  const vehicleIds = new Set<string>([
    ...Array.from(bookingsByVehicle.keys()),
    ...Array.from(maintenanceByVehicle.keys()),
  ]);
  if (filters.vehicleId) {
    vehicleIds.add(filters.vehicleId);
  }

  const rows: VehicleProfitabilityRow[] = Array.from(vehicleIds).map((vehicleId) => {
    const booking = bookingsByVehicle.get(vehicleId);
    const grossRevenue = booking?.grossRevenue ?? 0;
    const refunds = booking?.refunds ?? 0;
    const maintenanceCost = maintenanceByVehicle.get(vehicleId) ?? 0;
    const netProfit = grossRevenue - refunds - maintenanceCost;
    const marginPercent = grossRevenue > 0 ? clampPercent((netProfit / grossRevenue) * 100) : 0;

    return {
      vehicleId,
      vehicleLabel: vehicleLabelById.get(vehicleId) ?? "Unknown vehicle",
      bookingCount: booking?.bookingCount ?? 0,
      grossRevenue,
      refunds,
      maintenanceCost,
      netProfit,
      marginPercent,
    };
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.vehicleCount += 1;
      acc.grossRevenue += row.grossRevenue;
      acc.refunds += row.refunds;
      acc.maintenanceCost += row.maintenanceCost;
      acc.netProfit += row.netProfit;
      return acc;
    },
    {
      vehicleCount: 0,
      grossRevenue: 0,
      refunds: 0,
      maintenanceCost: 0,
      netProfit: 0,
    },
  );

  return { totals, includesMaintenanceData, rows };
}

function buildAgingReceivablesReport(
  outstandingBalances: OutstandingBalancesReport,
  snapshotDate: string,
): AgingReceivablesReport {
  const snapshot =
    dateOnlyUtc(`${snapshotDate}T00:00:00Z`) ?? startOfUtcDay(dateOnlyUtc(new Date()) ?? new Date());
  const dayMs = 1000 * 60 * 60 * 24;

  const rows: AgingReceivablesRow[] = outstandingBalances.rows
    .map((row) => {
      const dueDate = dateOnlyUtc(`${row.pickupDate}T00:00:00Z`) ?? dateOnlyUtc(row.pickupDate);
      const daysPastDue =
        dueDate === null
          ? 0
          : Math.max(0, Math.floor((snapshot.getTime() - dueDate.getTime()) / dayMs));
      const bucket = agingBucketForDaysPastDue(daysPastDue);
      return {
        bookingId: row.bookingId,
        bookingDbId: row.bookingDbId,
        customerName: row.customerName,
        vehicleLabel: row.vehicleLabel,
        pickupDate: row.pickupDate,
        returnDate: row.returnDate,
        balanceDue: row.balanceDue,
        daysPastDue,
        bucket,
      };
    })
    .sort((left, right) => {
      const byDays = right.daysPastDue - left.daysPastDue;
      if (byDays !== 0) return byDays;
      const byAmount = right.balanceDue - left.balanceDue;
      if (byAmount !== 0) return byAmount;
      return left.bookingId.localeCompare(right.bookingId);
    });

  const bucketOrder: AgingReceivableBucketLabel[] = [
    "Current",
    "1-15 days",
    "16-30 days",
    "30+ days",
  ];
  const bucketMap = new Map<AgingReceivableBucketLabel, { count: number; amount: number }>();
  for (const bucket of bucketOrder) {
    bucketMap.set(bucket, { count: 0, amount: 0 });
  }
  for (const row of rows) {
    const current = bucketMap.get(row.bucket)!;
    current.count += 1;
    current.amount += row.balanceDue;
  }

  const overdueRows = rows.filter((row) => row.daysPastDue > 0);

  return {
    totals: {
      totalOutstandingAmount: rows.reduce((sum, row) => sum + row.balanceDue, 0),
      outstandingCount: rows.length,
      overdueAmount: overdueRows.reduce((sum, row) => sum + row.balanceDue, 0),
      overdueCount: overdueRows.length,
    },
    buckets: bucketOrder.map((label) => ({
      label,
      count: bucketMap.get(label)?.count ?? 0,
      amount: bucketMap.get(label)?.amount ?? 0,
    })),
    rows,
  };
}

async function buildCustomerCohortReport(
  db: Queryable,
  filters: ReportsFilters,
): Promise<CustomerCohortReport> {
  const values: unknown[] = [filters.rangeFrom, filters.rangeTo];
  const scopedVehicleClause = buildVehicleFilterClause(filters.vehicleId, values, "b.vehicle_id");

  const cohortRows = await db.query(
    "with scoped_bookings as (" +
      "  select b.customer_id, b.id, b.created_at::date as created_date, " +
      `    ${TOTAL_SQL} as total_amount ` +
      "  from bookings b " +
      "  join vehicles v on v.id = b.vehicle_id " +
      "  where b.created_at::date between $1 and $2 " +
      "    and b.status not in ('CANCELLED','OVERRIDDEN') " +
      "    and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = '' " +
      scopedVehicleClause +
      "), first_bookings as (" +
      "  select b.customer_id, min(b.created_at::date) as first_booking_date " +
      "  from bookings b " +
      "  where b.status not in ('CANCELLED','OVERRIDDEN') " +
      "    and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = '' " +
      "  group by b.customer_id" +
      ") " +
      "select date_trunc('month', f.first_booking_date)::date as cohort_month, " +
      "  count(distinct s.customer_id)::int as customer_count, " +
      "  count(*)::int as booking_count, " +
      "  coalesce(sum(s.total_amount), 0)::numeric as revenue " +
      "from scoped_bookings s " +
      "join first_bookings f on f.customer_id = s.customer_id " +
      "group by 1 " +
      "order by 1",
    values,
  );

  const summaryRow = await db.query(
    "with scoped_bookings as (" +
      "  select b.customer_id " +
      "  from bookings b " +
      "  where b.created_at::date between $1 and $2 " +
      "    and b.status not in ('CANCELLED','OVERRIDDEN') " +
      "    and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = '' " +
      scopedVehicleClause +
      "), first_bookings as (" +
      "  select b.customer_id, min(b.created_at::date) as first_booking_date " +
      "  from bookings b " +
      "  where b.status not in ('CANCELLED','OVERRIDDEN') " +
      "    and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = '' " +
      "  group by b.customer_id" +
      ") " +
      "select " +
      "  count(distinct s.customer_id)::int as total_customers, " +
      "  count(distinct case when f.first_booking_date between $1 and $2 then s.customer_id end)::int as new_customers, " +
      "  count(distinct case when f.first_booking_date < $1 then s.customer_id end)::int as repeat_customers " +
      "from scoped_bookings s " +
      "join first_bookings f on f.customer_id = s.customer_id",
    values,
  );

  const rows: CustomerCohortRow[] = (cohortRows.rows as Array<{
    cohort_month: string | Date;
    customer_count: number;
    booking_count: number;
    revenue: number;
  }>).map((row) => {
    const cohortMonth = dateFromKey(row.cohort_month);
    return {
      cohortMonth,
      cohortLabel: toCohortLabel(cohortMonth),
      customerCount: asNumber(row.customer_count),
      bookingCount: asNumber(row.booking_count),
      revenue: asNumber(row.revenue),
    };
  });

  const summary = (summaryRow.rows[0] ?? {}) as {
    total_customers?: number;
    new_customers?: number;
    repeat_customers?: number;
  };
  const totalCustomers = asNumber(summary.total_customers);
  const repeatCustomers = asNumber(summary.repeat_customers);

  return {
    summary: {
      totalCustomers,
      newCustomers: asNumber(summary.new_customers),
      repeatCustomers,
      repeatRate: totalCustomers > 0 ? clampPercent((repeatCustomers / totalCustomers) * 100) : null,
    },
    rows,
  };
}

async function buildLocationPerformanceReport(
  db: Queryable,
  filters: ReportsFilters,
): Promise<LocationPerformanceReport> {
  const values: unknown[] = [filters.rangeFrom, filters.rangeTo, [...PAYMENT_NET_STATUSES]];
  const vehicleClause = buildVehicleFilterClause(filters.vehicleId, values, "b.vehicle_id");
  const locationClause = buildLocationFilterClause(filters, values);

  const result = await db.query(
    "select " +
      `${PICKUP_LOCATION_LABEL_SQL} as location_label, ` +
      `${PICKUP_LOCATION_LABEL_SQL} as pickup_label, ` +
      `${DROPOFF_LOCATION_LABEL_SQL} as dropoff_label, ` +
      `${PICKUP_LOCATION_TYPE_SQL} as pickup_type, ` +
      `${DROPOFF_LOCATION_TYPE_SQL} as dropoff_type, ` +
      "count(*) filter (where upper(b.status) not in ('CANCELLED','OVERRIDDEN'))::int as booking_count, " +
      `coalesce(sum(case when upper(b.status) not in ('CANCELLED','OVERRIDDEN') then ${TOTAL_SQL} else 0 end), 0)::numeric as revenue, ` +
      "coalesce(sum(case when upper(b.status) not in ('CANCELLED','OVERRIDDEN') then (" +
      "  select coalesce(sum(case when p.status = any($3::text[]) then p.deposit_amount_cents else 0 end), 0)::numeric " +
      "  from payments p where p.booking_id = b.id and p.deleted_at is null" +
      ") else 0 end), 0)::numeric as amount_paid, " +
      "sum(case when upper(b.status) in ('CANCELLED','OVERRIDDEN') or coalesce(b.pricing_json->>'overridden_by_booking_id', '') <> '' then 1 else 0 end)::int as cancellation_count " +
      "from bookings b " +
      "join vehicles v on v.id = b.vehicle_id " +
      "where b.start_date between $1 and $2 " +
      vehicleClause +
      locationClause +
      "group by 1, 2, 3, 4, 5 " +
      "order by 1, 3",
    values,
  );

  const rows: LocationPerformanceRow[] = (result.rows as Array<{
    location_label: string;
    pickup_label: string;
    dropoff_label: string;
    pickup_type: string;
    dropoff_type: string;
    booking_count: number;
    revenue: number;
    amount_paid: number;
    cancellation_count: number;
  }>).map((row) => {
    const revenue = asNumber(row.revenue);
    const amountPaid = asNumber(row.amount_paid);
    return {
      locationLabel: maybeText(row.location_label) || "Unknown",
      pickupLabel: maybeText(row.pickup_label) || "Unknown",
      dropoffLabel: maybeText(row.dropoff_label) || maybeText(row.pickup_label) || "Unknown",
      pickupType: maybeText(row.pickup_type) || "UNKNOWN",
      dropoffType: maybeText(row.dropoff_type) || "UNKNOWN",
      bookingCount: asNumber(row.booking_count),
      revenue,
      amountPaid,
      outstanding: Math.max(0, revenue - amountPaid),
      cancellationCount: asNumber(row.cancellation_count),
    };
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.bookingCount += row.bookingCount;
      acc.revenue += row.revenue;
      acc.amountPaid += row.amountPaid;
      acc.outstanding += row.outstanding;
      acc.cancellationCount += row.cancellationCount;
      return acc;
    },
    {
      bookingCount: 0,
      revenue: 0,
      amountPaid: 0,
      outstanding: 0,
      cancellationCount: 0,
    },
  );

  return {
    totals,
    rows,
  };
}

async function buildUtilizationReport(db: Queryable, filters: ReportsFilters): Promise<UtilizationReport> {
  const rangeDays = overlapDaysInclusive(filters.rangeFrom, filters.rangeTo, filters.rangeFrom, filters.rangeTo);
  const vehicleValues: unknown[] = [];
  const vehicleClause = buildVehicleFilterClause(filters.vehicleId, vehicleValues, "v.id");

  const vehicles = await db.query(
    "select v.id, v.make, v.model, v.status from vehicles v where true " +
      vehicleClause +
      "order by v.make, v.model",
    vehicleValues,
  );

  const bookedValues: unknown[] = [filters.rangeFrom, filters.rangeTo];
  const bookedVehicleClause = buildVehicleFilterClause(filters.vehicleId, bookedValues, "b.vehicle_id");
  // Count a day as booked when any part of a booking touches that day boundary.
  const bookedRows = await db.query(
    "with range_days as (" +
      "  select generate_series($1::date, $2::date, interval '1 day')::date as day" +
      ") " +
      "select b.vehicle_id, count(distinct d.day)::int as booked_days " +
      "from bookings b " +
      "join range_days d on d.day between b.start_date and b.end_date " +
      "where b.status not in ('CANCELLED','OVERRIDDEN') " +
      "and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = '' " +
      bookedVehicleClause +
      "group by b.vehicle_id",
    bookedValues,
  );

  let includesBlockouts = true;
  let blockoutRows: { rows: unknown[] } = { rows: [] };
  const blockoutValues: unknown[] = [filters.rangeFrom, filters.rangeTo];
  const blockoutVehicleClause = buildVehicleFilterClause(filters.vehicleId, blockoutValues, "bo.vehicle_id");
  try {
    blockoutRows = await db.query(
      "with range_days as (" +
        "  select generate_series($1::date, $2::date, interval '1 day')::date as day" +
        ") " +
        "select bo.vehicle_id, count(distinct d.day)::int as blockout_days " +
        "from blockouts bo " +
        "join range_days d on d.day between bo.start_at::date and bo.end_at::date " +
        "where true " +
        blockoutVehicleClause +
        "group by bo.vehicle_id",
      blockoutValues,
    );
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42P01") {
      includesBlockouts = false;
      blockoutRows = { rows: [] };
    } else {
      throw error;
    }
  }

  const bookedByVehicle = new Map<string, number>();
  for (const row of bookedRows.rows as Array<{ vehicle_id: string; booked_days: number }>) {
    bookedByVehicle.set(row.vehicle_id, asNumber(row.booked_days));
  }

  const blockoutByVehicle = new Map<string, number>();
  for (const row of blockoutRows.rows as Array<{ vehicle_id: string; blockout_days: number }>) {
    blockoutByVehicle.set(row.vehicle_id, asNumber(row.blockout_days));
  }

  const rows: UtilizationRow[] = (vehicles.rows as Array<{ id: string; make: string; model: string; status?: string }>).map(
    (vehicle) => {
      const bookedDays = bookedByVehicle.get(vehicle.id) ?? 0;
      const blockoutDays = blockoutByVehicle.get(vehicle.id) ?? 0;
      const availableDays = Math.max(0, rangeDays - blockoutDays);
      const utilizationPercent =
        availableDays > 0 ? clampPercent((bookedDays / availableDays) * 100) : 0;

      return {
        vehicleId: vehicle.id,
        vehicleLabel:
          `${vehicle.make} ${vehicle.model}`.trim() +
          (String(vehicle.status ?? "").toUpperCase() === "INACTIVE" ? " (Inactive)" : ""),
        bookedDays,
        blockoutDays,
        availableDays,
        utilizationPercent,
      };
    },
  );

  return {
    rangeDays,
    includesBlockouts,
    rows,
  };
}

async function buildOutstandingBalancesReport(
  db: Queryable,
  filters: ReportsFilters,
): Promise<OutstandingBalancesReport> {
  const values: unknown[] = [filters.snapshotDate, [...PAYMENT_NET_STATUSES]];
  const vehicleClause = buildVehicleFilterClause(filters.vehicleId, values, "b.vehicle_id");

  const rows = await db.query(
    "with booking_financials as (" +
      "  select b.id, b.public_id, b.status, b.start_date, b.end_date, b.created_at, b.pricing_json, " +
      "    c.full_name as customer_name, v.make as vehicle_make, v.model as vehicle_model, " +
      `    ${TOTAL_SQL} as total_amount, ` +
      "    coalesce(( " +
      "      select sum(p.deposit_amount_cents)::numeric " +
      "      from payments p " +
      "      where p.booking_id = b.id and p.deleted_at is null and p.status = any($2::text[]) and p.created_at::date <= $1::date" +
      "    ), 0) as amount_paid " +
      "  from bookings b " +
      "  join customers c on c.id = b.customer_id " +
      "  join vehicles v on v.id = b.vehicle_id " +
      "  where b.created_at::date <= $1::date " +
      "    and b.status not in ('CANCELLED','OVERRIDDEN') " +
      "    and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = '' " +
      vehicleClause +
      ") " +
      "select id, public_id, status, start_date, end_date, pricing_json, customer_name, vehicle_make, vehicle_model, " +
      "  total_amount::numeric as total_amount, amount_paid::numeric as amount_paid, " +
      "  greatest(total_amount - amount_paid, 0)::numeric as balance_due, " +
      "  (start_date - $1::date)::int as days_from_pickup " +
      "from booking_financials " +
      "where greatest(total_amount - amount_paid, 0) > 0 " +
      "order by balance_due desc, start_date asc",
    values,
  );

  const mappedRows = (rows.rows as Array<{
    id: string;
    public_id: string | null;
    status: string;
    start_date: string | Date;
    end_date: string | Date;
    pricing_json: Record<string, unknown> | null;
    customer_name: string;
    vehicle_make: string;
    vehicle_model: string;
    total_amount: number;
    amount_paid: number;
    balance_due: number;
    days_from_pickup: number;
  }>).map((row) => {
    const pricing = row.pricing_json ?? {};
    const paymentStatus = normalizePaymentStatus(pricing.payment_status);
    const paymentOption = maybeText(pricing.payment_option_selected || "DEPOSIT").toUpperCase() || "DEPOSIT";
    const amountPaid = asNumber(row.amount_paid);
    const holdMinimumAmount = readHoldMinimumAmount(pricing);
    const bookingId = maybeText(row.public_id) || row.id;
    const isNonBlocking = isNonBlockingBookingHold({
      paymentStatus,
      amountPaid,
      holdMinimumAmount,
    });

    return {
      bookingId,
      bookingDbId: row.id,
      customerName: row.customer_name,
      vehicleLabel: `${row.vehicle_make} ${row.vehicle_model}`.trim(),
      pickupDate: toDateOnlyText(row.start_date),
      returnDate: toDateOnlyText(row.end_date),
      status: row.status,
      paymentOption,
      paymentStatus,
      isNonBlocking,
      total: asNumber(row.total_amount),
      amountPaid,
      balanceDue: asNumber(row.balance_due),
      daysFromPickup: asNumber(row.days_from_pickup),
    };
  });

  return {
    totals: summarizeOutstandingBalanceRows(mappedRows),
    rows: mappedRows,
  };
}

async function buildFunnelReport(db: Queryable, filters: ReportsFilters): Promise<FunnelReport> {
  const values: unknown[] = [filters.rangeFrom, filters.rangeTo];
  const vehicleClause = buildVehicleFilterClause(filters.vehicleId, values, "b.vehicle_id");

  const result = await db.query(
    "select " +
      "count(*)::int as total_created, " +
      "sum(case when upper(b.status) in ('PENDING_PAYMENT','PENDING') then 1 else 0 end)::int as pending_payment, " +
      "sum(case when upper(b.status) in ('CONFIRMED','PICKED_UP','ACTIVE') then 1 else 0 end)::int as confirmed_active, " +
      "sum(case when upper(b.status) in ('RETURNED','COMPLETED') then 1 else 0 end)::int as completed_returned, " +
      "sum(case when upper(b.status) = 'CANCELLED' and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = '' then 1 else 0 end)::int as cancelled, " +
      "sum(case when upper(b.status) = 'OVERRIDDEN' or coalesce(b.pricing_json->>'overridden_by_booking_id', '') <> '' then 1 else 0 end)::int as overridden " +
      "from bookings b " +
      "where b.created_at::date between $1 and $2 " +
      vehicleClause,
    values,
  );

  const row = (result.rows[0] ?? {}) as {
    total_created?: number;
    pending_payment?: number;
    confirmed_active?: number;
    completed_returned?: number;
    cancelled?: number;
    overridden?: number;
  };

  const counts = {
    pendingPayment: asNumber(row.pending_payment),
    confirmedActive: asNumber(row.confirmed_active),
    completedReturned: asNumber(row.completed_returned),
    cancelled: asNumber(row.cancelled),
    overridden: asNumber(row.overridden),
    totalCreated: asNumber(row.total_created),
  };

  return {
    counts,
    conversion: {
      pendingToConfirmed:
        counts.pendingPayment > 0 ? clampPercent((counts.confirmedActive / counts.pendingPayment) * 100) : null,
      confirmedToCompleted:
        counts.confirmedActive > 0
          ? clampPercent((counts.completedReturned / counts.confirmedActive) * 100)
          : null,
      cancellationRate:
        counts.totalCreated > 0
          ? clampPercent(((counts.cancelled + counts.overridden) / counts.totalCreated) * 100)
          : null,
    },
  };
}

async function buildUpcomingPickupsReturnsReport(
  db: Queryable,
  filters: ReportsFilters,
): Promise<UpcomingPickupsReturnsReport> {
  const values: unknown[] = [filters.rangeFrom, filters.rangeTo, [...PAYMENT_NET_STATUSES]];
  const vehicleClause = buildVehicleFilterClause(filters.vehicleId, values, "b.vehicle_id");

  const baseSelect =
    "select b.id, b.public_id, b.status, b.start_date, b.end_date, b.pricing_json, c.full_name as customer_name, v.make as vehicle_make, v.model as vehicle_model, " +
    `  ${TOTAL_SQL} as total_amount, ` +
    "  coalesce((select sum(p.deposit_amount_cents)::numeric from payments p where p.booking_id = b.id and p.deleted_at is null and p.status = any($3::text[])), 0) as amount_paid " +
    "from bookings b " +
    "join customers c on c.id = b.customer_id " +
    "join vehicles v on v.id = b.vehicle_id " +
    "where coalesce(b.pricing_json->>'overridden_by_booking_id', '') = '' " +
    "and (upper(b.status) in ('CONFIRMED','PICKED_UP','RETURNED','ACTIVE') or (upper(b.status) = 'PENDING_PAYMENT' and upper(coalesce(b.pricing_json->>'payment_option_selected', '')) in ('PAY_ON_PICKUP','NONE'))) " +
    vehicleClause;

  const pickups = await db.query(
    baseSelect + " and b.start_date between $1 and $2 order by b.start_date asc, b.created_at asc",
    values,
  );
  const returns = await db.query(
    baseSelect + " and b.end_date between $1 and $2 order by b.end_date asc, b.created_at asc",
    values,
  );

  const mapRows = (
    rows: Array<{
      id: string;
      public_id: string | null;
      status: string;
      start_date: string | Date;
      end_date: string | Date;
      pricing_json: Record<string, unknown> | null;
      customer_name: string;
      vehicle_make: string;
      vehicle_model: string;
      total_amount: number;
      amount_paid: number;
    }>,
    eventType: "pickup" | "return",
  ) =>
    rows.map((row) => {
      const pricing = row.pricing_json ?? {};
      const amountPaid = asNumber(row.amount_paid);
      const paymentStatus = normalizePaymentStatus(pricing.payment_status);
      const paymentOption = maybeText(pricing.payment_option_selected || "DEPOSIT").toUpperCase() || "DEPOSIT";
      const holdMinimumAmount = readHoldMinimumAmount(pricing);
      const bookingId = maybeText(row.public_id) || row.id;
      const isNonBlocking = isNonBlockingBookingHold({
        paymentStatus,
        amountPaid,
        holdMinimumAmount,
      });
      const total = asNumber(row.total_amount);
      const balanceDue = Math.max(0, total - amountPaid);

      return {
        bookingId,
        bookingDbId: row.id,
        customerName: row.customer_name,
        vehicleLabel: `${row.vehicle_make} ${row.vehicle_model}`.trim(),
        status: row.status,
        paymentStatus,
        paymentOption,
        isNonBlocking,
        pickupDate: toDateOnlyText(row.start_date),
        returnDate: toDateOnlyText(row.end_date),
        eventDate: toDateOnlyText(eventType === "pickup" ? row.start_date : row.end_date),
        total,
        amountPaid,
        balanceDue,
      };
    });

  return {
    pickups: mapRows(
      pickups.rows as Array<{
        id: string;
        public_id: string | null;
        status: string;
        start_date: string | Date;
        end_date: string | Date;
        pricing_json: Record<string, unknown> | null;
        customer_name: string;
        vehicle_make: string;
        vehicle_model: string;
        total_amount: number;
        amount_paid: number;
      }>,
      "pickup",
    ),
    returns: mapRows(
      returns.rows as Array<{
        id: string;
        public_id: string | null;
        status: string;
        start_date: string | Date;
        end_date: string | Date;
        pricing_json: Record<string, unknown> | null;
        customer_name: string;
        vehicle_make: string;
        vehicle_model: string;
        total_amount: number;
        amount_paid: number;
      }>,
      "return",
    ),
  };
}

async function buildCancellationRefundImpactReport(
  db: Queryable,
  filters: ReportsFilters,
): Promise<CancellationRefundImpactReport> {
  const cancellationEventExpr =
    "case " +
    "  when upper(b.status) = 'OVERRIDDEN' or coalesce(b.pricing_json->>'overridden_by_booking_id', '') <> '' then " +
    "    case when coalesce(b.pricing_json->>'overridden_at', '') ~ '^\\d{4}-\\d{2}-\\d{2}T' then (b.pricing_json->>'overridden_at')::timestamptz end " +
    "  else " +
    "    coalesce( " +
    "      case when coalesce(b.pricing_json->>'cancelled_at', '') ~ '^\\d{4}-\\d{2}-\\d{2}T' then (b.pricing_json->>'cancelled_at')::timestamptz end, " +
    "      cancel_audit.created_at " +
    "    ) " +
    "end";
  const cancellationValues: unknown[] = [filters.rangeFrom, filters.rangeTo];
  const cancellationVehicleClause = buildVehicleFilterClause(filters.vehicleId, cancellationValues, "b.vehicle_id");

  const cancellationRows = await db.query(
    "select b.id, b.public_id, b.status, c.full_name as customer_name, v.make as vehicle_make, v.model as vehicle_model, " +
      `${cancellationEventExpr} as cancelled_at, ` +
      "coalesce(nullif(b.pricing_json->>'override_reason', ''), nullif(b.pricing_json->>'cancel_reason', ''), '') as cancellation_reason, " +
      "(upper(b.status) = 'OVERRIDDEN' or coalesce(b.pricing_json->>'overridden_by_booking_id', '') <> '') as is_overridden " +
      "from bookings b " +
      "join customers c on c.id = b.customer_id " +
      "join vehicles v on v.id = b.vehicle_id " +
      "left join lateral (" +
      "  select a.created_at " +
      "  from audit_logs a " +
      "  where a.entity_type = 'booking' and a.entity_id = b.id and a.action in ('BOOKING_CANCELLED','BOOKING_CANCELLED_BY_BLOCKOUT') " +
      "  order by a.created_at asc " +
      "  limit 1" +
      ") cancel_audit on true " +
      "where (upper(b.status) = 'CANCELLED' or upper(b.status) = 'OVERRIDDEN') " +
      `and ${cancellationEventExpr} is not null ` +
      `and ${cancellationEventExpr}::date between $1 and $2 ` +
      cancellationVehicleClause +
      "order by cancelled_at desc",
    cancellationValues,
  );

  const unknownTimestampValues: unknown[] = [];
  const unknownTimestampVehicleClause = buildVehicleFilterClause(
    filters.vehicleId,
    unknownTimestampValues,
    "b.vehicle_id",
  );
  const unknownTimestampResult = await db.query(
    "select count(*)::int as excluded_count " +
      "from bookings b " +
      "left join lateral (" +
      "  select a.created_at " +
      "  from audit_logs a " +
      "  where a.entity_type = 'booking' and a.entity_id = b.id and a.action in ('BOOKING_CANCELLED','BOOKING_CANCELLED_BY_BLOCKOUT') " +
      "  order by a.created_at asc " +
      "  limit 1" +
      ") cancel_audit on true " +
      "where (upper(b.status) = 'CANCELLED' or upper(b.status) = 'OVERRIDDEN') " +
      `and ${cancellationEventExpr} is null ` +
      unknownTimestampVehicleClause,
    unknownTimestampValues,
  );

  const refundListValues: unknown[] = [filters.rangeFrom, filters.rangeTo];
  const refundListVehicleClause = buildVehicleFilterClause(
    filters.vehicleId,
    refundListValues,
    "b.vehicle_id",
  );
  const refunds = await db.query(
    "select p.id, p.booking_id, b.public_id as booking_public_id, p.provider, p.status, p.created_at, p.deposit_amount_cents, c.full_name as customer_name, v.make as vehicle_make, v.model as vehicle_model " +
      "from payments p join bookings b on b.id = p.booking_id join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
      "where p.deleted_at is null and (p.status = 'REFUNDED' or p.deposit_amount_cents < 0) and p.created_at::date between $1 and $2 " +
      refundListVehicleClause +
      "order by p.created_at desc",
    refundListValues,
  );

  const grossNetValues: unknown[] = [filters.rangeFrom, filters.rangeTo, [...PAYMENT_SUCCESS_STATUSES]];
  const grossNetVehicleClause = buildVehicleFilterClause(
    filters.vehicleId,
    grossNetValues,
    "b.vehicle_id",
  );
  const grossNet = await db.query(
    "select " +
      "coalesce(sum(case when p.status = any($3::text[]) and p.deposit_amount_cents > 0 then p.deposit_amount_cents else 0 end), 0)::numeric as gross_payments, " +
      "coalesce(sum(case when p.status = 'REFUNDED' or p.deposit_amount_cents < 0 then abs(p.deposit_amount_cents) else 0 end), 0)::numeric as refund_total " +
      "from payments p join bookings b on b.id = p.booking_id " +
      "where p.deleted_at is null and p.created_at::date between $1 and $2 " +
      grossNetVehicleClause,
    grossNetValues,
  );

  const breakdownBuckets = buildBucketSeries(filters.rangeFrom, filters.rangeTo, filters.revenueGranularity);
  const breakdownMap = new Map<string, CancellationBreakdownPoint>();
  for (const bucket of breakdownBuckets) {
    breakdownMap.set(bucket, {
      periodStart: bucket,
      periodLabel: bucketLabel(bucket, filters.revenueGranularity),
      cancellations: 0,
      refundTotal: 0,
    });
  }

  const cancellationBreakdown = await db.query(
    "select " +
      bucketExpression(cancellationEventExpr, filters.revenueGranularity) +
      " as bucket_start, count(*)::int as cancellations " +
      "from bookings b " +
      "left join lateral (" +
      "  select a.created_at " +
      "  from audit_logs a " +
      "  where a.entity_type = 'booking' and a.entity_id = b.id and a.action in ('BOOKING_CANCELLED','BOOKING_CANCELLED_BY_BLOCKOUT') " +
      "  order by a.created_at asc " +
      "  limit 1" +
      ") cancel_audit on true " +
      "where (upper(b.status) = 'CANCELLED' or upper(b.status) = 'OVERRIDDEN') " +
      `and ${cancellationEventExpr} is not null ` +
      `and ${cancellationEventExpr}::date between $1 and $2 ` +
      (filters.vehicleId ? "and b.vehicle_id = $3 " : "") +
      "group by 1 order by 1",
    filters.vehicleId
      ? [filters.rangeFrom, filters.rangeTo, filters.vehicleId]
      : [filters.rangeFrom, filters.rangeTo],
  );

  const refundBreakdownValues: unknown[] = [filters.rangeFrom, filters.rangeTo];
  const refundBreakdownVehicleClause = buildVehicleFilterClause(filters.vehicleId, refundBreakdownValues, "b.vehicle_id");
  const refundBreakdown = await db.query(
    "select " +
      bucketExpression("p.created_at", filters.revenueGranularity) +
      " as bucket_start, " +
      "coalesce(sum(case when p.status = 'REFUNDED' or p.deposit_amount_cents < 0 then abs(p.deposit_amount_cents) else 0 end), 0)::numeric as refund_total " +
      "from payments p join bookings b on b.id = p.booking_id " +
      "where p.deleted_at is null and p.created_at::date between $1 and $2 " +
      refundBreakdownVehicleClause +
      "group by 1 order by 1",
    refundBreakdownValues,
  );

  for (const row of cancellationBreakdown.rows as Array<{ bucket_start: string | Date; cancellations: number }>) {
    const bucket = dateFromKey(row.bucket_start);
    if (!breakdownMap.has(bucket)) {
      breakdownMap.set(bucket, {
        periodStart: bucket,
        periodLabel: bucketLabel(bucket, filters.revenueGranularity),
        cancellations: 0,
        refundTotal: 0,
      });
    }
    breakdownMap.get(bucket)!.cancellations += asNumber(row.cancellations);
  }

  for (const row of refundBreakdown.rows as Array<{ bucket_start: string | Date; refund_total: number }>) {
    const bucket = dateFromKey(row.bucket_start);
    if (!breakdownMap.has(bucket)) {
      breakdownMap.set(bucket, {
        periodStart: bucket,
        periodLabel: bucketLabel(bucket, filters.revenueGranularity),
        cancellations: 0,
        refundTotal: 0,
      });
    }
    breakdownMap.get(bucket)!.refundTotal += asNumber(row.refund_total);
  }

  const grossSummary = (grossNet.rows[0] ?? {}) as {
    gross_payments?: number;
    refund_total?: number;
  };
  const excludedUnknownTimestampCount = asNumber(
    (unknownTimestampResult.rows[0] as { excluded_count?: number } | undefined)?.excluded_count,
  );

  const mappedCancellations: CancellationRow[] = (cancellationRows.rows as Array<{
    id: string;
    public_id: string | null;
    status: string;
    customer_name: string;
    vehicle_make: string;
    vehicle_model: string;
    cancelled_at: string | Date;
    cancellation_reason: string;
    is_overridden: boolean;
  }>).map((row) => ({
    bookingId: maybeText(row.public_id) || row.id,
    bookingDbId: row.id,
    customerName: row.customer_name,
    vehicleLabel: `${row.vehicle_make} ${row.vehicle_model}`.trim(),
    status: row.status,
    isOverridden: Boolean(row.is_overridden),
    cancelledAt: toDateTimeText(row.cancelled_at),
    cancellationReason: maybeText(row.cancellation_reason),
  }));

  const mappedRefunds: RefundRow[] = (refunds.rows as Array<{
    id: string;
    booking_id: string;
    booking_public_id: string | null;
    provider: string;
    status: string;
    created_at: string | Date;
    deposit_amount_cents: number;
    customer_name: string;
    vehicle_make: string;
    vehicle_model: string;
  }>).map((row) => ({
    paymentId: row.id,
    bookingId: maybeText(row.booking_public_id) || row.booking_id,
    bookingDbId: row.booking_id,
    customerName: row.customer_name,
    vehicleLabel: `${row.vehicle_make} ${row.vehicle_model}`.trim(),
    refundedAt: toDateTimeText(row.created_at),
    provider: row.provider,
    amount: Math.abs(asNumber(row.deposit_amount_cents)),
  }));

  const grossPayments = asNumber(grossSummary.gross_payments);
  const refundTotal = asNumber(grossSummary.refund_total);

  return {
    summary: {
      cancelledCount: mappedCancellations.length,
      refundCount: mappedRefunds.length,
      refundTotal,
      grossPayments,
      netImpact: grossPayments - refundTotal,
    },
    breakdown: Array.from(breakdownMap.values()).sort((a, b) =>
      a.periodStart.localeCompare(b.periodStart),
    ),
    cancellations: mappedCancellations,
    refunds: mappedRefunds,
    excludedUnknownTimestampCount,
  };
}

export async function getAdminReportsPayload(
  filtersInput: ReportsFilterInput,
  options: { db?: Queryable } = {},
): Promise<AdminReportsPayload> {
  const db = getQueryable(options.db);
  const filters = normalizeReportsFilters(filtersInput);

  const [
    revenue,
    vehicleProfitability,
    utilization,
    outstandingBalances,
    customerCohort,
    locationPerformance,
    funnel,
    upcoming,
    cancellationRefundImpact,
  ] =
    await Promise.all([
      buildRevenueReport(db, filters),
      buildVehicleProfitabilityReport(db, filters),
      buildUtilizationReport(db, filters),
      buildOutstandingBalancesReport(db, filters),
      buildCustomerCohortReport(db, filters),
      buildLocationPerformanceReport(db, filters),
      buildFunnelReport(db, filters),
      buildUpcomingPickupsReturnsReport(db, filters),
      buildCancellationRefundImpactReport(db, filters),
    ]);
  const agingReceivables = buildAgingReceivablesReport(outstandingBalances, filters.snapshotDate);
  const sectionMeta: AdminReportsSectionMeta = {
    revenue: {
      mode: "historical",
      dateBasisLabel: "By payment date",
      supportsExport: true,
      warnings: [],
    },
    vehicleProfitability: {
      mode: "historical",
      dateBasisLabel: "By booking overlap",
      supportsExport: true,
      warnings: vehicleProfitability.includesMaintenanceData
        ? []
        : ["Maintenance records table not found. Maintenance costs are excluded from this section."],
    },
    utilization: {
      mode: "historical",
      dateBasisLabel: "By booking overlap",
      supportsExport: true,
      warnings: utilization.includesBlockouts
        ? []
        : ["Blockouts table not found. Utilization is based on booked days only."],
    },
    outstandingBalances: {
      mode: "operational",
      dateBasisLabel: "As of snapshot date",
      supportsExport: true,
      warnings: [],
    },
    agingReceivables: {
      mode: "operational",
      dateBasisLabel: "Aged from pickup due date as of snapshot date",
      supportsExport: true,
      warnings: [],
    },
    customerCohort: {
      mode: "historical",
      dateBasisLabel: "By booking created date",
      supportsExport: true,
      warnings: [],
    },
    locationPerformance: {
      mode: "historical",
      dateBasisLabel: "By pickup date",
      supportsExport: true,
      warnings: [],
    },
    funnel: {
      mode: "historical",
      dateBasisLabel: "By booking created date",
      supportsExport: true,
      warnings: [],
    },
    upcoming: {
      mode: "operational",
      dateBasisLabel: "By pickup and return date",
      supportsExport: true,
      warnings: [],
    },
    cancellationRefundImpact: {
      mode: "historical",
      dateBasisLabel: "Cancellations by canonical event date; refunds by payment date",
      supportsExport: true,
      warnings:
        cancellationRefundImpact.excludedUnknownTimestampCount > 0
          ? [
              `${cancellationRefundImpact.excludedUnknownTimestampCount} cancellation or override record(s) were excluded because no canonical event timestamp was found.`,
            ]
          : [],
    },
  };

  return {
    filters,
    generatedAt: new Date().toISOString(),
    sectionMeta,
    revenue,
    vehicleProfitability,
    utilization,
    outstandingBalances,
    agingReceivables,
    customerCohort,
    locationPerformance,
    funnel,
    upcoming,
    cancellationRefundImpact,
  };
}

function toCsv(header: string[], rows: Array<Array<unknown>>) {
  const lines = [header.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

export function exportOutstandingBalancesCsv(payload: AdminReportsPayload) {
  const rows = payload.outstandingBalances.rows.map((row) => [
    row.bookingId,
    row.customerName,
    row.vehicleLabel,
    row.pickupDate,
    row.returnDate,
    row.status,
    row.paymentOption,
    row.paymentStatus,
    row.total,
    row.amountPaid,
    row.balanceDue,
    row.daysFromPickup,
  ]);

  return toCsv(
    [
      "booking_id",
      "customer_name",
      "vehicle",
      "pickup_date",
      "return_date",
      "status",
      "payment_option",
      "payment_status",
      "total",
      "amount_paid",
      "balance_due",
      "days_from_pickup",
    ],
    rows,
  );
}

export function exportPickupsCsv(payload: AdminReportsPayload) {
  const rows = payload.upcoming.pickups.map((row) => [
    row.bookingId,
    row.customerName,
    row.vehicleLabel,
    row.pickupDate,
    row.returnDate,
    row.status,
    row.paymentOption,
    row.paymentStatus,
    row.isNonBlocking ? "yes" : "no",
    row.total,
    row.amountPaid,
    row.balanceDue,
  ]);

  return toCsv(
    [
      "booking_id",
      "customer_name",
      "vehicle",
      "pickup_date",
      "return_date",
      "status",
      "payment_option",
      "payment_status",
      "non_blocking",
      "total",
      "amount_paid",
      "balance_due",
    ],
    rows,
  );
}

export function exportReturnsCsv(payload: AdminReportsPayload) {
  const rows = payload.upcoming.returns.map((row) => [
    row.bookingId,
    row.customerName,
    row.vehicleLabel,
    row.pickupDate,
    row.returnDate,
    row.status,
    row.paymentOption,
    row.paymentStatus,
    row.isNonBlocking ? "yes" : "no",
    row.total,
    row.amountPaid,
    row.balanceDue,
  ]);

  return toCsv(
    [
      "booking_id",
      "customer_name",
      "vehicle",
      "pickup_date",
      "return_date",
      "status",
      "payment_option",
      "payment_status",
      "non_blocking",
      "total",
      "amount_paid",
      "balance_due",
    ],
    rows,
  );
}

export function exportCancellationsRefundsCsv(payload: AdminReportsPayload) {
  const cancellationRows = payload.cancellationRefundImpact.cancellations.map((row) => [
    "cancellation",
    row.bookingId,
    row.customerName,
    row.vehicleLabel,
    row.status,
    row.isOverridden ? "yes" : "no",
    row.cancelledAt,
    row.cancellationReason,
    "",
    "",
  ]);

  const refundRows = payload.cancellationRefundImpact.refunds.map((row) => [
    "refund",
    row.bookingId,
    row.customerName,
    row.vehicleLabel,
    "",
    "",
    row.refundedAt,
    "",
    row.paymentId,
    row.amount,
  ]);

  return toCsv(
    [
      "row_type",
      "booking_id",
      "customer_name",
      "vehicle",
      "status",
      "is_overridden",
      "event_at",
      "reason",
      "payment_id",
      "amount",
    ],
    [...cancellationRows, ...refundRows],
  );
}

export function exportReportsCsvByKey(key: CsvExportReportKey, payload: AdminReportsPayload) {
  if (key === "outstanding_balances") return exportOutstandingBalancesCsv(payload);
  if (key === "pickups") return exportPickupsCsv(payload);
  if (key === "returns") return exportReturnsCsv(payload);
  return exportCancellationsRefundsCsv(payload);
}

export function isCsvExportReportKey(value: unknown): value is CsvExportReportKey {
  return (
    value === "outstanding_balances" ||
    value === "pickups" ||
    value === "returns" ||
    value === "cancellations_refunds"
  );
}

export function buildReportsFilterQueryString(filters: ReportsFilters) {
  const params = new URLSearchParams();
  params.set("snapshotDate", filters.snapshotDate);
  params.set("rangeFrom", filters.rangeFrom);
  params.set("rangeTo", filters.rangeTo);
  if (filters.vehicleId) params.set("vehicleId", filters.vehicleId);
  if (filters.pickupLocationType) params.set("pickupLocationType", filters.pickupLocationType);
  if (filters.dropoffLocationType) params.set("dropoffLocationType", filters.dropoffLocationType);
  if (filters.locationLabel) params.set("locationLabel", filters.locationLabel);
  params.set("revenueGranularity", filters.revenueGranularity);
  return params.toString();
}

export function isBlockingFromPricing(input: {
  paymentStatus: unknown;
  amountPaid: unknown;
  holdMinimumAmount: unknown;
}) {
  return isBlockingBookingHold(input);
}
