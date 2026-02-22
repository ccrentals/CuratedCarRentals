import Link from "next/link";

import { InfoTooltipIcon } from "@/components/admin/InfoTooltipIcon";
import { MobileTableAffordance } from "@/components/admin/MobileTableAffordance";
import { PaginationSummaryNav } from "@/components/admin/PaginationSummaryNav";
import { ReportsGranularityTabs } from "@/components/admin/ReportsGranularityTabs";
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
};

type ReportExportFormat = "csv" | "excel" | "pdf";
type ReportExportKey =
  | "outstanding_balances"
  | "pickups"
  | "returns"
  | "upcoming_combined"
  | "cancellations_refunds";
type ImpactPageSize = 5 | 10 | 20 | 30 | 50;

const REPORT_CARDS = [
  {
    key: "revenue",
    title: "Revenue by Period",
    description:
      "Gross/net revenue by period. Revenue uses payment dates when available, then booking created date fallback for confirmed/returned bookings with no payments.",
  },
  {
    key: "utilization",
    title: "Vehicle Utilization",
    description:
      "Booked days vs available days in the selected range. Booked-day overlap is counted by day boundary.",
  },
  {
    key: "outstanding",
    title: "Outstanding Balances",
    description:
      "Bookings with balance due, including pickup urgency and payment status for collection prioritization.",
  },
  {
    key: "funnel",
    title: "Booking Status Funnel",
    description:
      "Conversion from pending to confirmed to completed, with cancellation and overridden booking visibility.",
  },
  {
    key: "upcoming",
    title: "Upcoming Pickups & Returns",
    description:
      "Operational pickup/return lists with status and outstanding balance indicators.",
  },
  {
    key: "impact",
    title: "Cancellation & Refund Impact",
    description:
      "Cancellation counts, refund totals, net impact, and period-based breakdown.",
  },
] as const;
const REPORT_EXPORT_FORMAT_OPTIONS: Array<{ key: ReportExportFormat; label: string }> = [
  { key: "csv", label: "CSV" },
  { key: "pdf", label: "PDF" },
  { key: "excel", label: "Excel" },
];
const IMPACT_PAGE_SIZE_OPTIONS: ImpactPageSize[] = [5, 10, 20, 30, 50];

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function urgencyLabel(daysFromPickup: number) {
  if (daysFromPickup >= 0) return `${daysFromPickup} day(s) until pickup`;
  return `${Math.abs(daysFromPickup)} day(s) past pickup`;
}

