import Link from "next/link";

import { InfoTooltipIcon } from "@/components/admin/InfoTooltipIcon";
import { MobileTableAffordance } from "@/components/admin/MobileTableAffordance";
import { PaginationSummaryNav } from "@/components/admin/PaginationSummaryNav";
import { ReportsGranularityTabs } from "@/components/admin/ReportsGranularityTabs";
import { AdminPillTabs } from "@/components/admin/AdminPillTabs";
import { SortableTh } from "@/components/admin/SortableTh";
import { nextSort, normalizeSortDir, type SortDir } from "@/components/admin/tableSort";
import { DateRangeArrow } from "@/components/shared/DateRangeArrow";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { dbQuery } from "@/lib/db";
import { fmtDateOnly } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import {
  normalizePageSize,
  paginateRows,
  STANDARD_PAGE_SIZE_OPTIONS,
  type StandardPageSize,
} from "@/lib/pagination/sharedPagination";
import {
  buildReportsFilterQueryString,
  getAdminReportsPayload,
  normalizeRevenueBarWidthPercent,
} from "@/lib/reports/adminReports";

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  status?: string;
};

type ReportExportFormat = "csv" | "excel" | "pdf";
type ReportExportKey =
  | "cash_collections"
  | "vehicle_profitability"
  | "vehicle_utilization"
  | "outstanding_balances"
  | "aging_receivables"
  | "location_performance"
  | "booking_status_funnel"
  | "customer_cohort"
  | "upcoming_combined"
  | "cancellations_refunds";
type ReportCardKey =
  | "revenue"
  | "profitability"
  | "utilization"
  | "outstanding"
  | "aging"
  | "location"
  | "funnel"
  | "cohort"
  | "upcoming"
  | "impact";
type ImpactPageSize = 5 | 10 | 20 | 30 | 50;
type ReportGroup = "all" | "financial" | "operations" | "customer";
const AGING_BUCKET_FILTERS = [
  { key: "current", label: "Current" },
  { key: "1-15-days", label: "1-15 days" },
  { key: "16-30-days", label: "16-30 days" },
  { key: "30-plus-days", label: "30+ days" },
] as const;
const OUTSTANDING_BUCKET_FILTER_KEYS = [
  "pastPickup",
  "upcomingPickup",
  "payOnPickup",
  "pendingPayment",
] as const;
type AgingBucketFilter = (typeof AGING_BUCKET_FILTERS)[number];
type AgingBucketFilterKey = AgingBucketFilter["key"];
type AgingBucketFilterLabel = AgingBucketFilter["label"];
type OutstandingBucketFilterKey = (typeof OUTSTANDING_BUCKET_FILTER_KEYS)[number];
const PROFITABILITY_BUCKET_FILTER_KEYS = [
  "vehicles",
  "revenue",
  "refunds",
  "maintenance",
  "net",
] as const;
const LOCATION_BUCKET_FILTER_KEYS = [
  "bookings",
  "revenue",
  "paid",
  "outstanding",
  "cancellations",
] as const;
const COHORT_BUCKET_FILTER_KEYS = ["total", "new", "repeat", "rate"] as const;
const IMPACT_BUCKET_FILTER_KEYS = [
  "cancelled",
  "refundCount",
  "refundTotal",
  "grossPayments",
  "netImpact",
] as const;

const REPORT_CARD_EXPORT_KEYS = {
  revenue: "cash_collections",
  profitability: "vehicle_profitability",
  utilization: "vehicle_utilization",
  outstanding: "outstanding_balances",
  aging: "aging_receivables",
  location: "location_performance",
  funnel: "booking_status_funnel",
  cohort: "customer_cohort",
  upcoming: "upcoming_combined",
  impact: "cancellations_refunds",
} as const satisfies Record<ReportCardKey, ReportExportKey>;

const REPORT_CARDS = [
  {
    key: "revenue",
    group: "financial",
    title: "Cash Collections by Period",
    description:
      "Payment-based gross collections, refunds, and net cash movement grouped by the selected historical period.",
  },
  {
    key: "profitability",
    group: "financial",
    title: "Vehicle Profitability",
    description:
      "Vehicle-level gross revenue, refunds, maintenance costs, and net profit for the selected period.",
  },
  {
    key: "utilization",
    group: "operations",
    title: "Vehicle Utilization",
    description:
      "Booked days vs available days in the selected range. Booked-day overlap is counted by day boundary.",
  },
  {
    key: "outstanding",
    group: "financial",
    title: "Outstanding Balances",
    description:
      "Bookings with balance due, including pickup urgency and payment status for collection prioritization.",
  },
  {
    key: "aging",
    group: "financial",
    title: "Aging Receivables",
    description:
      "Outstanding balances grouped by how overdue they are, so collections can prioritize oldest receivables first.",
  },
  {
    key: "location",
    group: "operations",
    title: "Location Performance",
    description:
      "Pickup-location booking activity, amounts paid, and outstanding balances by pickup date in the selected historical range.",
  },
  {
    key: "funnel",
    group: "customer",
    title: "Booking Status Funnel",
    description:
      "Conversion from pending to confirmed to completed, with cancellation and overridden booking visibility.",
  },
  {
    key: "cohort",
    group: "customer",
    title: "Customer Cohort Report",
    description:
      "New vs repeat customers by first-booking cohort month, including booking volume and revenue contribution.",
  },
  {
    key: "upcoming",
    group: "operations",
    title: "Upcoming Pickups & Returns",
    description:
      "Operational pickup/return lists with status and outstanding balance indicators.",
  },
  {
    key: "impact",
    group: "financial",
    title: "Cancellation & Refund Impact",
    description:
      "Cancellation counts, refund totals, net impact, and period-based breakdown.",
  },
] as const;
const REPORT_GROUP_TABS: Array<{ key: ReportGroup; label: string }> = [
  { key: "all", label: "All Reports" },
  { key: "financial", label: "Financial" },
  { key: "operations", label: "Operations" },
  { key: "customer", label: "Customer" },
];
const REPORT_EXPORT_FORMAT_OPTIONS: Array<{ key: ReportExportFormat; label: string }> = [
  { key: "csv", label: "CSV" },
  { key: "pdf", label: "PDF" },
  { key: "excel", label: "Excel" },
];
const IMPACT_PAGE_SIZE_OPTIONS: ImpactPageSize[] = [5, 10, 20, 30, 50];
const REVENUE_SORT_COLUMNS = [
  "period",
  "gross",
  "refunds",
  "net",
  "payments",
] as const;
const PROFITABILITY_SORT_COLUMNS = [
  "vehicle",
  "bookings",
  "revenue",
  "refunds",
  "maintenance",
  "net",
  "margin",
] as const;
const UTILIZATION_SORT_COLUMNS = [
  "vehicle",
  "bookedDays",
  "availableDays",
  "blockoutDays",
  "utilization",
] as const;
const OUTSTANDING_SORT_COLUMNS = [
  "booking",
  "customer",
  "vehicle",
  "pickup",
  "return",
  "total",
  "paid",
  "balance",
  "timing",
  "status",
] as const;
const AGING_SORT_COLUMNS = [
  "booking",
  "customer",
  "vehicle",
  "dueDate",
  "balance",
  "daysPastDue",
  "bucket",
] as const;
const PICKUP_SORT_COLUMNS = ["booking", "customer", "vehicle", "pickup", "status", "balance"] as const;
const RETURN_SORT_COLUMNS = ["booking", "customer", "vehicle", "return", "status", "balance"] as const;
const COHORT_SORT_COLUMNS = ["cohort", "customers", "bookings", "revenue"] as const;
const LOCATION_SORT_COLUMNS = [
  "location",
  "bookings",
  "revenue",
  "paid",
  "outstanding",
  "cancellations",
] as const;
const IMPACT_BREAKDOWN_SORT_COLUMNS = ["period", "cancellations", "refundTotal"] as const;

type RevenueSortBy = (typeof REVENUE_SORT_COLUMNS)[number];
type ProfitabilitySortBy = (typeof PROFITABILITY_SORT_COLUMNS)[number];
type UtilizationSortBy = (typeof UTILIZATION_SORT_COLUMNS)[number];
type OutstandingSortBy = (typeof OUTSTANDING_SORT_COLUMNS)[number];
type AgingSortBy = (typeof AGING_SORT_COLUMNS)[number];
type PickupSortBy = (typeof PICKUP_SORT_COLUMNS)[number];
type ReturnSortBy = (typeof RETURN_SORT_COLUMNS)[number];
type CohortSortBy = (typeof COHORT_SORT_COLUMNS)[number];
type LocationSortBy = (typeof LOCATION_SORT_COLUMNS)[number];
type ImpactBreakdownSortBy = (typeof IMPACT_BREAKDOWN_SORT_COLUMNS)[number];

type TableSortState<Column extends string> = {
  sortBy: Column;
  sortDir: SortDir;
};

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function urgencyLabel(daysFromPickup: number) {
  if (daysFromPickup >= 0) return `${daysFromPickup} day(s) until pickup`;
  return `${Math.abs(daysFromPickup)} day(s) past pickup`;
}

function readQueryValue(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") return value[0];
  return undefined;
}

function readBooleanFlag(value: string | undefined) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true";
}

function normalizeReportGroup(value: string | undefined): ReportGroup {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "financial") return "financial";
  if (normalized === "operations") return "operations";
  if (normalized === "customer") return "customer";
  return "all";
}

function normalizeAgingBucket(value: string | undefined): AgingBucketFilterKey | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  const option = AGING_BUCKET_FILTERS.find((entry) => entry.key === normalized);
  if (option) return option.key;
  // Backward compatibility for older bucket query keys.
  if (normalized === "1-7-days") return "1-15-days";
  if (normalized === "8-30-days") return "16-30-days";
  if (normalized === "31-plus-days") return "30-plus-days";
  return null;
}

function normalizeFilterKey<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return allowed.includes(normalized as T) ? (normalized as T) : null;
}

function agingBucketLabelForKey(key: AgingBucketFilterKey): AgingBucketFilterLabel {
  return AGING_BUCKET_FILTERS.find((option) => option.key === key)?.label ?? "Current";
}

function agingBucketKeyForLabel(label: string): AgingBucketFilterKey | null {
  const match = AGING_BUCKET_FILTERS.find((option) => option.label === label);
  return match?.key ?? null;
}

function toQueryParams(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
    if (typeof normalized === "string") {
      query.set(key, normalized);
    }
  }
  return query;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function compareNumber(left: number, right: number) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortResultWithDirection(result: number, dir: SortDir) {
  if (result === 0) return 0;
  return dir === "asc" ? result : -result;
}

function normalizeTableSort<Column extends string>(
  search: URLSearchParams,
  options: {
    sortByParam: string;
    sortDirParam: string;
    columns: readonly Column[];
    defaultSortBy: Column;
    defaultSortDir: SortDir;
  },
): TableSortState<Column> {
  const rawSortBy = search.get(options.sortByParam)?.trim();
  const sortBy = options.columns.includes(rawSortBy as Column)
    ? (rawSortBy as Column)
    : options.defaultSortBy;
  const sortDir = normalizeSortDir(search.get(options.sortDirParam)) ?? options.defaultSortDir;
  return { sortBy, sortDir };
}

function statusChipClass() {
  return "border-[var(--ccr-report-status-border)] bg-[var(--ccr-report-status-bg)] text-[var(--ccr-report-status-text)]";
}

const STATUS_PILL_BASE_CLASS =
  "inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold leading-none transition hover:ring-2 hover:ring-[var(--ccr-accent)] hover:ring-offset-1 hover:ring-offset-[var(--ccr-surface)]";
const REPORT_BLOCK_RING_ON_BG_CLASS =
  "transition-colors duration-200 hover:border-[var(--ccr-accent)]";
const REPORT_BLOCK_RING_ON_SURFACE_CLASS =
  "transition-colors duration-200 hover:border-[var(--ccr-accent)]";

function formatStatusLabel(status: string) {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return "Unknown";
  return normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

type ReportSubstatusIndicator = {
  key: string;
  variant: "unpaid" | "due_on_pickup" | "overridden" | "refunded";
  message: string;
  priority: number;
};

function resolveReportSubstatusIndicators(input: {
  status: string;
  paymentOption?: string;
  paymentStatus?: string;
  isNonBlocking?: boolean;
}) {
  const indicators: ReportSubstatusIndicator[] = [];
  const status = String(input.status ?? "")
    .trim()
    .toUpperCase();
  const paymentOption = String(input.paymentOption ?? "")
    .trim()
    .toUpperCase();
  const paymentStatus = String(input.paymentStatus ?? "")
    .trim()
    .toUpperCase();
  const isClosed = ["CANCELLED", "RETURNED", "COMPLETED"].includes(status);

  if (input.isNonBlocking) {
    indicators.push({
      key: "unpaid_non_blocking",
      variant: "unpaid",
      message: "Unpaid - Not holding vehicle",
      priority: 1,
    });
  }

  if (!isClosed && (paymentOption === "PAY_ON_PICKUP" || paymentOption === "NONE")) {
    indicators.push({
      key: "due_on_pickup",
      variant: "due_on_pickup",
      message: "Due on pickup",
      priority: 2,
    });
  }

  if (status === "OVERRIDDEN") {
    indicators.push({
      key: "overridden",
      variant: "overridden",
      message: "Overridden by paid booking",
      priority: 3,
    });
  }

  if (paymentStatus.includes("REFUND")) {
    indicators.push({
      key: "refunded",
      variant: "refunded",
      message: "Refunded payment activity",
      priority: 4,
    });
  }

  return indicators.sort((left, right) => left.priority - right.priority).slice(0, 2);
}

function formatJmdCompact(amount: number) {
  return Number(amount || 0).toLocaleString("en-JM", {
    style: "currency",
    currency: "JMD",
    notation: "compact",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function MetricCurrencyValue({
  amount,
  className = "",
}: {
  amount: number;
  className?: string;
}) {
  const full = formatJmd(amount);
  return (
    <p
      className={`mt-2 min-w-0 whitespace-nowrap text-[clamp(1.35rem,6vw,2.15rem)] font-bold leading-tight tracking-tight text-[var(--ccr-text)] ${className}`.trim()}
      title={full}
      aria-label={full}
    >
      <span className="sm:hidden">{formatJmdCompact(amount)}</span>
      <span className="hidden sm:inline">{full}</span>
    </p>
  );
}

function MetricCountValue({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  return (
    <p
      className={`mt-2 min-w-0 whitespace-nowrap text-[clamp(1.35rem,6vw,2.15rem)] font-bold leading-tight tracking-tight text-[var(--ccr-text)] ${className}`.trim()}
      title={String(value)}
      aria-label={String(value)}
    >
      {value}
    </p>
  );
}

function ReportExportDropdown({
  label,
  hrefs,
}: {
  label: string;
  hrefs: Record<ReportExportFormat, string>;
}) {
  return (
    <details className="group relative">
      <summary className="flex list-none items-center gap-2 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] transition hover:ring-2 hover:ring-[var(--ccr-accent)] hover:ring-offset-1 hover:ring-offset-[var(--ccr-surface)] [&::-webkit-details-marker]:hidden">
        {label}
        <svg
          viewBox="0 0 20 20"
          className="h-3.5 w-3.5 text-[var(--ccr-muted)] transition group-open:rotate-180"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 7l5 6 5-6" />
        </svg>
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-36 overflow-hidden rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-lg">
        {REPORT_EXPORT_FORMAT_OPTIONS.map((option) => (
          <Link
            key={`${label}-${option.key}`}
            href={hrefs[option.key]}
            prefetch={false}
            className="block border-b border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] last:border-b-0 hover:bg-[var(--ccr-surface-soft)]"
          >
            {option.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

function ReportModeBadge({ mode }: { mode: "operational" | "historical" }) {
  const label = mode === "operational" ? "Operational snapshot" : "Historical analysis";
  const classes =
    mode === "operational"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
      : "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-accent)]";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${classes}`}>
      {label}
    </span>
  );
}

function ReportWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {warnings.map((warning) => (
        <div
          key={warning}
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          {warning}
        </div>
      ))}
    </div>
  );
}

function mergeWarnings(...groups: Array<readonly string[] | string[]>) {
  return [...new Set(groups.flatMap((group) => group))];
}

function FunnelConversionRow({
  from,
  to,
  value,
}: {
  from: string;
  to: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2 text-[var(--ccr-text)]">
        <span className="truncate">{from}</span>
        <DateRangeArrow size={14} className="mx-0 text-[var(--ccr-muted)]" />
        <span className="truncate">{to}</span>
      </div>
      <span className="shrink-0 font-semibold text-[var(--ccr-text)]">{value}</span>
    </div>
  );
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const reportsPreviewFlagsEnabled = readBooleanFlag(process.env.REPORTS_PREVIEW_FLAGS_ENABLED);
  const previewMissingBlockouts =
    reportsPreviewFlagsEnabled && readBooleanFlag(readQueryValue(params, "previewMissingBlockouts"));
  const previewMissingMaintenance =
    reportsPreviewFlagsEnabled &&
    readBooleanFlag(readQueryValue(params, "previewMissingMaintenance"));
  const previewModeActive = previewMissingBlockouts || previewMissingMaintenance;
  const currentQueryParams = toQueryParams(params);
  const reportGroup = normalizeReportGroup(readQueryValue(params, "reportGroup"));
  const revenueBucketQuery = readQueryValue(params, "revenueBucket");
  const agingBucketFilter = normalizeAgingBucket(readQueryValue(params, "agingBucket"));
  const outstandingBucketFilter = normalizeFilterKey(
    readQueryValue(params, "outstandingBucket"),
    OUTSTANDING_BUCKET_FILTER_KEYS,
  );
  const profitabilityBucketFilter = normalizeFilterKey(
    readQueryValue(params, "profitabilityBucket"),
    PROFITABILITY_BUCKET_FILTER_KEYS,
  );
  const locationBucketFilter = normalizeFilterKey(
    readQueryValue(params, "locationBucket"),
    LOCATION_BUCKET_FILTER_KEYS,
  );
  const cohortBucketFilter = normalizeFilterKey(
    readQueryValue(params, "cohortBucket"),
    COHORT_BUCKET_FILTER_KEYS,
  );
  const impactBucketFilter = normalizeFilterKey(
    readQueryValue(params, "impactBucket"),
    IMPACT_BUCKET_FILTER_KEYS,
  );
  const rowsPerPage = normalizePageSize(
    readQueryValue(params, "rows"),
    STANDARD_PAGE_SIZE_OPTIONS,
    10,
  ) as StandardPageSize;
  const impactRowsPerPage = normalizePageSize(
    readQueryValue(params, "impactRows"),
    IMPACT_PAGE_SIZE_OPTIONS,
    5,
  ) as ImpactPageSize;

  const report = await getAdminReportsPayload({
    snapshotDate: readQueryValue(params, "snapshotDate"),
    rangeFrom: readQueryValue(params, "rangeFrom"),
    rangeTo: readQueryValue(params, "rangeTo"),
    vehicleId: readQueryValue(params, "vehicleId"),
    pickupLocationType: readQueryValue(params, "pickupLocationType"),
    dropoffLocationType: readQueryValue(params, "dropoffLocationType"),
    locationLabel: readQueryValue(params, "locationLabel"),
    revenueGranularity: readQueryValue(params, "revenueGranularity"),
  });

  const filters = report.filters;
  const baseFilterQuery = buildReportsFilterQueryString(filters);
  const baseUiQuery = new URLSearchParams(baseFilterQuery);
  if (previewMissingBlockouts) {
    baseUiQuery.set("previewMissingBlockouts", "1");
  }
  if (previewMissingMaintenance) {
    baseUiQuery.set("previewMissingMaintenance", "1");
  }
  if (rowsPerPage !== 10) {
    baseUiQuery.set("rows", String(rowsPerPage));
  }
  if (impactRowsPerPage !== 5) {
    baseUiQuery.set("impactRows", String(impactRowsPerPage));
  }
  for (const key of [
    "reportGroup",
    "profitabilityPage",
    "utilizationPage",
    "outstandingPage",
    "agingPage",
    "agingBucket",
    "outstandingBucket",
    "revenueBucket",
    "profitabilityBucket",
    "locationBucket",
    "cohortBucket",
    "impactBucket",
    "pickupPage",
    "returnPage",
    "cohortPage",
    "locationPage",
    "breakdownPage",
    "cancelPage",
    "refundPage",
    "revenueSortBy",
    "revenueSortDir",
    "profitabilitySortBy",
    "profitabilitySortDir",
    "utilizationSortBy",
    "utilizationSortDir",
    "outstandingSortBy",
    "outstandingSortDir",
    "agingSortBy",
    "agingSortDir",
    "pickupSortBy",
    "pickupSortDir",
    "returnSortBy",
    "returnSortDir",
    "cohortSortBy",
    "cohortSortDir",
    "locationSortBy",
    "locationSortDir",
    "impactBreakdownSortBy",
    "impactBreakdownSortDir",
  ]) {
    const raw = readQueryValue(params, key);
    if (typeof raw === "string" && raw.trim().length > 0) {
      baseUiQuery.set(key, raw);
    }
  }

  const vehicles = await dbQuery<VehicleRow>(
    "select v.id, v.make, v.model, v.status from vehicles v where v.status <> 'INACTIVE' or exists (" +
      "select 1 from bookings b where b.vehicle_id = v.id" +
      ") order by v.make, v.model",
  );

  const buildReportsHref = (updates: Record<string, string | null | undefined>) => {
    const query = new URLSearchParams(baseUiQuery.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        query.delete(key);
      } else {
        query.set(key, value);
      }
    }
    const search = query.toString();
    return search ? `/admin/reports?${search}` : "/admin/reports";
  };

  const exportHref = (reportKey: ReportExportKey, format: ReportExportFormat) =>
    `/api/admin/reports?${baseFilterQuery}&format=${format}&report=${reportKey}`;

  const exportHrefSet = (reportKey: ReportExportKey): Record<ReportExportFormat, string> => ({
    csv: exportHref(reportKey, "csv"),
    excel: exportHref(reportKey, "excel"),
    pdf: exportHref(reportKey, "pdf"),
  });
  const reportSectionMetaByCardKey = {
    revenue: report.sectionMeta.revenue,
    profitability: report.sectionMeta.vehicleProfitability,
    utilization: report.sectionMeta.utilization,
    outstanding: report.sectionMeta.outstandingBalances,
    aging: report.sectionMeta.agingReceivables,
    location: report.sectionMeta.locationPerformance,
    funnel: report.sectionMeta.funnel,
    cohort: report.sectionMeta.customerCohort,
    upcoming: report.sectionMeta.upcoming,
    impact: report.sectionMeta.cancellationRefundImpact,
  } as const;
  const previewWarnings = {
    blockouts:
      report.sectionMeta.utilization.warnings.find((warning) => warning.includes("Blockouts table not found")) ??
      "Blockouts table not found. Utilization is based on booked days only.",
    maintenance:
      report.sectionMeta.vehicleProfitability.warnings.find((warning) =>
        warning.includes("Maintenance records table not found"),
      ) ?? "Maintenance records table not found. Maintenance costs are excluded from this section.",
  } as const;
  const displaySectionMetaByCardKey = {
    ...reportSectionMetaByCardKey,
    utilization: {
      ...reportSectionMetaByCardKey.utilization,
      warnings: previewMissingBlockouts
        ? mergeWarnings(reportSectionMetaByCardKey.utilization.warnings, [previewWarnings.blockouts])
        : reportSectionMetaByCardKey.utilization.warnings,
    },
    profitability: {
      ...reportSectionMetaByCardKey.profitability,
      warnings: previewMissingMaintenance
        ? mergeWarnings(reportSectionMetaByCardKey.profitability.warnings, [previewWarnings.maintenance])
        : reportSectionMetaByCardKey.profitability.warnings,
    },
  } as const;

  const revenueSort = normalizeTableSort(currentQueryParams, {
    sortByParam: "revenueSortBy",
    sortDirParam: "revenueSortDir",
    columns: REVENUE_SORT_COLUMNS,
    defaultSortBy: "period",
    defaultSortDir: "asc",
  });
  const profitabilitySort = normalizeTableSort(currentQueryParams, {
    sortByParam: "profitabilitySortBy",
    sortDirParam: "profitabilitySortDir",
    columns: PROFITABILITY_SORT_COLUMNS,
    defaultSortBy: "net",
    defaultSortDir: "desc",
  });
  const utilizationSort = normalizeTableSort(currentQueryParams, {
    sortByParam: "utilizationSortBy",
    sortDirParam: "utilizationSortDir",
    columns: UTILIZATION_SORT_COLUMNS,
    defaultSortBy: "vehicle",
    defaultSortDir: "asc",
  });
  const outstandingSort = normalizeTableSort(currentQueryParams, {
    sortByParam: "outstandingSortBy",
    sortDirParam: "outstandingSortDir",
    columns: OUTSTANDING_SORT_COLUMNS,
    defaultSortBy: "balance",
    defaultSortDir: "desc",
  });
  const agingSort = normalizeTableSort(currentQueryParams, {
    sortByParam: "agingSortBy",
    sortDirParam: "agingSortDir",
    columns: AGING_SORT_COLUMNS,
    defaultSortBy: "daysPastDue",
    defaultSortDir: "desc",
  });
  const pickupSort = normalizeTableSort(currentQueryParams, {
    sortByParam: "pickupSortBy",
    sortDirParam: "pickupSortDir",
    columns: PICKUP_SORT_COLUMNS,
    defaultSortBy: "pickup",
    defaultSortDir: "asc",
  });
  const returnSort = normalizeTableSort(currentQueryParams, {
    sortByParam: "returnSortBy",
    sortDirParam: "returnSortDir",
    columns: RETURN_SORT_COLUMNS,
    defaultSortBy: "return",
    defaultSortDir: "asc",
  });
  const cohortSort = normalizeTableSort(currentQueryParams, {
    sortByParam: "cohortSortBy",
    sortDirParam: "cohortSortDir",
    columns: COHORT_SORT_COLUMNS,
    defaultSortBy: "cohort",
    defaultSortDir: "asc",
  });
  const locationSort = normalizeTableSort(currentQueryParams, {
    sortByParam: "locationSortBy",
    sortDirParam: "locationSortDir",
    columns: LOCATION_SORT_COLUMNS,
    defaultSortBy: "revenue",
    defaultSortDir: "desc",
  });
  const impactBreakdownSort = normalizeTableSort(currentQueryParams, {
    sortByParam: "impactBreakdownSortBy",
    sortDirParam: "impactBreakdownSortDir",
    columns: IMPACT_BREAKDOWN_SORT_COLUMNS,
    defaultSortBy: "period",
    defaultSortDir: "asc",
  });

  const buildTableSortHref = <Column extends string>(
    sort: TableSortState<Column>,
    columnKey: Column,
    options: {
      sortByParam: string;
      sortDirParam: string;
      defaultDirection?: SortDir;
      pageParam?: string;
    },
  ) => {
    const next = nextSort(sort, columnKey, options.defaultDirection ?? "asc");
    const updates: Record<string, string | null | undefined> = {
      [options.sortByParam]: next.sortBy ?? null,
      [options.sortDirParam]: next.sortDir ?? null,
    };
    if (options.pageParam) {
      updates[options.pageParam] = null;
    }
    return buildReportsHref(updates);
  };

  const visibleRevenuePoints = report.revenue.points.filter(
    (point) =>
      point.grossRevenue !== 0 ||
      point.refunds !== 0 ||
      point.netRevenue !== 0 ||
      point.paymentCount !== 0,
  );
  const sortedRevenuePoints = [...visibleRevenuePoints].sort((left, right) => {
    let result = 0;
    if (revenueSort.sortBy === "period") {
      result = compareText(left.periodStart, right.periodStart);
    } else if (revenueSort.sortBy === "gross") {
      result = compareNumber(left.grossRevenue, right.grossRevenue);
    } else if (revenueSort.sortBy === "refunds") {
      result = compareNumber(left.refunds, right.refunds);
    } else if (revenueSort.sortBy === "net") {
      result = compareNumber(left.netRevenue, right.netRevenue);
    } else if (revenueSort.sortBy === "payments") {
      result = compareNumber(left.paymentCount, right.paymentCount);
    } else {
      result = compareText(left.periodStart, right.periodStart);
    }
    if (result === 0) {
      result = compareText(left.periodStart, right.periodStart);
    }
    return sortResultWithDirection(result, revenueSort.sortDir);
  });
  const revenueBucketFilter =
    typeof revenueBucketQuery === "string" &&
    sortedRevenuePoints.some((point) => point.periodStart === revenueBucketQuery)
      ? revenueBucketQuery
      : null;
  const filteredRevenuePoints = revenueBucketFilter
    ? sortedRevenuePoints.filter((point) => point.periodStart === revenueBucketFilter)
    : sortedRevenuePoints;
  const maxRevenue = Math.max(1, ...sortedRevenuePoints.map((point) => point.grossRevenue));

  const sortedProfitabilityRows = [...report.vehicleProfitability.rows].sort((left, right) => {
    let result = 0;
    if (profitabilitySort.sortBy === "vehicle") {
      result = compareText(left.vehicleLabel, right.vehicleLabel);
    } else if (profitabilitySort.sortBy === "bookings") {
      result = compareNumber(left.bookingCount, right.bookingCount);
    } else if (profitabilitySort.sortBy === "revenue") {
      result = compareNumber(left.grossRevenue, right.grossRevenue);
    } else if (profitabilitySort.sortBy === "refunds") {
      result = compareNumber(left.refunds, right.refunds);
    } else if (profitabilitySort.sortBy === "maintenance") {
      result = compareNumber(left.maintenanceCost, right.maintenanceCost);
    } else if (profitabilitySort.sortBy === "margin") {
      result = compareNumber(left.marginPercent, right.marginPercent);
    } else {
      result = compareNumber(left.netProfit, right.netProfit);
    }
    if (result === 0) {
      result = compareText(left.vehicleLabel, right.vehicleLabel);
    }
    return sortResultWithDirection(result, profitabilitySort.sortDir);
  });
  const filteredProfitabilityRows = profitabilityBucketFilter
    ? sortedProfitabilityRows.filter((row) => {
        if (profitabilityBucketFilter === "vehicles") return true;
        if (profitabilityBucketFilter === "revenue") return row.grossRevenue > 0;
        if (profitabilityBucketFilter === "refunds") return row.refunds > 0;
        if (profitabilityBucketFilter === "maintenance") return row.maintenanceCost > 0;
        if (profitabilityBucketFilter === "net") return row.netProfit > 0;
        return true;
      })
    : sortedProfitabilityRows;

  const sortedUtilizationRows = [...report.utilization.rows].sort((left, right) => {
    let result = 0;
    if (utilizationSort.sortBy === "vehicle") {
      result = compareText(left.vehicleLabel, right.vehicleLabel);
    } else if (utilizationSort.sortBy === "bookedDays") {
      result = compareNumber(left.bookedDays, right.bookedDays);
    } else if (utilizationSort.sortBy === "availableDays") {
      result = compareNumber(left.availableDays, right.availableDays);
    } else if (utilizationSort.sortBy === "blockoutDays") {
      result = compareNumber(left.blockoutDays, right.blockoutDays);
    } else {
      result = compareNumber(left.utilizationPercent, right.utilizationPercent);
    }
    if (result === 0) {
      result = compareText(left.vehicleLabel, right.vehicleLabel);
    }
    return sortResultWithDirection(result, utilizationSort.sortDir);
  });

  const sortedOutstandingRows = [...report.outstandingBalances.rows].sort((left, right) => {
    let result = 0;
    if (outstandingSort.sortBy === "booking") {
      result = compareText(left.bookingId, right.bookingId);
    } else if (outstandingSort.sortBy === "customer") {
      result = compareText(left.customerName, right.customerName);
    } else if (outstandingSort.sortBy === "vehicle") {
      result = compareText(left.vehicleLabel, right.vehicleLabel);
    } else if (outstandingSort.sortBy === "pickup") {
      result = compareText(left.pickupDate, right.pickupDate);
    } else if (outstandingSort.sortBy === "return") {
      result = compareText(left.returnDate, right.returnDate);
    } else if (outstandingSort.sortBy === "total") {
      result = compareNumber(left.total, right.total);
    } else if (outstandingSort.sortBy === "paid") {
      result = compareNumber(left.amountPaid, right.amountPaid);
    } else if (outstandingSort.sortBy === "balance") {
      result = compareNumber(left.balanceDue, right.balanceDue);
    } else if (outstandingSort.sortBy === "timing") {
      result = compareNumber(left.daysFromPickup, right.daysFromPickup);
    } else {
      result = compareText(formatStatusLabel(left.status), formatStatusLabel(right.status));
    }
    if (result === 0) {
      result = compareText(left.bookingId, right.bookingId);
    }
    return sortResultWithDirection(result, outstandingSort.sortDir);
  });
  const outstandingBucketPredicates = {
    pastPickup: (row: (typeof sortedOutstandingRows)[number]) => row.daysFromPickup < 0,
    upcomingPickup: (row: (typeof sortedOutstandingRows)[number]) => row.daysFromPickup >= 0,
    payOnPickup: (row: (typeof sortedOutstandingRows)[number]) => {
      const option = String(row.paymentOption ?? "")
        .trim()
        .toUpperCase();
      return option === "PAY_ON_PICKUP" || option === "NONE";
    },
    pendingPayment: (row: (typeof sortedOutstandingRows)[number]) => {
      const status = String(row.status ?? "")
        .trim()
        .toUpperCase();
      return status === "PENDING" || status === "PENDING_PAYMENT";
    },
  } as const;
  const outstandingBucketDefinitions: Array<{ key: OutstandingBucketFilterKey; label: string }> = [
    { key: "pastPickup", label: "Past Pickup" },
    { key: "upcomingPickup", label: "Upcoming Pickup" },
    { key: "payOnPickup", label: "Pay on Pickup" },
    { key: "pendingPayment", label: "Pending Payment" },
  ];
  const outstandingBucketSummaries = outstandingBucketDefinitions.map((bucket) => {
    const rows = sortedOutstandingRows.filter(outstandingBucketPredicates[bucket.key]);
    return {
      key: bucket.key,
      label: bucket.label,
      count: rows.length,
      amount: rows.reduce((sum, row) => sum + row.balanceDue, 0),
    };
  });
  const filteredOutstandingRows = outstandingBucketFilter
    ? sortedOutstandingRows.filter(outstandingBucketPredicates[outstandingBucketFilter])
    : sortedOutstandingRows;
  const filteredOutstandingTotals = {
    totalOutstandingAmount: filteredOutstandingRows.reduce((sum, row) => sum + row.balanceDue, 0),
    outstandingCount: filteredOutstandingRows.length,
  };

  const sortedAgingRows = [...report.agingReceivables.rows].sort((left, right) => {
    let result = 0;
    if (agingSort.sortBy === "booking") {
      result = compareText(left.bookingId, right.bookingId);
    } else if (agingSort.sortBy === "customer") {
      result = compareText(left.customerName, right.customerName);
    } else if (agingSort.sortBy === "vehicle") {
      result = compareText(left.vehicleLabel, right.vehicleLabel);
    } else if (agingSort.sortBy === "dueDate") {
      result = compareText(left.pickupDate, right.pickupDate);
    } else if (agingSort.sortBy === "balance") {
      result = compareNumber(left.balanceDue, right.balanceDue);
    } else if (agingSort.sortBy === "daysPastDue") {
      result = compareNumber(left.daysPastDue, right.daysPastDue);
    } else {
      result = compareText(left.bucket, right.bucket);
    }
    if (result === 0) {
      result = compareText(left.bookingId, right.bookingId);
    }
    return sortResultWithDirection(result, agingSort.sortDir);
  });
  const filteredAgingRows = agingBucketFilter
    ? sortedAgingRows.filter((row) => row.bucket === agingBucketLabelForKey(agingBucketFilter))
    : sortedAgingRows;

  const sortedPickupRows = [...report.upcoming.pickups].sort((left, right) => {
    let result = 0;
    if (pickupSort.sortBy === "booking") {
      result = compareText(left.bookingId, right.bookingId);
    } else if (pickupSort.sortBy === "customer") {
      result = compareText(left.customerName, right.customerName);
    } else if (pickupSort.sortBy === "vehicle") {
      result = compareText(left.vehicleLabel, right.vehicleLabel);
    } else if (pickupSort.sortBy === "pickup") {
      result = compareText(left.pickupDate, right.pickupDate);
    } else if (pickupSort.sortBy === "status") {
      result = compareText(formatStatusLabel(left.status), formatStatusLabel(right.status));
    } else {
      result = compareNumber(left.balanceDue, right.balanceDue);
    }
    if (result === 0) {
      result = compareText(left.bookingId, right.bookingId);
    }
    return sortResultWithDirection(result, pickupSort.sortDir);
  });

  const sortedReturnRows = [...report.upcoming.returns].sort((left, right) => {
    let result = 0;
    if (returnSort.sortBy === "booking") {
      result = compareText(left.bookingId, right.bookingId);
    } else if (returnSort.sortBy === "customer") {
      result = compareText(left.customerName, right.customerName);
    } else if (returnSort.sortBy === "vehicle") {
      result = compareText(left.vehicleLabel, right.vehicleLabel);
    } else if (returnSort.sortBy === "return") {
      result = compareText(left.returnDate, right.returnDate);
    } else if (returnSort.sortBy === "status") {
      result = compareText(formatStatusLabel(left.status), formatStatusLabel(right.status));
    } else {
      result = compareNumber(left.balanceDue, right.balanceDue);
    }
    if (result === 0) {
      result = compareText(left.bookingId, right.bookingId);
    }
    return sortResultWithDirection(result, returnSort.sortDir);
  });

  const sortedCohortRows = [...report.customerCohort.rows].sort((left, right) => {
    let result = 0;
    if (cohortSort.sortBy === "cohort") {
      result = compareText(left.cohortMonth, right.cohortMonth);
    } else if (cohortSort.sortBy === "customers") {
      result = compareNumber(left.customerCount, right.customerCount);
    } else if (cohortSort.sortBy === "bookings") {
      result = compareNumber(left.bookingCount, right.bookingCount);
    } else {
      result = compareNumber(left.revenue, right.revenue);
    }
    if (result === 0) {
      result = compareText(left.cohortMonth, right.cohortMonth);
    }
    return sortResultWithDirection(result, cohortSort.sortDir);
  });
  const filteredCohortRows = cohortBucketFilter
    ? sortedCohortRows.filter((row) => {
        if (cohortBucketFilter === "total") return true;
        if (cohortBucketFilter === "new") return row.bookingCount <= row.customerCount;
        if (cohortBucketFilter === "repeat" || cohortBucketFilter === "rate") {
          return row.bookingCount > row.customerCount;
        }
        return true;
      })
    : sortedCohortRows;

  const sortedLocationRows = [...report.locationPerformance.rows].sort((left, right) => {
    let result = 0;
    if (locationSort.sortBy === "location") {
      result = compareText(left.locationLabel, right.locationLabel);
    } else if (locationSort.sortBy === "bookings") {
      result = compareNumber(left.bookingCount, right.bookingCount);
    } else if (locationSort.sortBy === "revenue") {
      result = compareNumber(left.revenue, right.revenue);
    } else if (locationSort.sortBy === "paid") {
      result = compareNumber(left.amountPaid, right.amountPaid);
    } else if (locationSort.sortBy === "outstanding") {
      result = compareNumber(left.outstanding, right.outstanding);
    } else {
      result = compareNumber(left.cancellationCount, right.cancellationCount);
    }
    if (result === 0) {
      result = compareText(left.locationLabel, right.locationLabel);
    }
    return sortResultWithDirection(result, locationSort.sortDir);
  });
  const filteredLocationRows = locationBucketFilter
    ? sortedLocationRows.filter((row) => {
        if (locationBucketFilter === "bookings") return row.bookingCount > 0;
        if (locationBucketFilter === "revenue") return row.revenue > 0;
        if (locationBucketFilter === "paid") return row.amountPaid > 0;
        if (locationBucketFilter === "outstanding") return row.outstanding > 0;
        if (locationBucketFilter === "cancellations") return row.cancellationCount > 0;
        return true;
      })
    : sortedLocationRows;

  const sortedImpactBreakdownRows = [...report.cancellationRefundImpact.breakdown].sort((left, right) => {
    let result = 0;
    if (impactBreakdownSort.sortBy === "period") {
      result = compareText(left.periodStart, right.periodStart);
    } else if (impactBreakdownSort.sortBy === "cancellations") {
      result = compareNumber(left.cancellations, right.cancellations);
    } else {
      result = compareNumber(left.refundTotal, right.refundTotal);
    }
    if (result === 0) {
      result = compareText(left.periodStart, right.periodStart);
    }
    return sortResultWithDirection(result, impactBreakdownSort.sortDir);
  });
  const filteredImpactBreakdownRows = impactBucketFilter
    ? sortedImpactBreakdownRows.filter((row) => {
        if (impactBucketFilter === "cancelled") return row.cancellations > 0;
        if (impactBucketFilter === "refundCount" || impactBucketFilter === "refundTotal") {
          return row.refundTotal > 0;
        }
        if (impactBucketFilter === "grossPayments" || impactBucketFilter === "netImpact") {
          return row.cancellations > 0 || row.refundTotal > 0;
        }
        return true;
      })
    : sortedImpactBreakdownRows;

  const profitabilityPage = paginateRows(
    filteredProfitabilityRows,
    params.profitabilityPage,
    rowsPerPage,
  );
  const outstandingPage = paginateRows(filteredOutstandingRows, params.outstandingPage, rowsPerPage);
  const utilizationPage = paginateRows(sortedUtilizationRows, params.utilizationPage, rowsPerPage);
  const agingPage = paginateRows(filteredAgingRows, params.agingPage, rowsPerPage);
  const pickupPage = paginateRows(sortedPickupRows, params.pickupPage, rowsPerPage);
  const returnPage = paginateRows(sortedReturnRows, params.returnPage, rowsPerPage);
  const cohortPage = paginateRows(filteredCohortRows, params.cohortPage, rowsPerPage);
  const locationPage = paginateRows(filteredLocationRows, params.locationPage, rowsPerPage);
  const breakdownPage = paginateRows(filteredImpactBreakdownRows, params.breakdownPage, impactRowsPerPage);
  const cancellationPage = paginateRows(
    report.cancellationRefundImpact.cancellations,
    params.cancelPage,
    impactRowsPerPage,
  );
  const refundPage = paginateRows(
    report.cancellationRefundImpact.refunds,
    params.refundPage,
    impactRowsPerPage,
  );
  const revenueSortHref = (columnKey: RevenueSortBy, defaultDirection: SortDir = "asc") =>
    buildTableSortHref(revenueSort, columnKey, {
      sortByParam: "revenueSortBy",
      sortDirParam: "revenueSortDir",
      defaultDirection,
    });
  const profitabilitySortHref = (
    columnKey: ProfitabilitySortBy,
    defaultDirection: SortDir = "asc",
  ) =>
    buildTableSortHref(profitabilitySort, columnKey, {
      sortByParam: "profitabilitySortBy",
      sortDirParam: "profitabilitySortDir",
      defaultDirection,
      pageParam: "profitabilityPage",
    });
  const utilizationSortHref = (columnKey: UtilizationSortBy, defaultDirection: SortDir = "asc") =>
    buildTableSortHref(utilizationSort, columnKey, {
      sortByParam: "utilizationSortBy",
      sortDirParam: "utilizationSortDir",
      defaultDirection,
      pageParam: "utilizationPage",
    });
  const outstandingSortHref = (columnKey: OutstandingSortBy, defaultDirection: SortDir = "asc") =>
    buildTableSortHref(outstandingSort, columnKey, {
      sortByParam: "outstandingSortBy",
      sortDirParam: "outstandingSortDir",
      defaultDirection,
      pageParam: "outstandingPage",
    });
  const agingSortHref = (columnKey: AgingSortBy, defaultDirection: SortDir = "asc") =>
    buildTableSortHref(agingSort, columnKey, {
      sortByParam: "agingSortBy",
      sortDirParam: "agingSortDir",
      defaultDirection,
      pageParam: "agingPage",
    });
  const pickupSortHref = (columnKey: PickupSortBy, defaultDirection: SortDir = "asc") =>
    buildTableSortHref(pickupSort, columnKey, {
      sortByParam: "pickupSortBy",
      sortDirParam: "pickupSortDir",
      defaultDirection,
      pageParam: "pickupPage",
    });
  const returnSortHref = (columnKey: ReturnSortBy, defaultDirection: SortDir = "asc") =>
    buildTableSortHref(returnSort, columnKey, {
      sortByParam: "returnSortBy",
      sortDirParam: "returnSortDir",
      defaultDirection,
      pageParam: "returnPage",
    });
  const cohortSortHref = (columnKey: CohortSortBy, defaultDirection: SortDir = "asc") =>
    buildTableSortHref(cohortSort, columnKey, {
      sortByParam: "cohortSortBy",
      sortDirParam: "cohortSortDir",
      defaultDirection,
      pageParam: "cohortPage",
    });
  const locationSortHref = (columnKey: LocationSortBy, defaultDirection: SortDir = "asc") =>
    buildTableSortHref(locationSort, columnKey, {
      sortByParam: "locationSortBy",
      sortDirParam: "locationSortDir",
      defaultDirection,
      pageParam: "locationPage",
    });
  const impactBreakdownSortHref = (
    columnKey: ImpactBreakdownSortBy,
    defaultDirection: SortDir = "asc",
  ) =>
    buildTableSortHref(impactBreakdownSort, columnKey, {
      sortByParam: "impactBreakdownSortBy",
      sortDirParam: "impactBreakdownSortDir",
      defaultDirection,
      pageParam: "breakdownPage",
    });
  const groupedReportCards = REPORT_CARDS.filter(
    (card) => reportGroup === "all" || card.group === reportGroup,
  );
  const reportGroupTabs = REPORT_GROUP_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    href: buildReportsHref({
      reportGroup: tab.key === "all" ? null : tab.key,
    }),
  }));

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Admin
          </p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Reports</h1>
        </div>
        <Link
          href="/admin/bookings"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] transition hover:ring-2 hover:ring-[var(--ccr-accent)] hover:ring-offset-1 hover:ring-offset-[var(--ccr-bg)]"
        >
          View Bookings
        </Link>
      </div>

      <section className="mt-4 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Active scope
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--ccr-text)]">
          <p>
            <span className="font-semibold">Snapshot date:</span> {filters.snapshotDate}
          </p>
          <p>
            <span className="font-semibold">Historical range:</span> {filters.rangeFrom} to{" "}
            {filters.rangeTo}
          </p>
        </div>
        <p className="mt-1 text-xs text-[var(--ccr-muted)]">
          Operational cards use the snapshot date. Historical cards use the selected range and show
          their date basis on each report card.
        </p>
      </section>

      <details className="group mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        <summary className="cursor-pointer list-none px-4 py-4 text-left transition hover:bg-[var(--ccr-surface-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ccr-accent)] [&::-webkit-details-marker]:hidden">
          <span className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Filters
              </span>
              <span className="mt-1 block text-sm text-[var(--ccr-text)]">
                Open to adjust report filters
              </span>
            </span>
            <span className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-accent)] transition group-open:bg-[var(--ccr-accent)] group-open:text-[var(--ccr-bg)] sm:w-auto sm:shrink-0">
              <span className="group-open:hidden">Show filters</span>
              <span className="hidden group-open:inline">Hide filters</span>
              <svg
                viewBox="0 0 20 20"
                className="h-3.5 w-3.5 transition group-open:rotate-180"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 7l5 6 5-6" />
              </svg>
            </span>
          </span>
        </summary>
        <form className="hidden border-t border-[var(--ccr-border)] p-4 group-open:block">
          <input type="hidden" name="reportGroup" value={reportGroup} />
          <input type="hidden" name="impactRows" value={String(impactRowsPerPage)} />
          <input type="hidden" name="revenueGranularity" value={report.revenue.granularity} />
          {reportsPreviewFlagsEnabled && previewMissingBlockouts ? (
            <input type="hidden" name="previewMissingBlockouts" value="1" />
          ) : null}
          {reportsPreviewFlagsEnabled && previewMissingMaintenance ? (
            <input type="hidden" name="previewMissingMaintenance" value="1" />
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-12 xl:gap-4">
          <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] xl:col-span-4">
            Snapshot Date
            <input
              type="date"
              name="snapshotDate"
              defaultValue={filters.snapshotDate}
              className="promo-date-time-input date-icon-edge mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] xl:col-span-4">
            Range From
            <input
              type="date"
              name="rangeFrom"
              defaultValue={filters.rangeFrom}
              className="promo-date-time-input date-icon-edge mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] xl:col-span-4">
            Range To
            <input
              type="date"
              name="rangeTo"
              defaultValue={filters.rangeTo}
              className="promo-date-time-input date-icon-edge mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] xl:col-span-4">
            Vehicle
            <select
              name="vehicleId"
              defaultValue={filters.vehicleId}
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="">All vehicles</option>
              {vehicles.rows.map((vehicle: VehicleRow) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.make} {vehicle.model}
                  {String(vehicle.status ?? "").toUpperCase() === "INACTIVE" ? " (Inactive)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] xl:col-span-4">
            Pickup Type
            <select
              name="pickupLocationType"
              defaultValue={filters.pickupLocationType}
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="">All pickup types</option>
              <option value="OFFICE">Old Hope Road</option>
              <option value="AIRPORT">Airport</option>
              <option value="CUSTOM_ADDRESS">Custom address</option>
            </select>
          </label>
          <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] xl:col-span-4">
            Dropoff Type
            <select
              name="dropoffLocationType"
              defaultValue={filters.dropoffLocationType}
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="">All dropoff types</option>
              <option value="OFFICE">Old Hope Road</option>
              <option value="AIRPORT">Airport</option>
              <option value="CUSTOM_ADDRESS">Custom address</option>
            </select>
          </label>
          <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] xl:col-span-6">
            Location Label
            <input
              type="text"
              name="locationLabel"
              defaultValue={filters.locationLabel}
              placeholder="Filter by pickup or dropoff label"
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] xl:col-span-2">
            Rows
            <select
              name="rows"
              defaultValue={String(rowsPerPage)}
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              {STANDARD_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={String(size)}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <Link
            href="/admin/reports"
            className="min-w-0 rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-4 py-2 text-center text-xs font-semibold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-surface-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ccr-accent)] sm:self-end xl:col-span-2"
          >
            Reset
          </Link>
          <button
            type="submit"
            className="min-w-0 rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-accent)] px-4 py-2 text-xs font-semibold text-[var(--ccr-bg)] transition hover:bg-[var(--ccr-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ccr-accent)] sm:self-end xl:col-span-2"
          >
            Apply
          </button>
          </div>
        </form>
      </details>

      {reportsPreviewFlagsEnabled ? (
        <section className="mt-3 rounded-2xl border border-dashed border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Preview Controls
              </p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                Page-only QA toggles for degraded warning banners. Exports and APIs remain real.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={buildReportsHref({
                  previewMissingBlockouts: previewMissingBlockouts ? null : "1",
                })}
                prefetch={false}
                scroll={false}
                aria-pressed={previewMissingBlockouts}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  previewMissingBlockouts
                    ? "border-amber-300 bg-amber-100 text-amber-900"
                    : "border-[var(--ccr-border)] bg-[var(--ccr-bg)] text-[var(--ccr-text)]"
                }`}
              >
                Simulate missing blockouts
              </Link>
              <Link
                href={buildReportsHref({
                  previewMissingMaintenance: previewMissingMaintenance ? null : "1",
                })}
                prefetch={false}
                scroll={false}
                aria-pressed={previewMissingMaintenance}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  previewMissingMaintenance
                    ? "border-amber-300 bg-amber-100 text-amber-900"
                    : "border-[var(--ccr-border)] bg-[var(--ccr-bg)] text-[var(--ccr-text)]"
                }`}
              >
                Simulate missing maintenance records
              </Link>
            </div>
          </div>

          {previewModeActive ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Preview mode: simulating degraded report warnings.
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-6 grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-4 md:gap-4">
        <div
          className={`min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 ${REPORT_BLOCK_RING_ON_BG_CLASS}`}
        >
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Gross Collections</p>
          <MetricCurrencyValue amount={report.revenue.totals.grossRevenue} />
        </div>
        <div
          className={`min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 ${REPORT_BLOCK_RING_ON_BG_CLASS}`}
        >
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Net Collections</p>
          <MetricCurrencyValue amount={report.revenue.totals.netRevenue} />
        </div>
        <div
          className={`min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 ${REPORT_BLOCK_RING_ON_BG_CLASS}`}
        >
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
            Outstanding Balance
          </p>
          <MetricCurrencyValue amount={report.outstandingBalances.totals.totalOutstandingAmount} />
        </div>
        <div
          className={`min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 ${REPORT_BLOCK_RING_ON_BG_CLASS}`}
        >
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Outstanding Bookings</p>
          <MetricCountValue value={report.outstandingBalances.totals.outstandingCount} />
        </div>
      </section>

      <section className="mt-6">
        <div
          className={`flex items-center justify-between gap-3 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-6 py-4 ${REPORT_BLOCK_RING_ON_BG_CLASS}`}
        >
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Recommended Reports</h2>
          <span className="text-xs text-[var(--ccr-muted)]">
            Operational snapshot and historical analysis are separated per card.
          </span>
        </div>

        <AdminPillTabs
          tabs={reportGroupTabs}
          activeKey={reportGroup}
          ariaLabel="Reports groups"
          navTestId="reports-group-tabs"
          tabTestIdPrefix="reports-group-tab"
        />

        <div className="mt-4 space-y-4">
          {groupedReportCards.map((card) => (
            <article
              key={card.key}
              className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-[var(--ccr-text)]">{card.title}</h3>
                    <ReportModeBadge mode={displaySectionMetaByCardKey[card.key].mode} />
                  </div>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">{card.description}</p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    {displaySectionMetaByCardKey[card.key].dateBasisLabel}
                  </p>
                  <ReportWarnings warnings={displaySectionMetaByCardKey[card.key].warnings} />
                </div>
                {displaySectionMetaByCardKey[card.key].supportsExport ? (
                  <ReportExportDropdown label="Export" hrefs={exportHrefSet(REPORT_CARD_EXPORT_KEYS[card.key])} />
                ) : null}
              </div>

              {card.key === "revenue" ? (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <ReportsGranularityTabs
                      active={report.revenue.granularity}
                      hrefs={{
                        day: buildReportsHref({ revenueGranularity: "day" }),
                        week: buildReportsHref({ revenueGranularity: "week" }),
                        month: buildReportsHref({ revenueGranularity: "month" }),
                      }}
                    />
                    <p className="text-xs text-[var(--ccr-muted)]">
                      Recorded payments: {report.revenue.totals.paymentCount}
                    </p>
                  </div>

                  {sortedRevenuePoints.length === 0 ? (
                    <p className="mt-4 text-sm text-[var(--ccr-muted)]">
                      No payment activity matched the selected historical range.
                    </p>
                  ) : (
                    <>
                      <div className="mt-4 grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-4">
                        <div
                          className={`min-w-0 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Gross
                          </p>
                          <MetricCurrencyValue
                            amount={report.revenue.totals.grossRevenue}
                            className="mt-1 text-[clamp(1.45rem,5.6vw,1.65rem)]"
                          />
                        </div>
                        <div
                          className={`min-w-0 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Refunds
                          </p>
                          <MetricCurrencyValue
                            amount={report.revenue.totals.refunds}
                            className="mt-1 text-[clamp(1.45rem,5.6vw,1.65rem)]"
                          />
                        </div>
                        <div
                          className={`min-w-0 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Net</p>
                          <MetricCurrencyValue
                            amount={report.revenue.totals.netRevenue}
                            className="mt-1 text-[clamp(1.45rem,5.6vw,1.65rem)]"
                          />
                        </div>
                        <div
                          className={`min-w-0 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Payment Count
                          </p>
                          <MetricCountValue
                            value={report.revenue.totals.paymentCount}
                            className="mt-1 text-[clamp(1.45rem,5.6vw,1.65rem)]"
                          />
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 max-[359px]:grid-cols-1">
                        {filteredRevenuePoints.map((point) => {
                          const isActive = revenueBucketFilter === point.periodStart;
                          return (
                            <Link
                              key={point.periodStart}
                              href={buildReportsHref({
                                revenueBucket: isActive ? null : point.periodStart,
                              })}
                              prefetch={false}
                              scroll={false}
                              className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_BG_CLASS} ${
                                isActive
                                  ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                                  : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
                              }`}
                              aria-current={isActive ? "true" : undefined}
                            >
                              <span className="block text-xs font-semibold text-[var(--ccr-text)]">
                                {point.periodLabel}
                              </span>
                              <span className="mt-1 block text-sm font-semibold text-[var(--ccr-text)]">
                                {formatJmd(point.grossRevenue)}
                              </span>
                              <progress
                                className="ccr-report-progress mt-2 h-2 w-full"
                                value={normalizeRevenueBarWidthPercent(point.grossRevenue, maxRevenue)}
                                max={100}
                                aria-label={`${point.periodLabel} revenue share`}
                              />
                            </Link>
                          );
                        })}
                      </div>

                      <MobileTableAffordance className="mt-4 rounded-xl border border-[var(--ccr-border)]">
                        <table className="w-full min-w-[780px] text-left text-sm">
                          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            <tr>
                              <SortableTh
                                className="px-3 py-2"
                                label="Period"
                                columnKey="period"
                                sort={revenueSort}
                                href={revenueSortHref("period", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Gross"
                                columnKey="gross"
                                sort={revenueSort}
                                href={revenueSortHref("gross", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Refunds"
                                columnKey="refunds"
                                sort={revenueSort}
                                href={revenueSortHref("refunds", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Net"
                                columnKey="net"
                                sort={revenueSort}
                                href={revenueSortHref("net", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Payments"
                                columnKey="payments"
                                sort={revenueSort}
                                href={revenueSortHref("payments", "desc")}
                                defaultDirection="desc"
                              />
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRevenuePoints.length === 0 ? (
                              <tr className="border-b border-[var(--ccr-border)] last:border-b-0">
                                <td
                                  colSpan={5}
                                  className="px-3 py-6 text-center text-sm text-[var(--ccr-muted)]"
                                >
                                  No rows in the selected period bucket.
                                </td>
                              </tr>
                            ) : (
                              filteredRevenuePoints.map((point) => (
                                <tr
                                  key={`revenue-row-${point.periodStart}`}
                                  className="border-b border-[var(--ccr-border)] last:border-b-0"
                                >
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{point.periodLabel}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(point.grossRevenue)}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(point.refunds)}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(point.netRevenue)}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{point.paymentCount}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </MobileTableAffordance>
                    </>
                  )}
                </div>
              ) : null}

              {card.key === "profitability" ? (
                <div className="mt-4">
                  {sortedProfitabilityRows.length === 0 ? (
                    <p className="text-sm text-[var(--ccr-muted)]">
                      No vehicle profitability data matched the selected historical range.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-5">
                        <Link
                          href={buildReportsHref({
                            profitabilityBucket: profitabilityBucketFilter === "vehicles" ? null : "vehicles",
                            profitabilityPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            profitabilityBucketFilter === "vehicles"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Vehicles
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {report.vehicleProfitability.totals.vehicleCount}
                          </p>
                        </Link>
                        <Link
                          href={buildReportsHref({
                            profitabilityBucket: profitabilityBucketFilter === "revenue" ? null : "revenue",
                            profitabilityPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            profitabilityBucketFilter === "revenue"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Gross Revenue
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {formatJmd(report.vehicleProfitability.totals.grossRevenue)}
                          </p>
                        </Link>
                        <Link
                          href={buildReportsHref({
                            profitabilityBucket: profitabilityBucketFilter === "refunds" ? null : "refunds",
                            profitabilityPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            profitabilityBucketFilter === "refunds"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Refunds
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {formatJmd(report.vehicleProfitability.totals.refunds)}
                          </p>
                        </Link>
                        <Link
                          href={buildReportsHref({
                            profitabilityBucket:
                              profitabilityBucketFilter === "maintenance" ? null : "maintenance",
                            profitabilityPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            profitabilityBucketFilter === "maintenance"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Maintenance
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {formatJmd(report.vehicleProfitability.totals.maintenanceCost)}
                          </p>
                        </Link>
                        <Link
                          href={buildReportsHref({
                            profitabilityBucket: profitabilityBucketFilter === "net" ? null : "net",
                            profitabilityPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            profitabilityBucketFilter === "net"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Net Profit
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {formatJmd(report.vehicleProfitability.totals.netProfit)}
                          </p>
                        </Link>
                      </div>

                      <MobileTableAffordance className="mt-4">
                        <table className="w-full min-w-[920px] text-left text-sm">
                          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            <tr>
                              <SortableTh
                                className="px-3 py-2"
                                label="Vehicle"
                                columnKey="vehicle"
                                sort={profitabilitySort}
                                href={profitabilitySortHref("vehicle", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Bookings"
                                columnKey="bookings"
                                sort={profitabilitySort}
                                href={profitabilitySortHref("bookings", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Revenue"
                                columnKey="revenue"
                                sort={profitabilitySort}
                                href={profitabilitySortHref("revenue", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Refunds"
                                columnKey="refunds"
                                sort={profitabilitySort}
                                href={profitabilitySortHref("refunds", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Maintenance"
                                columnKey="maintenance"
                                sort={profitabilitySort}
                                href={profitabilitySortHref("maintenance", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Net"
                                columnKey="net"
                                sort={profitabilitySort}
                                href={profitabilitySortHref("net", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Margin"
                                columnKey="margin"
                                sort={profitabilitySort}
                                href={profitabilitySortHref("margin", "desc")}
                                defaultDirection="desc"
                              />
                            </tr>
                          </thead>
                          <tbody>
                            {profitabilityPage.rows.length === 0 ? (
                              <tr className="border-b border-[var(--ccr-border)] last:border-b-0">
                                <td
                                  colSpan={7}
                                  className="px-3 py-6 text-center text-sm text-[var(--ccr-muted)]"
                                >
                                  No vehicles match the selected profitability bucket.
                                </td>
                              </tr>
                            ) : (
                              profitabilityPage.rows.map((row) => (
                                <tr
                                  key={`profitability-${row.vehicleId}`}
                                  className="border-b border-[var(--ccr-border)] last:border-b-0"
                                >
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.vehicleLabel}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.bookingCount}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">
                                    {formatJmd(row.grossRevenue)}
                                  </td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(row.refunds)}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">
                                    {formatJmd(row.maintenanceCost)}
                                  </td>
                                  <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]">
                                    {formatJmd(row.netProfit)}
                                  </td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">
                                    {row.marginPercent.toFixed(1)}%
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </MobileTableAffordance>

                      <PaginationSummaryNav
                        className="mt-3"
                        from={profitabilityPage.from}
                        to={profitabilityPage.to}
                        totalCount={profitabilityPage.totalCount}
                        page={profitabilityPage.page}
                        totalPages={profitabilityPage.totalPages}
                        hasPrev={profitabilityPage.hasPrev}
                        hasNext={profitabilityPage.hasNext}
                        prevHref={buildReportsHref({
                          profitabilityPage:
                            profitabilityPage.hasPrev ? String(profitabilityPage.page - 1) : null,
                        })}
                        nextHref={buildReportsHref({
                          profitabilityPage:
                            profitabilityPage.hasNext ? String(profitabilityPage.page + 1) : null,
                        })}
                      />
                    </>
                  )}
                </div>
              ) : null}

              {card.key === "utilization" ? (
                <div className="mt-4">
                  {sortedUtilizationRows.length === 0 ? (
                    <p className="text-sm text-[var(--ccr-muted)]">
                      No utilization data matched the selected historical range.
                    </p>
                  ) : (
                    <>
                      <MobileTableAffordance>
                        <table className="w-full min-w-[760px] text-left text-sm">
                          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            <tr>
                              <SortableTh
                                className="px-3 py-2"
                                label="Vehicle"
                                columnKey="vehicle"
                                sort={utilizationSort}
                                href={utilizationSortHref("vehicle", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Booked Days"
                                columnKey="bookedDays"
                                sort={utilizationSort}
                                href={utilizationSortHref("bookedDays", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Available Days"
                                columnKey="availableDays"
                                sort={utilizationSort}
                                href={utilizationSortHref("availableDays", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Blockout Days"
                                columnKey="blockoutDays"
                                sort={utilizationSort}
                                href={utilizationSortHref("blockoutDays", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Utilization"
                                columnKey="utilization"
                                sort={utilizationSort}
                                href={utilizationSortHref("utilization", "desc")}
                                defaultDirection="desc"
                              />
                            </tr>
                          </thead>
                          <tbody>
                            {utilizationPage.rows.map((row) => (
                              <tr
                                key={`utilization-${row.vehicleId}`}
                                className="border-b border-[var(--ccr-border)] last:border-b-0"
                              >
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{row.vehicleLabel}</td>
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{row.bookedDays}</td>
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{row.availableDays}</td>
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{row.blockoutDays}</td>
                                <td className="px-3 py-2 text-[var(--ccr-text)]">
                                  <div className="flex items-center gap-2">
                                    <progress
                                      className="ccr-report-progress ccr-report-utilization-progress h-2 w-24"
                                      value={Math.max(2, row.utilizationPercent)}
                                      max={100}
                                      aria-label={`${row.vehicleLabel} utilization`}
                                    />
                                    <span>{row.utilizationPercent.toFixed(1)}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </MobileTableAffordance>

                      <PaginationSummaryNav
                        className="mt-3"
                        from={utilizationPage.from}
                        to={utilizationPage.to}
                        totalCount={utilizationPage.totalCount}
                        page={utilizationPage.page}
                        totalPages={utilizationPage.totalPages}
                        hasPrev={utilizationPage.hasPrev}
                        hasNext={utilizationPage.hasNext}
                        prevHref={buildReportsHref({
                          utilizationPage:
                            utilizationPage.hasPrev ? String(utilizationPage.page - 1) : null,
                        })}
                        nextHref={buildReportsHref({
                          utilizationPage:
                            utilizationPage.hasNext ? String(utilizationPage.page + 1) : null,
                        })}
                      />
                    </>
                  )}
                </div>
              ) : null}

              {card.key === "outstanding" ? (
                <div className="mt-4">
                  {report.outstandingBalances.rows.length === 0 ? (
                    <p className="text-sm text-[var(--ccr-muted)]">
                      No open balances existed on the selected snapshot date.
                    </p>
                  ) : (
                    <>
                      <div className="mb-3 grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-4">
                        {outstandingBucketSummaries.map((bucket) => {
                          const isActive = outstandingBucketFilter === bucket.key;
                          return (
                            <Link
                              key={`outstanding-bucket-${bucket.key}`}
                              href={buildReportsHref({
                                outstandingBucket: isActive ? null : bucket.key,
                                outstandingPage: null,
                              })}
                              prefetch={false}
                              scroll={false}
                              className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                                isActive
                                  ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                                  : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                              }`}
                              aria-current={isActive ? "true" : undefined}
                            >
                              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                                {bucket.label}
                              </p>
                              <p className="mt-1 text-sm font-semibold text-[var(--ccr-text)]">
                                {bucket.count} booking(s)
                              </p>
                              <p className="text-xs text-[var(--ccr-muted)]">{formatJmd(bucket.amount)}</p>
                            </Link>
                          );
                        })}
                      </div>

                      <MobileTableAffordance>
                        <table className="w-full min-w-[1060px] text-left text-sm">
                          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            <tr>
                              <SortableTh
                                className="px-3 py-2"
                                label="Booking"
                                columnKey="booking"
                                sort={outstandingSort}
                                href={outstandingSortHref("booking", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Customer"
                                columnKey="customer"
                                sort={outstandingSort}
                                href={outstandingSortHref("customer", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Vehicle"
                                columnKey="vehicle"
                                sort={outstandingSort}
                                href={outstandingSortHref("vehicle", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Pickup"
                                columnKey="pickup"
                                sort={outstandingSort}
                                href={outstandingSortHref("pickup", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Return"
                                columnKey="return"
                                sort={outstandingSort}
                                href={outstandingSortHref("return", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Total"
                                columnKey="total"
                                sort={outstandingSort}
                                href={outstandingSortHref("total", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Paid"
                                columnKey="paid"
                                sort={outstandingSort}
                                href={outstandingSortHref("paid", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Balance"
                                columnKey="balance"
                                sort={outstandingSort}
                                href={outstandingSortHref("balance", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Timing"
                                columnKey="timing"
                                sort={outstandingSort}
                                href={outstandingSortHref("timing", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Status"
                                columnKey="status"
                                sort={outstandingSort}
                                href={outstandingSortHref("status", "asc")}
                              />
                            </tr>
                          </thead>
                          <tbody>
                            {outstandingPage.rows.length === 0 ? (
                              <tr className="border-b border-[var(--ccr-border)] last:border-b-0">
                                <td
                                  colSpan={10}
                                  className="px-3 py-6 text-center text-sm text-[var(--ccr-muted)]"
                                >
                                  No bookings match the selected outstanding bucket.
                                </td>
                              </tr>
                            ) : (
                              outstandingPage.rows.map((row) => (
                                (() => {
                                  const substatusIndicators = resolveReportSubstatusIndicators({
                                    status: row.status,
                                    paymentOption: row.paymentOption,
                                    paymentStatus: row.paymentStatus,
                                    isNonBlocking: row.isNonBlocking,
                                  });

                                  return (
                                    <tr
                                      key={`outstanding-${row.bookingId}`}
                                      className="border-b border-[var(--ccr-border)] last:border-b-0"
                                    >
                                      <td className="px-3 py-2">
                                        <Link
                                          href={`/admin/bookings/${row.bookingDbId}`}
                                          className="font-semibold text-[var(--ccr-text)] hover:underline"
                                        >
                                          {row.bookingId}
                                        </Link>
                                      </td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{row.customerName}</td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{row.vehicleLabel}</td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{row.pickupDate}</td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{row.returnDate}</td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(row.total)}</td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(row.amountPaid)}</td>
                                      <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]">
                                        {formatJmd(row.balanceDue)}
                                      </td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">
                                        {urgencyLabel(row.daysFromPickup)}
                                      </td>
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          <span className={`${STATUS_PILL_BASE_CLASS} ${statusChipClass()}`}>
                                            {formatStatusLabel(row.status)}
                                          </span>
                                          {substatusIndicators.map((indicator) => (
                                            <InfoTooltipIcon
                                              key={`outstanding-${row.bookingId}-${indicator.key}`}
                                              message={indicator.message}
                                              variant={indicator.variant}
                                            />
                                          ))}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })()
                              ))
                            )}
                            <tr className="bg-[var(--ccr-bg)]">
                              <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]" colSpan={7}>
                                Totals
                              </td>
                              <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]">
                                {formatJmd(filteredOutstandingTotals.totalOutstandingAmount)}
                              </td>
                              <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]" colSpan={2}>
                                {filteredOutstandingTotals.outstandingCount} booking(s)
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </MobileTableAffordance>

                      <PaginationSummaryNav
                        className="mt-3"
                        from={outstandingPage.from}
                        to={outstandingPage.to}
                        totalCount={outstandingPage.totalCount}
                        page={outstandingPage.page}
                        totalPages={outstandingPage.totalPages}
                        hasPrev={outstandingPage.hasPrev}
                        hasNext={outstandingPage.hasNext}
                        prevHref={buildReportsHref({
                          outstandingPage:
                            outstandingPage.hasPrev ? String(outstandingPage.page - 1) : null,
                        })}
                        nextHref={buildReportsHref({
                          outstandingPage:
                            outstandingPage.hasNext ? String(outstandingPage.page + 1) : null,
                        })}
                      />
                    </>
                  )}
                </div>
              ) : null}

              {card.key === "aging" ? (
                <div className="mt-4">
                  {report.agingReceivables.rows.length === 0 ? (
                    <p className="text-sm text-[var(--ccr-muted)]">
                      No aged receivables existed on the selected snapshot date.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-4">
                        <div
                          className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Outstanding Amount
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {formatJmd(report.agingReceivables.totals.totalOutstandingAmount)}
                          </p>
                        </div>
                        <div
                          className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Outstanding Count
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {report.agingReceivables.totals.outstandingCount}
                          </p>
                        </div>
                        <div
                          className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Overdue Amount
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {formatJmd(report.agingReceivables.totals.overdueAmount)}
                          </p>
                        </div>
                        <div
                          className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Overdue Count
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {report.agingReceivables.totals.overdueCount}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-4">
                        {report.agingReceivables.buckets.map((bucket) => {
                          const bucketKey = agingBucketKeyForLabel(bucket.label);
                          const isActive = bucketKey !== null && agingBucketFilter === bucketKey;
                          return (
                            <Link
                              key={`aging-bucket-${bucket.label}`}
                              href={buildReportsHref({
                                agingBucket: isActive ? null : bucketKey,
                                agingPage: null,
                              })}
                              prefetch={false}
                              scroll={false}
                              className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                                isActive
                                  ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                                  : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                              }`}
                              aria-current={isActive ? "true" : undefined}
                            >
                              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                                {bucket.label}
                              </p>
                              <p className="mt-1 text-sm font-semibold text-[var(--ccr-text)]">
                                {bucket.count} booking(s)
                              </p>
                              <p className="text-xs text-[var(--ccr-muted)]">{formatJmd(bucket.amount)}</p>
                            </Link>
                          );
                        })}
                      </div>

                      <MobileTableAffordance className="mt-4">
                        <table className="w-full min-w-[980px] text-left text-sm">
                          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            <tr>
                              <SortableTh
                                className="px-3 py-2"
                                label="Booking"
                                columnKey="booking"
                                sort={agingSort}
                                href={agingSortHref("booking", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Customer"
                                columnKey="customer"
                                sort={agingSort}
                                href={agingSortHref("customer", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Vehicle"
                                columnKey="vehicle"
                                sort={agingSort}
                                href={agingSortHref("vehicle", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Pickup Due Date"
                                columnKey="dueDate"
                                sort={agingSort}
                                href={agingSortHref("dueDate", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Balance"
                                columnKey="balance"
                                sort={agingSort}
                                href={agingSortHref("balance", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Days Past Due"
                                columnKey="daysPastDue"
                                sort={agingSort}
                                href={agingSortHref("daysPastDue", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Bucket"
                                columnKey="bucket"
                                sort={agingSort}
                                href={agingSortHref("bucket", "asc")}
                              />
                            </tr>
                          </thead>
                          <tbody>
                            {agingPage.rows.length === 0 ? (
                              <tr className="border-b border-[var(--ccr-border)] last:border-b-0">
                                <td
                                  colSpan={7}
                                  className="px-3 py-6 text-center text-sm text-[var(--ccr-muted)]"
                                >
                                  No bookings in the selected aging bucket.
                                </td>
                              </tr>
                            ) : (
                              agingPage.rows.map((row) => (
                                <tr
                                  key={`aging-${row.bookingId}`}
                                  className="border-b border-[var(--ccr-border)] last:border-b-0"
                                >
                                  <td className="px-3 py-2">
                                    <Link
                                      href={`/admin/bookings/${row.bookingDbId}`}
                                      className="font-semibold text-[var(--ccr-text)] hover:underline"
                                    >
                                      {row.bookingId}
                                    </Link>
                                  </td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.customerName}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.vehicleLabel}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.pickupDate}</td>
                                  <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]">
                                    {formatJmd(row.balanceDue)}
                                  </td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.daysPastDue}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.bucket}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </MobileTableAffordance>

                      <PaginationSummaryNav
                        className="mt-3"
                        from={agingPage.from}
                        to={agingPage.to}
                        totalCount={agingPage.totalCount}
                        page={agingPage.page}
                        totalPages={agingPage.totalPages}
                        hasPrev={agingPage.hasPrev}
                        hasNext={agingPage.hasNext}
                        prevHref={buildReportsHref({
                          agingPage: agingPage.hasPrev ? String(agingPage.page - 1) : null,
                        })}
                        nextHref={buildReportsHref({
                          agingPage: agingPage.hasNext ? String(agingPage.page + 1) : null,
                        })}
                      />
                    </>
                  )}
                </div>
              ) : null}

              {card.key === "location" ? (
                <div className="mt-4">
                  {report.locationPerformance.rows.length === 0 ? (
                    <p className="text-sm text-[var(--ccr-muted)]">
                      No location activity matched the selected historical range.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-5">
                        <Link
                          href={buildReportsHref({
                            locationBucket: locationBucketFilter === "bookings" ? null : "bookings",
                            locationPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            locationBucketFilter === "bookings"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Bookings
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {report.locationPerformance.totals.bookingCount}
                          </p>
                        </Link>
                        <Link
                          href={buildReportsHref({
                            locationBucket: locationBucketFilter === "revenue" ? null : "revenue",
                            locationPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            locationBucketFilter === "revenue"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Revenue
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {formatJmd(report.locationPerformance.totals.revenue)}
                          </p>
                        </Link>
                        <Link
                          href={buildReportsHref({
                            locationBucket: locationBucketFilter === "paid" ? null : "paid",
                            locationPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            locationBucketFilter === "paid"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Paid</p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {formatJmd(report.locationPerformance.totals.amountPaid)}
                          </p>
                        </Link>
                        <Link
                          href={buildReportsHref({
                            locationBucket: locationBucketFilter === "outstanding" ? null : "outstanding",
                            locationPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            locationBucketFilter === "outstanding"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Outstanding
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {formatJmd(report.locationPerformance.totals.outstanding)}
                          </p>
                        </Link>
                        <Link
                          href={buildReportsHref({
                            locationBucket:
                              locationBucketFilter === "cancellations" ? null : "cancellations",
                            locationPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            locationBucketFilter === "cancellations"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Cancellations
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {report.locationPerformance.totals.cancellationCount}
                          </p>
                        </Link>
                      </div>

                      <MobileTableAffordance className="mt-4">
                        <table className="w-full min-w-[920px] text-left text-sm">
                          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            <tr>
                              <SortableTh
                                className="px-3 py-2"
                                label="Location"
                                columnKey="location"
                                sort={locationSort}
                                href={locationSortHref("location", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Bookings"
                                columnKey="bookings"
                                sort={locationSort}
                                href={locationSortHref("bookings", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Revenue"
                                columnKey="revenue"
                                sort={locationSort}
                                href={locationSortHref("revenue", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Paid"
                                columnKey="paid"
                                sort={locationSort}
                                href={locationSortHref("paid", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Outstanding"
                                columnKey="outstanding"
                                sort={locationSort}
                                href={locationSortHref("outstanding", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Cancellations"
                                columnKey="cancellations"
                                sort={locationSort}
                                href={locationSortHref("cancellations", "desc")}
                                defaultDirection="desc"
                              />
                            </tr>
                          </thead>
                          <tbody>
                            {locationPage.rows.length === 0 ? (
                              <tr className="border-b border-[var(--ccr-border)] last:border-b-0">
                                <td
                                  colSpan={6}
                                  className="px-3 py-6 text-center text-sm text-[var(--ccr-muted)]"
                                >
                                  No locations match the selected bucket.
                                </td>
                              </tr>
                            ) : (
                              locationPage.rows.map((row) => (
                                <tr
                                  key={`location-${row.locationLabel}`}
                                  className="border-b border-[var(--ccr-border)] last:border-b-0"
                                >
                                  <td className="px-3 py-2 text-[var(--ccr-muted)]">
                                    <div className="space-y-1">
                                      <p className="font-medium text-[var(--ccr-text)]">{row.pickupLabel}</p>
                                      <p className="text-xs">
                                        Pickup: {row.pickupType} · Dropoff: {row.dropoffType}
                                      </p>
                                      {row.dropoffLabel !== row.pickupLabel ? (
                                        <p className="text-xs">Dropoff label: {row.dropoffLabel}</p>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.bookingCount}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(row.revenue)}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(row.amountPaid)}</td>
                                  <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]">
                                    {formatJmd(row.outstanding)}
                                  </td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">
                                    {row.cancellationCount}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </MobileTableAffordance>

                      <PaginationSummaryNav
                        className="mt-3"
                        from={locationPage.from}
                        to={locationPage.to}
                        totalCount={locationPage.totalCount}
                        page={locationPage.page}
                        totalPages={locationPage.totalPages}
                        hasPrev={locationPage.hasPrev}
                        hasNext={locationPage.hasNext}
                        prevHref={buildReportsHref({
                          locationPage:
                            locationPage.hasPrev ? String(locationPage.page - 1) : null,
                        })}
                        nextHref={buildReportsHref({
                          locationPage:
                            locationPage.hasNext ? String(locationPage.page + 1) : null,
                        })}
                      />
                    </>
                  )}
                </div>
              ) : null}

              {card.key === "funnel" ? (
                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
                  <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1">
                    <div
                      className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Pending</p>
                      <p className="mt-1 text-xl font-bold text-[var(--ccr-text)]">
                        {report.funnel.counts.pendingPayment}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                        Confirmed / Active
                      </p>
                      <p className="mt-1 text-xl font-bold text-[var(--ccr-text)]">
                        {report.funnel.counts.confirmedActive}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                        Completed / Returned
                      </p>
                      <p className="mt-1 text-xl font-bold text-[var(--ccr-text)]">
                        {report.funnel.counts.completedReturned}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                        Cancelled + Overridden
                      </p>
                      <p className="mt-1 text-xl font-bold text-[var(--ccr-text)]">
                        {report.funnel.counts.cancelled + report.funnel.counts.overridden}
                      </p>
                    </div>
                  </div>
                  <div
                    className={`space-y-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-4 text-sm ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                  >
                    <FunnelConversionRow
                      from="Pending"
                      to="Confirmed"
                      value={formatPercent(report.funnel.conversion.pendingToConfirmed)}
                    />
                    <FunnelConversionRow
                      from="Confirmed"
                      to="Completed"
                      value={formatPercent(report.funnel.conversion.confirmedToCompleted)}
                    />
                    <div className="flex items-center justify-between">
                      <span>Cancellation Rate</span>
                      <span className="font-semibold text-[var(--ccr-text)]">
                        {formatPercent(report.funnel.conversion.cancellationRate)}
                      </span>
                    </div>
                    <div className="pt-2 text-xs text-[var(--ccr-muted)]">
                      Total created in range: {report.funnel.counts.totalCreated}
                    </div>
                  </div>
                </div>
              ) : null}

              {card.key === "cohort" ? (
                <div className="mt-4">
                  {report.customerCohort.rows.length === 0 ? (
                    <p className="text-sm text-[var(--ccr-muted)]">
                      No cohort activity matched the selected historical range.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-4">
                        <Link
                          href={buildReportsHref({
                            cohortBucket: cohortBucketFilter === "total" ? null : "total",
                            cohortPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            cohortBucketFilter === "total"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Total Customers
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {report.customerCohort.summary.totalCustomers}
                          </p>
                        </Link>
                        <Link
                          href={buildReportsHref({
                            cohortBucket: cohortBucketFilter === "new" ? null : "new",
                            cohortPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            cohortBucketFilter === "new"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            New Customers
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {report.customerCohort.summary.newCustomers}
                          </p>
                        </Link>
                        <Link
                          href={buildReportsHref({
                            cohortBucket: cohortBucketFilter === "repeat" ? null : "repeat",
                            cohortPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            cohortBucketFilter === "repeat"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Repeat Customers
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {report.customerCohort.summary.repeatCustomers}
                          </p>
                        </Link>
                        <Link
                          href={buildReportsHref({
                            cohortBucket: cohortBucketFilter === "rate" ? null : "rate",
                            cohortPage: null,
                          })}
                          prefetch={false}
                          scroll={false}
                          className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                            cohortBucketFilter === "rate"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            Repeat Rate
                          </p>
                          <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                            {formatPercent(report.customerCohort.summary.repeatRate)}
                          </p>
                        </Link>
                      </div>

                      <MobileTableAffordance className="mt-4">
                        <table className="w-full min-w-[700px] text-left text-sm">
                          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            <tr>
                              <SortableTh
                                className="px-3 py-2"
                                label="Cohort"
                                columnKey="cohort"
                                sort={cohortSort}
                                href={cohortSortHref("cohort", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Customers"
                                columnKey="customers"
                                sort={cohortSort}
                                href={cohortSortHref("customers", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Bookings"
                                columnKey="bookings"
                                sort={cohortSort}
                                href={cohortSortHref("bookings", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Revenue"
                                columnKey="revenue"
                                sort={cohortSort}
                                href={cohortSortHref("revenue", "desc")}
                                defaultDirection="desc"
                              />
                            </tr>
                          </thead>
                          <tbody>
                            {cohortPage.rows.length === 0 ? (
                              <tr className="border-b border-[var(--ccr-border)] last:border-b-0">
                                <td
                                  colSpan={4}
                                  className="px-3 py-6 text-center text-sm text-[var(--ccr-muted)]"
                                >
                                  No cohorts match the selected bucket.
                                </td>
                              </tr>
                            ) : (
                              cohortPage.rows.map((row) => (
                                <tr
                                  key={`cohort-${row.cohortMonth}`}
                                  className="border-b border-[var(--ccr-border)] last:border-b-0"
                                >
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.cohortLabel}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.customerCount}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.bookingCount}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(row.revenue)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </MobileTableAffordance>

                      <PaginationSummaryNav
                        className="mt-3"
                        from={cohortPage.from}
                        to={cohortPage.to}
                        totalCount={cohortPage.totalCount}
                        page={cohortPage.page}
                        totalPages={cohortPage.totalPages}
                        hasPrev={cohortPage.hasPrev}
                        hasNext={cohortPage.hasNext}
                        prevHref={buildReportsHref({
                          cohortPage: cohortPage.hasPrev ? String(cohortPage.page - 1) : null,
                        })}
                        nextHref={buildReportsHref({
                          cohortPage: cohortPage.hasNext ? String(cohortPage.page + 1) : null,
                        })}
                      />
                    </>
                  )}
                </div>
              ) : null}

              {card.key === "upcoming" ? (
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-[var(--ccr-text)]">Pickups in range</h4>
                    {report.upcoming.pickups.length === 0 ? (
                      <p className="mt-2 text-sm text-[var(--ccr-muted)]">
                        No pickups matched the selected operational range.
                      </p>
                    ) : (
                      <>
                        <MobileTableAffordance className="mt-2 max-w-full rounded-xl border border-[var(--ccr-border)]">
                          <table className="w-full min-w-[760px] text-left text-sm">
                            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                              <tr>
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Booking"
                                  columnKey="booking"
                                  sort={pickupSort}
                                  href={pickupSortHref("booking", "asc")}
                                />
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Customer"
                                  columnKey="customer"
                                  sort={pickupSort}
                                  href={pickupSortHref("customer", "asc")}
                                />
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Vehicle"
                                  columnKey="vehicle"
                                  sort={pickupSort}
                                  href={pickupSortHref("vehicle", "asc")}
                                />
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Pickup"
                                  columnKey="pickup"
                                  sort={pickupSort}
                                  href={pickupSortHref("pickup", "asc")}
                                />
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Status"
                                  columnKey="status"
                                  sort={pickupSort}
                                  href={pickupSortHref("status", "asc")}
                                />
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Balance"
                                  columnKey="balance"
                                  sort={pickupSort}
                                  href={pickupSortHref("balance", "desc")}
                                  defaultDirection="desc"
                                />
                              </tr>
                            </thead>
                            <tbody>
                              {pickupPage.rows.map((row) => (
                                (() => {
                                  const substatusIndicators = resolveReportSubstatusIndicators({
                                    status: row.status,
                                    paymentOption: row.paymentOption,
                                    paymentStatus: row.paymentStatus,
                                    isNonBlocking: row.isNonBlocking,
                                  });

                                  return (
                                    <tr
                                      key={`pickup-${row.bookingId}`}
                                      className="border-b border-[var(--ccr-border)] last:border-b-0"
                                    >
                                      <td className="px-3 py-2">
                                        <Link
                                          href={`/admin/bookings/${row.bookingDbId}`}
                                          className="font-semibold text-[var(--ccr-text)] hover:underline"
                                        >
                                          {row.bookingId}
                                        </Link>
                                      </td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{row.customerName}</td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{row.vehicleLabel}</td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{row.pickupDate}</td>
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          <span className={`${STATUS_PILL_BASE_CLASS} ${statusChipClass()}`}>
                                            {formatStatusLabel(row.status)}
                                          </span>
                                          {substatusIndicators.map((indicator) => (
                                            <InfoTooltipIcon
                                              key={`pickup-${row.bookingId}-${indicator.key}`}
                                              message={indicator.message}
                                              variant={indicator.variant}
                                            />
                                          ))}
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">
                                        {row.balanceDue > 0 ? formatJmd(row.balanceDue) : "Paid"}
                                      </td>
                                    </tr>
                                  );
                                })()
                              ))}
                            </tbody>
                          </table>
                        </MobileTableAffordance>
                        <PaginationSummaryNav
                          from={pickupPage.from}
                          to={pickupPage.to}
                          totalCount={pickupPage.totalCount}
                          page={pickupPage.page}
                          totalPages={pickupPage.totalPages}
                          hasPrev={pickupPage.hasPrev}
                          hasNext={pickupPage.hasNext}
                          prevHref={buildReportsHref({
                            pickupPage: pickupPage.hasPrev ? String(pickupPage.page - 1) : null,
                          })}
                          nextHref={buildReportsHref({
                            pickupPage: pickupPage.hasNext ? String(pickupPage.page + 1) : null,
                          })}
                        />
                      </>
                    )}
                  </div>

                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-[var(--ccr-text)]">Returns in range</h4>
                    {report.upcoming.returns.length === 0 ? (
                      <p className="mt-2 text-sm text-[var(--ccr-muted)]">
                        No returns matched the selected operational range.
                      </p>
                    ) : (
                      <>
                        <MobileTableAffordance className="mt-2 max-w-full rounded-xl border border-[var(--ccr-border)]">
                          <table className="w-full min-w-[760px] text-left text-sm">
                            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                              <tr>
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Booking"
                                  columnKey="booking"
                                  sort={returnSort}
                                  href={returnSortHref("booking", "asc")}
                                />
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Customer"
                                  columnKey="customer"
                                  sort={returnSort}
                                  href={returnSortHref("customer", "asc")}
                                />
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Vehicle"
                                  columnKey="vehicle"
                                  sort={returnSort}
                                  href={returnSortHref("vehicle", "asc")}
                                />
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Return"
                                  columnKey="return"
                                  sort={returnSort}
                                  href={returnSortHref("return", "asc")}
                                />
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Status"
                                  columnKey="status"
                                  sort={returnSort}
                                  href={returnSortHref("status", "asc")}
                                />
                                <SortableTh
                                  className="px-3 py-2"
                                  label="Balance"
                                  columnKey="balance"
                                  sort={returnSort}
                                  href={returnSortHref("balance", "desc")}
                                  defaultDirection="desc"
                                />
                              </tr>
                            </thead>
                            <tbody>
                              {returnPage.rows.map((row) => (
                                (() => {
                                  const substatusIndicators = resolveReportSubstatusIndicators({
                                    status: row.status,
                                    paymentOption: row.paymentOption,
                                    paymentStatus: row.paymentStatus,
                                    isNonBlocking: row.isNonBlocking,
                                  });

                                  return (
                                    <tr
                                      key={`return-${row.bookingId}`}
                                      className="border-b border-[var(--ccr-border)] last:border-b-0"
                                    >
                                      <td className="px-3 py-2">
                                        <Link
                                          href={`/admin/bookings/${row.bookingDbId}`}
                                          className="font-semibold text-[var(--ccr-text)] hover:underline"
                                        >
                                          {row.bookingId}
                                        </Link>
                                      </td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{row.customerName}</td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{row.vehicleLabel}</td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">{row.returnDate}</td>
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          <span className={`${STATUS_PILL_BASE_CLASS} ${statusChipClass()}`}>
                                            {formatStatusLabel(row.status)}
                                          </span>
                                          {substatusIndicators.map((indicator) => (
                                            <InfoTooltipIcon
                                              key={`return-${row.bookingId}-${indicator.key}`}
                                              message={indicator.message}
                                              variant={indicator.variant}
                                            />
                                          ))}
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 text-[var(--ccr-text)]">
                                        {row.balanceDue > 0 ? formatJmd(row.balanceDue) : "Paid"}
                                      </td>
                                    </tr>
                                  );
                                })()
                              ))}
                            </tbody>
                          </table>
                        </MobileTableAffordance>
                        <PaginationSummaryNav
                          from={returnPage.from}
                          to={returnPage.to}
                          totalCount={returnPage.totalCount}
                          page={returnPage.page}
                          totalPages={returnPage.totalPages}
                          hasPrev={returnPage.hasPrev}
                          hasNext={returnPage.hasNext}
                          prevHref={buildReportsHref({
                            returnPage: returnPage.hasPrev ? String(returnPage.page - 1) : null,
                          })}
                          nextHref={buildReportsHref({
                            returnPage: returnPage.hasNext ? String(returnPage.page + 1) : null,
                          })}
                        />
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              {card.key === "impact" ? (
                <div className="mt-4">
                  <div className="mb-3 flex items-center justify-end">
                    <details className="group relative">
                      <summary className="flex list-none items-center gap-2 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] transition hover:ring-2 hover:ring-[var(--ccr-accent)] hover:ring-offset-1 hover:ring-offset-[var(--ccr-surface)] [&::-webkit-details-marker]:hidden">
                        Rows: {impactRowsPerPage}
                        <svg
                          viewBox="0 0 20 20"
                          className="h-3.5 w-3.5 text-[var(--ccr-muted)] transition group-open:rotate-180"
                          aria-hidden="true"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 7l5 6 5-6" />
                        </svg>
                      </summary>
                      <div className="absolute right-0 z-20 mt-2 w-28 overflow-hidden rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-lg">
                        {IMPACT_PAGE_SIZE_OPTIONS.map((option) => (
                          <Link
                            key={`impact-rows-${option}`}
                            href={buildReportsHref({
                              impactRows: String(option),
                              breakdownPage: null,
                              cancelPage: null,
                              refundPage: null,
                            })}
                            className={`block border-b border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold last:border-b-0 ${
                              option === impactRowsPerPage
                                ? "bg-[var(--ccr-surface-soft)] text-[var(--ccr-accent)]"
                                : "text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]"
                            }`}
                          >
                            {option}
                          </Link>
                        ))}
                      </div>
                    </details>
                  </div>

                  <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-5">
                    <Link
                      href={buildReportsHref({
                        impactBucket: impactBucketFilter === "cancelled" ? null : "cancelled",
                        breakdownPage: null,
                      })}
                      prefetch={false}
                      scroll={false}
                      className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                        impactBucketFilter === "cancelled"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                      }`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Cancelled</p>
                      <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                        {report.cancellationRefundImpact.summary.cancelledCount}
                      </p>
                    </Link>
                    <Link
                      href={buildReportsHref({
                        impactBucket: impactBucketFilter === "refundCount" ? null : "refundCount",
                        breakdownPage: null,
                      })}
                      prefetch={false}
                      scroll={false}
                      className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                        impactBucketFilter === "refundCount"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                      }`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Refund Count</p>
                      <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                        {report.cancellationRefundImpact.summary.refundCount}
                      </p>
                    </Link>
                    <Link
                      href={buildReportsHref({
                        impactBucket: impactBucketFilter === "refundTotal" ? null : "refundTotal",
                        breakdownPage: null,
                      })}
                      prefetch={false}
                      scroll={false}
                      className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                        impactBucketFilter === "refundTotal"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                      }`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Refund Total</p>
                      <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                        {formatJmd(report.cancellationRefundImpact.summary.refundTotal)}
                      </p>
                    </Link>
                    <Link
                      href={buildReportsHref({
                        impactBucket: impactBucketFilter === "grossPayments" ? null : "grossPayments",
                        breakdownPage: null,
                      })}
                      prefetch={false}
                      scroll={false}
                      className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                        impactBucketFilter === "grossPayments"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                      }`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Gross Payments</p>
                      <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                        {formatJmd(report.cancellationRefundImpact.summary.grossPayments)}
                      </p>
                    </Link>
                    <Link
                      href={buildReportsHref({
                        impactBucket: impactBucketFilter === "netImpact" ? null : "netImpact",
                        breakdownPage: null,
                      })}
                      prefetch={false}
                      scroll={false}
                      className={`block rounded-xl border p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS} ${
                        impactBucketFilter === "netImpact"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] ring-1 ring-[var(--ccr-accent)]"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                      }`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Net Impact</p>
                      <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                        {formatJmd(report.cancellationRefundImpact.summary.netImpact)}
                      </p>
                    </Link>
                  </div>

                  {report.cancellationRefundImpact.breakdown.length === 0 ? (
                    <p className="mt-3 text-sm text-[var(--ccr-muted)]">
                      No cancellation or refund activity matched the selected historical range.
                    </p>
                  ) : (
                    <>
                      <MobileTableAffordance className="mt-4 rounded-xl border border-[var(--ccr-border)]">
                        <table className="w-full min-w-[520px] text-left text-sm">
                          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            <tr>
                              <SortableTh
                                className="px-3 py-2"
                                label="Period"
                                columnKey="period"
                                sort={impactBreakdownSort}
                                href={impactBreakdownSortHref("period", "asc")}
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Cancellations"
                                columnKey="cancellations"
                                sort={impactBreakdownSort}
                                href={impactBreakdownSortHref("cancellations", "desc")}
                                defaultDirection="desc"
                              />
                              <SortableTh
                                className="px-3 py-2"
                                label="Refund Total"
                                columnKey="refundTotal"
                                sort={impactBreakdownSort}
                                href={impactBreakdownSortHref("refundTotal", "desc")}
                                defaultDirection="desc"
                              />
                            </tr>
                          </thead>
                          <tbody>
                            {breakdownPage.rows.length === 0 ? (
                              <tr className="border-b border-[var(--ccr-border)] last:border-b-0">
                                <td
                                  colSpan={3}
                                  className="px-3 py-6 text-center text-sm text-[var(--ccr-muted)]"
                                >
                                  No periods match the selected impact bucket.
                                </td>
                              </tr>
                            ) : (
                              breakdownPage.rows.map((row) => (
                                <tr
                                  key={`impact-breakdown-${row.periodStart}`}
                                  className="border-b border-[var(--ccr-border)] last:border-b-0"
                                >
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.periodLabel}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{row.cancellations}</td>
                                  <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(row.refundTotal)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </MobileTableAffordance>
                      <PaginationSummaryNav
                        from={breakdownPage.from}
                        to={breakdownPage.to}
                        totalCount={breakdownPage.totalCount}
                        page={breakdownPage.page}
                        totalPages={breakdownPage.totalPages}
                        hasPrev={breakdownPage.hasPrev}
                        hasNext={breakdownPage.hasNext}
                        prevHref={buildReportsHref({
                          breakdownPage:
                            breakdownPage.hasPrev ? String(breakdownPage.page - 1) : null,
                        })}
                        nextHref={buildReportsHref({
                          breakdownPage:
                            breakdownPage.hasNext ? String(breakdownPage.page + 1) : null,
                        })}
                      />
                    </>
                  )}

                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--ccr-text)]">Cancellations</h4>
                      {report.cancellationRefundImpact.cancellations.length === 0 ? (
                        <p className="mt-2 text-sm text-[var(--ccr-muted)]">No cancellations in range.</p>
                      ) : (
                        <>
                          <ul className="mt-2 space-y-2">
                            {cancellationPage.rows.map((row) => (
                              <li
                                key={`cancel-${row.bookingId}-${row.cancelledAt}`}
                                className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-semibold text-[var(--ccr-text)]">
                                    {row.bookingId} · {row.vehicleLabel}
                                  </p>
                                  <span className="text-xs text-[var(--ccr-muted)]">
                                    <DateTimeInline value={row.cancelledAt} />
                                  </span>
                                </div>
                                <p className="text-xs text-[var(--ccr-muted)]">
                                  {row.customerName} ·{" "}
                                  {row.isOverridden ? "Overridden" : formatStatusLabel(row.status)}
                                </p>
                                {row.cancellationReason ? (
                                  <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                                    Reason: {row.cancellationReason}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                          <PaginationSummaryNav
                            from={cancellationPage.from}
                            to={cancellationPage.to}
                            totalCount={cancellationPage.totalCount}
                            page={cancellationPage.page}
                            totalPages={cancellationPage.totalPages}
                            hasPrev={cancellationPage.hasPrev}
                            hasNext={cancellationPage.hasNext}
                            prevHref={buildReportsHref({
                              cancelPage:
                                cancellationPage.hasPrev ? String(cancellationPage.page - 1) : null,
                            })}
                            nextHref={buildReportsHref({
                              cancelPage:
                                cancellationPage.hasNext ? String(cancellationPage.page + 1) : null,
                            })}
                          />
                        </>
                      )}
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-[var(--ccr-text)]">Refunds</h4>
                      {report.cancellationRefundImpact.refunds.length === 0 ? (
                        <p className="mt-2 text-sm text-[var(--ccr-muted)]">No refunds in range.</p>
                      ) : (
                        <>
                          <ul className="mt-2 space-y-2">
                            {refundPage.rows.map((row) => (
                              <li
                                key={`refund-${row.paymentId}`}
                                className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-semibold text-[var(--ccr-text)]">
                                    {row.bookingId} · {row.vehicleLabel}
                                  </p>
                                  <span className="text-sm font-semibold text-[var(--ccr-text)]">
                                    {formatJmd(row.amount)}
                                  </span>
                                </div>
                                <p className="text-xs text-[var(--ccr-muted)]">
                                  {row.customerName} · {row.provider} · {fmtDateOnly(row.refundedAt)}
                                </p>
                              </li>
                            ))}
                          </ul>
                          <PaginationSummaryNav
                            from={refundPage.from}
                            to={refundPage.to}
                            totalCount={refundPage.totalCount}
                            page={refundPage.page}
                            totalPages={refundPage.totalPages}
                            hasPrev={refundPage.hasPrev}
                            hasNext={refundPage.hasNext}
                            prevHref={buildReportsHref({
                              refundPage: refundPage.hasPrev ? String(refundPage.page - 1) : null,
                            })}
                            nextHref={buildReportsHref({
                              refundPage: refundPage.hasNext ? String(refundPage.page + 1) : null,
                            })}
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