function statusChipClass() {
  return "border-sky-300/30 bg-sky-500/15 text-sky-100";
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
  const rowsPerPage = normalizePageSize(
    typeof params.rows === "string" ? params.rows : undefined,
    STANDARD_PAGE_SIZE_OPTIONS,
    10,
  ) as StandardPageSize;
  const impactRowsPerPage = normalizePageSize(
    typeof params.impactRows === "string" ? params.impactRows : undefined,
    IMPACT_PAGE_SIZE_OPTIONS,
    5,
  ) as ImpactPageSize;

  const report = await getAdminReportsPayload({
    dateFrom: typeof params.dateFrom === "string" ? params.dateFrom : undefined,
    dateTo: typeof params.dateTo === "string" ? params.dateTo : undefined,
    vehicleId: typeof params.vehicleId === "string" ? params.vehicleId : undefined,
    revenueGranularity:
      typeof params.revenueGranularity === "string" ? params.revenueGranularity : undefined,
  });

  const filters = report.filters;
  const baseFilterQuery = buildReportsFilterQueryString(filters);
  const baseUiQuery = new URLSearchParams(baseFilterQuery);
  if (rowsPerPage !== 10) {
    baseUiQuery.set("rows", String(rowsPerPage));
  }
  if (impactRowsPerPage !== 5) {
    baseUiQuery.set("impactRows", String(impactRowsPerPage));
  }
  for (const key of [
    "outstandingPage",
    "pickupPage",
    "returnPage",
    "breakdownPage",
    "cancelPage",
    "refundPage",
  ]) {
    const raw = params[key];
    if (typeof raw === "string" && raw.trim().length > 0) {
      baseUiQuery.set(key, raw);
    }
  }

  const vehicles = await dbQuery<VehicleRow>(
    "select id, make, model from vehicles where status <> 'INACTIVE' order by make, model",
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

  const visibleRevenuePoints = report.revenue.points.filter(
    (point) =>
      point.grossRevenue !== 0 ||
      point.refunds !== 0 ||
      point.netRevenue !== 0 ||
      point.paymentCount !== 0 ||
      point.fallbackBookingCount !== 0 ||
      point.fallbackRevenue !== 0,
  );
  const maxRevenue = Math.max(1, ...visibleRevenuePoints.map((point) => point.grossRevenue));

  const outstandingPage = paginateRows(
    report.outstandingBalances.rows,
    params.outstandingPage,
    rowsPerPage,
  );
  const pickupPage = paginateRows(report.upcoming.pickups, params.pickupPage, rowsPerPage);
  const returnPage = paginateRows(report.upcoming.returns, params.returnPage, rowsPerPage);
  const breakdownPage = paginateRows(
    report.cancellationRefundImpact.breakdown,
    params.breakdownPage,
    impactRowsPerPage,
  );
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

      <form className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
        <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-[1fr_1fr_1.5fr_140px_auto_auto] md:gap-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Date From
            <input
              type="date"
              name="dateFrom"
              defaultValue={filters.dateFrom}
              className="promo-date-time-input mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Date To
            <input
              type="date"
              name="dateTo"
              defaultValue={filters.dateTo}
              className="promo-date-time-input mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
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
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
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
          <button
            type="submit"
            className="mt-0 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white md:mt-6"
          >
            Apply
          </button>
          <Link
            href="/admin/reports"
            className="mt-0 rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-center text-xs font-semibold text-[var(--ccr-text)] md:mt-6"
          >
            Reset
          </Link>
        </div>
      </form>

      <section className="mt-6 grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-4 md:gap-4">
        <div
          className={`min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 ${REPORT_BLOCK_RING_ON_BG_CLASS}`}
        >
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Gross Revenue</p>
          <MetricCurrencyValue amount={report.revenue.totals.grossRevenue} />
        </div>
        <div
          className={`min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 ${REPORT_BLOCK_RING_ON_BG_CLASS}`}
        >
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Net Revenue</p>
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
          <span className="rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-accent)] transition hover:ring-2 hover:ring-[var(--ccr-accent)] hover:ring-offset-1 hover:ring-offset-[var(--ccr-surface)]">
            Live
          </span>
        </div>

        <div className="mt-4 space-y-4">
          {REPORT_CARDS.map((card) => (
            <article
              key={card.key}
              className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-[var(--ccr-text)]">{card.title}</h3>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">{card.description}</p>
                </div>
                {card.key === "outstanding" ? (
                  <ReportExportDropdown
                    label="Export"
                    hrefs={exportHrefSet("outstanding_balances")}
                  />
                ) : null}
                {card.key === "upcoming" ? (
                  <div className="flex flex-wrap gap-2">
                    <ReportExportDropdown label="Export Pickups" hrefs={exportHrefSet("pickups")} />
                    <ReportExportDropdown label="Export Returns" hrefs={exportHrefSet("returns")} />
                    <ReportExportDropdown
                      label="Export Both"
                      hrefs={exportHrefSet("upcoming_combined")}
                    />
                  </div>
                ) : null}
                {card.key === "impact" ? (
                  <ReportExportDropdown
                    label="Export"
                    hrefs={exportHrefSet("cancellations_refunds")}
                  />
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
                      Payments: {report.revenue.totals.paymentCount} · Fallback bookings:{" "}
                      {report.revenue.totals.fallbackBookingCount}
                    </p>
                  </div>

                  {visibleRevenuePoints.length === 0 ? (
                    <p className="mt-4 text-sm text-[var(--ccr-muted)]">
                      No data for selected range.
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
                        {visibleRevenuePoints.map((point) => (
                          <div
                            key={point.periodStart}
                            className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3 ${REPORT_BLOCK_RING_ON_BG_CLASS}`}
                          >
                            <span className="block text-xs font-semibold text-[var(--ccr-text)]">
                              {point.periodLabel}
                            </span>
                            <span className="mt-1 block text-sm font-semibold text-[var(--ccr-text)]">
                              {formatJmd(point.grossRevenue)}
                            </span>
                            <div className="mt-2 h-2 rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]">
                              <div
                                className="h-full rounded-full bg-[var(--ccr-accent)]"
                                style={{
                                  width: `${normalizeRevenueBarWidthPercent(
                                    point.grossRevenue,
                                    maxRevenue,
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      <MobileTableAffordance className="mt-4 rounded-xl border border-[var(--ccr-border)]">
                        <table className="w-full min-w-[780px] text-left text-sm">
                          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            <tr>
                              <th className="px-3 py-2">Period</th>
                              <th className="px-3 py-2">Gross</th>
                              <th className="px-3 py-2">Refunds</th>
                              <th className="px-3 py-2">Net</th>
                              <th className="px-3 py-2">Payments</th>
                              <th className="px-3 py-2">Fallback Bookings</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleRevenuePoints.map((point) => (
                              <tr
                                key={`revenue-row-${point.periodStart}`}
                                className="border-b border-[var(--ccr-border)] last:border-b-0"
                              >
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{point.periodLabel}</td>
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(point.grossRevenue)}</td>
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(point.refunds)}</td>
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(point.netRevenue)}</td>
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{point.paymentCount}</td>
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{point.fallbackBookingCount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </MobileTableAffordance>
                    </>
                  )}
                </div>
              ) : null}

              {card.key === "utilization" ? (
                <div className="mt-4">
                  {!report.utilization.includesBlockouts ? (
                    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Blockouts table not found. Utilization is currently based on booked days only.
                    </div>
                  ) : null}

                  {report.utilization.rows.length === 0 ? (
                    <p className="text-sm text-[var(--ccr-muted)]">No data for selected range.</p>
                  ) : (
                    <MobileTableAffordance>
                      <table className="w-full min-w-[760px] text-left text-sm">
                        <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                          <tr>
                            <th className="px-3 py-2">Vehicle</th>
                            <th className="px-3 py-2">Booked Days</th>
                            <th className="px-3 py-2">Available Days</th>
                            <th className="px-3 py-2">Blockout Days</th>
                            <th className="px-3 py-2">Utilization</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.utilization.rows.map((row) => (
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
                                  <div className="h-2 w-24 rounded-full bg-[var(--ccr-surface-soft)]">
                                    <div
                                      className="h-2 rounded-full bg-[var(--ccr-primary)]"
                                      style={{ width: `${Math.max(2, row.utilizationPercent)}%` }}
                                    />
                                  </div>
                                  <span>{row.utilizationPercent.toFixed(1)}%</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </MobileTableAffordance>
                  )}
                </div>
              ) : null}

              {card.key === "outstanding" ? (
                <div className="mt-4">
                  {report.outstandingBalances.rows.length === 0 ? (
                    <p className="text-sm text-[var(--ccr-muted)]">No data for selected range.</p>
                  ) : (
                    <>
                      <MobileTableAffordance>
                        <table className="w-full min-w-[1060px] text-left text-sm">
                          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            <tr>
                              <th className="px-3 py-2">Booking</th>
                              <th className="px-3 py-2">Customer</th>
                              <th className="px-3 py-2">Vehicle</th>
                              <th className="px-3 py-2">Pickup</th>
                              <th className="px-3 py-2">Return</th>
                              <th className="px-3 py-2">Total</th>
                              <th className="px-3 py-2">Paid</th>
                              <th className="px-3 py-2">Balance</th>
                              <th className="px-3 py-2">Timing</th>
                              <th className="px-3 py-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {outstandingPage.rows.map((row) => (
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
                                        href={`/admin/bookings/${row.bookingId}`}
                                        className="font-semibold text-[var(--ccr-text)] hover:underline"
                                      >
                                        {row.bookingId.slice(0, 8)}
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
                            ))}
                            <tr className="bg-[var(--ccr-bg)]">
                              <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]" colSpan={7}>
                                Totals
                              </td>
                              <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]">
                                {formatJmd(report.outstandingBalances.totals.totalOutstandingAmount)}
                              </td>
                              <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]" colSpan={2}>
                                {report.outstandingBalances.totals.outstandingCount} booking(s)
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

              {card.key === "upcoming" ? (
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-[var(--ccr-text)]">Pickups in range</h4>
                    {report.upcoming.pickups.length === 0 ? (
                      <p className="mt-2 text-sm text-[var(--ccr-muted)]">No data for selected range.</p>
                    ) : (
                      <>
                        <MobileTableAffordance className="mt-2 max-w-full rounded-xl border border-[var(--ccr-border)]">
                          <table className="w-full min-w-[760px] text-left text-sm">
                            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                              <tr>
                                <th className="px-3 py-2">Booking</th>
                                <th className="px-3 py-2">Customer</th>
                                <th className="px-3 py-2">Vehicle</th>
                                <th className="px-3 py-2">Pickup</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Balance</th>
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
                                          href={`/admin/bookings/${row.bookingId}`}
                                          className="font-semibold text-[var(--ccr-text)] hover:underline"
                                        >
                                          {row.bookingId.slice(0, 8)}
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
                      <p className="mt-2 text-sm text-[var(--ccr-muted)]">No data for selected range.</p>
                    ) : (
                      <>
                        <MobileTableAffordance className="mt-2 max-w-full rounded-xl border border-[var(--ccr-border)]">
                          <table className="w-full min-w-[760px] text-left text-sm">
                            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                              <tr>
                                <th className="px-3 py-2">Booking</th>
                                <th className="px-3 py-2">Customer</th>
                                <th className="px-3 py-2">Vehicle</th>
                                <th className="px-3 py-2">Return</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Balance</th>
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
                                          href={`/admin/bookings/${row.bookingId}`}
                                          className="font-semibold text-[var(--ccr-text)] hover:underline"
                                        >
                                          {row.bookingId.slice(0, 8)}
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
                    <div
                      className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Cancelled</p>
                      <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                        {report.cancellationRefundImpact.summary.cancelledCount}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Refund Count</p>
                      <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                        {report.cancellationRefundImpact.summary.refundCount}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Refund Total</p>
                      <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                        {formatJmd(report.cancellationRefundImpact.summary.refundTotal)}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Gross Payments</p>
                      <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                        {formatJmd(report.cancellationRefundImpact.summary.grossPayments)}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 ${REPORT_BLOCK_RING_ON_SURFACE_CLASS}`}
                    >
                      <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Net Impact</p>
                      <p className="mt-1 font-semibold text-[var(--ccr-text)]">
                        {formatJmd(report.cancellationRefundImpact.summary.netImpact)}
                      </p>
                    </div>
                  </div>

                  {report.cancellationRefundImpact.breakdown.length === 0 ? (
                    <p className="mt-3 text-sm text-[var(--ccr-muted)]">No data for selected range.</p>
                  ) : (
                    <>
                      <MobileTableAffordance className="mt-4 rounded-xl border border-[var(--ccr-border)]">
                        <table className="w-full min-w-[520px] text-left text-sm">
                          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                            <tr>
                              <th className="px-3 py-2">Period</th>
                              <th className="px-3 py-2">Cancellations</th>
                              <th className="px-3 py-2">Refund Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {breakdownPage.rows.map((row) => (
                              <tr
                                key={`impact-breakdown-${row.periodStart}`}
                                className="border-b border-[var(--ccr-border)] last:border-b-0"
                              >
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{row.periodLabel}</td>
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{row.cancellations}</td>
                                <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(row.refundTotal)}</td>
                              </tr>
                            ))}
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
                                    {row.bookingId.slice(0, 8)} · {row.vehicleLabel}
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
                                    {row.bookingId.slice(0, 8)} · {row.vehicleLabel}
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
