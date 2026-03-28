import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { formatJmd } from "@/lib/money";
import { buildAdminExportPdf } from "@/lib/pdf/adminExportPdf";
import {
  buildReportsFilterQueryString,
  getAdminReportsPayload,
  type AdminReportsPayload,
  type ReportSectionMeta,
  type ReportsFilterInput,
} from "@/lib/reports/adminReports";

export type ReportsRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  getPayload: (filters: ReportsFilterInput) => Promise<AdminReportsPayload>;
};

const DEFAULT_DEPS: ReportsRouteDeps = {
  getSession: () => getSessionFromRequest(),
  getPayload: (filters) => getAdminReportsPayload(filters),
};

type ExportFormat = "csv" | "excel" | "pdf";
type ExportReportKey =
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
  | "upcoming_combined"
  | "cancellations_refunds";

type ExportCell = string | number | null | undefined;

type ExportSpec = {
  title: string;
  subtitle: string;
  sectionMeta: ReportSectionMeta;
  scopeLabel: string;
  vehicleLabel: string;
  warnings: string[];
  summary: Array<{ label: string; value: string }>;
  headers: string[];
  rows: ExportCell[][];
  emptyState: string;
};

function parseFilters(searchParams: URLSearchParams): ReportsFilterInput {
  return {
    snapshotDate: searchParams.get("snapshotDate"),
    rangeFrom: searchParams.get("rangeFrom") ?? searchParams.get("dateFrom"),
    rangeTo: searchParams.get("rangeTo") ?? searchParams.get("dateTo"),
    dateFrom: searchParams.get("dateFrom"),
    dateTo: searchParams.get("dateTo"),
    vehicleId: searchParams.get("vehicleId"),
    revenueGranularity: searchParams.get("revenueGranularity"),
  };
}

function isExportFormat(value: unknown): value is ExportFormat {
  return value === "csv" || value === "excel" || value === "pdf";
}

function isExportReportKey(value: unknown): value is ExportReportKey {
  return (
    value === "cash_collections" ||
    value === "vehicle_profitability" ||
    value === "vehicle_utilization" ||
    value === "outstanding_balances" ||
    value === "aging_receivables" ||
    value === "location_performance" ||
    value === "booking_status_funnel" ||
    value === "customer_cohort" ||
    value === "pickups" ||
    value === "returns" ||
    value === "upcoming_combined" ||
    value === "cancellations_refunds"
  );
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeTextCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "0.0%";
  return `${Number(value).toFixed(1)}%`;
}

function formatGeneratedAt(value: string) {
  return new Date(value).toLocaleString("en-JM", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function titleForKey(key: ExportReportKey) {
  if (key === "cash_collections") return "Cash Collections by Period";
  if (key === "vehicle_profitability") return "Vehicle Profitability";
  if (key === "vehicle_utilization") return "Vehicle Utilization";
  if (key === "outstanding_balances") return "Outstanding Balances";
  if (key === "aging_receivables") return "Aging Receivables";
  if (key === "location_performance") return "Location Performance";
  if (key === "booking_status_funnel") return "Booking Status Funnel";
  if (key === "customer_cohort") return "Customer Cohort";
  if (key === "pickups") return "Upcoming Pickups";
  if (key === "returns") return "Upcoming Returns";
  if (key === "upcoming_combined") return "Upcoming Pickups and Returns";
  return "Cancellations and Refund Impact";
}

function sectionMetaForKey(payload: AdminReportsPayload, key: ExportReportKey): ReportSectionMeta {
  if (key === "cash_collections") return payload.sectionMeta.revenue;
  if (key === "vehicle_profitability") return payload.sectionMeta.vehicleProfitability;
  if (key === "vehicle_utilization") return payload.sectionMeta.utilization;
  if (key === "outstanding_balances") return payload.sectionMeta.outstandingBalances;
  if (key === "aging_receivables") return payload.sectionMeta.agingReceivables;
  if (key === "location_performance") return payload.sectionMeta.locationPerformance;
  if (key === "booking_status_funnel") return payload.sectionMeta.funnel;
  if (key === "customer_cohort") return payload.sectionMeta.customerCohort;
  if (key === "pickups" || key === "returns" || key === "upcoming_combined") {
    return payload.sectionMeta.upcoming;
  }
  return payload.sectionMeta.cancellationRefundImpact;
}

function scopeLabelForKey(payload: AdminReportsPayload, key: ExportReportKey) {
  if (key === "outstanding_balances" || key === "aging_receivables") {
    return `Snapshot Date: ${payload.filters.snapshotDate}`;
  }
  return `Range: ${payload.filters.rangeFrom} to ${payload.filters.rangeTo}`;
}

function resolveVehicleLabel(payload: AdminReportsPayload) {
  if (!payload.filters.vehicleId) return "All vehicles";

  const candidates: Array<{ vehicleId?: string; vehicleLabel?: string }> = [
    ...payload.vehicleProfitability.rows,
    ...payload.utilization.rows,
    ...payload.outstandingBalances.rows,
    ...payload.agingReceivables.rows,
    ...payload.upcoming.pickups,
    ...payload.upcoming.returns,
    ...payload.cancellationRefundImpact.cancellations,
    ...payload.cancellationRefundImpact.refunds,
  ];

  for (const row of candidates) {
    if (typeof row.vehicleLabel !== "string" || row.vehicleLabel.trim().length === 0) continue;
    if (!("vehicleId" in row) || row.vehicleId === payload.filters.vehicleId) {
      return row.vehicleLabel;
    }
  }

  return payload.filters.vehicleId;
}

function buildCommonMetadata(payload: AdminReportsPayload, sectionMeta: ReportSectionMeta, scopeLabel: string) {
  const vehicleLabel = resolveVehicleLabel(payload);
  const metadata = [
    `Generated: ${formatGeneratedAt(payload.generatedAt)} (America/Jamaica)`,
    `Mode: ${sectionMeta.mode === "operational" ? "Operational snapshot" : "Historical analysis"}`,
    `Date basis: ${sectionMeta.dateBasisLabel}`,
    scopeLabel,
    `Vehicle: ${vehicleLabel}`,
  ];

  return { metadata, vehicleLabel };
}

function buildExportSpec(key: ExportReportKey, payload: AdminReportsPayload): ExportSpec {
  const sectionMeta = sectionMetaForKey(payload, key);
  const scopeLabel = scopeLabelForKey(payload, key);
  const common = buildCommonMetadata(payload, sectionMeta, scopeLabel);

  if (key === "cash_collections") {
    return {
      title: titleForKey(key),
      subtitle: "Payment activity grouped by payment date. Bookings without payments are excluded.",
      sectionMeta,
      scopeLabel,
      vehicleLabel: common.vehicleLabel,
      warnings: sectionMeta.warnings,
      summary: [
        { label: "Gross Collections", value: formatJmd(payload.revenue.totals.grossRevenue) },
        { label: "Refunds", value: formatJmd(payload.revenue.totals.refunds) },
        { label: "Net Collections", value: formatJmd(payload.revenue.totals.netRevenue) },
        { label: "Payments", value: String(payload.revenue.totals.paymentCount) },
      ],
      headers: ["Period", "Gross Collections", "Refunds", "Net Collections", "Payments"],
      rows: payload.revenue.points.map((point) => [
        point.periodLabel,
        point.grossRevenue,
        point.refunds,
        point.netRevenue,
        point.paymentCount,
      ]),
      emptyState: "No payment activity matched the selected historical range.",
    };
  }

  if (key === "vehicle_profitability") {
    return {
      title: titleForKey(key),
      subtitle: "Historical profitability based on booking overlap and maintenance cost availability.",
      sectionMeta,
      scopeLabel,
      vehicleLabel: common.vehicleLabel,
      warnings: sectionMeta.warnings,
      summary: [
        { label: "Vehicles", value: String(payload.vehicleProfitability.totals.vehicleCount) },
        { label: "Gross Revenue", value: formatJmd(payload.vehicleProfitability.totals.grossRevenue) },
        { label: "Maintenance", value: formatJmd(payload.vehicleProfitability.totals.maintenanceCost) },
        { label: "Net Profit", value: formatJmd(payload.vehicleProfitability.totals.netProfit) },
      ],
      headers: ["Vehicle", "Bookings", "Revenue", "Refunds", "Maintenance", "Net Profit", "Margin"],
      rows: payload.vehicleProfitability.rows.map((row) => [
        row.vehicleLabel,
        row.bookingCount,
        row.grossRevenue,
        row.refunds,
        row.maintenanceCost,
        row.netProfit,
        formatPercent(row.marginPercent),
      ]),
      emptyState: "No vehicle profitability data matched the selected historical range.",
    };
  }

  if (key === "vehicle_utilization") {
    const bookedDays = payload.utilization.rows.reduce((sum, row) => sum + row.bookedDays, 0);
    const availableDays = payload.utilization.rows.reduce((sum, row) => sum + row.availableDays, 0);
    const averageUtilization =
      payload.utilization.rows.length > 0
        ? payload.utilization.rows.reduce((sum, row) => sum + row.utilizationPercent, 0) /
          payload.utilization.rows.length
        : 0;
    return {
      title: titleForKey(key),
      subtitle: "Historical booked-vs-available day analysis across the selected range.",
      sectionMeta,
      scopeLabel,
      vehicleLabel: common.vehicleLabel,
      warnings: sectionMeta.warnings,
      summary: [
        { label: "Vehicles", value: String(payload.utilization.rows.length) },
        { label: "Booked Days", value: String(bookedDays) },
        { label: "Available Days", value: String(availableDays) },
        { label: "Avg Utilization", value: formatPercent(averageUtilization) },
      ],
      headers: ["Vehicle", "Booked Days", "Blockout Days", "Available Days", "Utilization"],
      rows: payload.utilization.rows.map((row) => [
        row.vehicleLabel,
        row.bookedDays,
        row.blockoutDays,
        row.availableDays,
        formatPercent(row.utilizationPercent),
      ]),
      emptyState: "No utilization data matched the selected historical range.",
    };
  }

  if (key === "outstanding_balances") {
    return {
      title: titleForKey(key),
      subtitle: "Open balances evaluated as of the selected snapshot date.",
      sectionMeta,
      scopeLabel,
      vehicleLabel: common.vehicleLabel,
      warnings: sectionMeta.warnings,
      summary: [
        {
          label: "Outstanding Amount",
          value: formatJmd(payload.outstandingBalances.totals.totalOutstandingAmount),
        },
        { label: "Outstanding Bookings", value: String(payload.outstandingBalances.totals.outstandingCount) },
      ],
      headers: [
        "Booking ID",
        "Customer",
        "Vehicle",
        "Pickup Date",
        "Return Date",
        "Status",
        "Payment Option",
        "Payment Status",
        "Total",
        "Amount Paid",
        "Balance Due",
        "Days From Pickup",
      ],
      rows: payload.outstandingBalances.rows.map((row) => [
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
      ]),
      emptyState: "No open balances existed on the selected snapshot date.",
    };
  }

  if (key === "aging_receivables") {
    return {
      title: titleForKey(key),
      subtitle: "Open receivables aged from pickup due date as of the selected snapshot date.",
      sectionMeta,
      scopeLabel,
      vehicleLabel: common.vehicleLabel,
      warnings: sectionMeta.warnings,
      summary: [
        { label: "Outstanding", value: formatJmd(payload.agingReceivables.totals.totalOutstandingAmount) },
        { label: "Outstanding Count", value: String(payload.agingReceivables.totals.outstandingCount) },
        { label: "Overdue", value: formatJmd(payload.agingReceivables.totals.overdueAmount) },
        { label: "Overdue Count", value: String(payload.agingReceivables.totals.overdueCount) },
      ],
      headers: ["Booking ID", "Customer", "Vehicle", "Pickup Due Date", "Balance Due", "Days Past Due", "Bucket"],
      rows: payload.agingReceivables.rows.map((row) => [
        row.bookingId,
        row.customerName,
        row.vehicleLabel,
        row.pickupDate,
        row.balanceDue,
        row.daysPastDue,
        row.bucket,
      ]),
      emptyState: "No aged receivables existed on the selected snapshot date.",
    };
  }

  if (key === "location_performance") {
    return {
      title: titleForKey(key),
      subtitle: "Historical pickup-location performance grouped by pickup date.",
      sectionMeta,
      scopeLabel,
      vehicleLabel: common.vehicleLabel,
      warnings: sectionMeta.warnings,
      summary: [
        { label: "Bookings", value: String(payload.locationPerformance.totals.bookingCount) },
        { label: "Revenue", value: formatJmd(payload.locationPerformance.totals.revenue) },
        { label: "Paid", value: formatJmd(payload.locationPerformance.totals.amountPaid) },
        { label: "Outstanding", value: formatJmd(payload.locationPerformance.totals.outstanding) },
      ],
      headers: ["Pickup Location", "Bookings", "Revenue", "Amount Paid", "Outstanding", "Cancellations"],
      rows: payload.locationPerformance.rows.map((row) => [
        row.locationLabel,
        row.bookingCount,
        row.revenue,
        row.amountPaid,
        row.outstanding,
        row.cancellationCount,
      ]),
      emptyState: "No location activity matched the selected historical range.",
    };
  }

  if (key === "booking_status_funnel") {
    return {
      title: titleForKey(key),
      subtitle: "Historical booking conversion based on booking created date.",
      sectionMeta,
      scopeLabel,
      vehicleLabel: common.vehicleLabel,
      warnings: sectionMeta.warnings,
      summary: [
        { label: "Total Created", value: String(payload.funnel.counts.totalCreated) },
        { label: "Confirmed Active", value: String(payload.funnel.counts.confirmedActive) },
        { label: "Completed", value: String(payload.funnel.counts.completedReturned) },
        { label: "Cancellation Rate", value: formatPercent(payload.funnel.conversion.cancellationRate) },
      ],
      headers: ["Metric", "Count", "Rate"],
      rows: [
        ["Pending Payment", payload.funnel.counts.pendingPayment, ""],
        ["Confirmed Active", payload.funnel.counts.confirmedActive, ""],
        ["Completed / Returned", payload.funnel.counts.completedReturned, ""],
        ["Cancelled", payload.funnel.counts.cancelled, ""],
        ["Overridden", payload.funnel.counts.overridden, ""],
        ["Total Created", payload.funnel.counts.totalCreated, ""],
        ["Pending -> Confirmed", "", formatPercent(payload.funnel.conversion.pendingToConfirmed)],
        ["Confirmed -> Completed", "", formatPercent(payload.funnel.conversion.confirmedToCompleted)],
        ["Cancellation Rate", "", formatPercent(payload.funnel.conversion.cancellationRate)],
      ],
      emptyState: "No booking status funnel data matched the selected historical range.",
    };
  }

  if (key === "customer_cohort") {
    return {
      title: titleForKey(key),
      subtitle: "Historical first-booking cohort analysis with global first-booking identity.",
      sectionMeta,
      scopeLabel,
      vehicleLabel: common.vehicleLabel,
      warnings: sectionMeta.warnings,
      summary: [
        { label: "Total Customers", value: String(payload.customerCohort.summary.totalCustomers) },
        { label: "New Customers", value: String(payload.customerCohort.summary.newCustomers) },
        { label: "Repeat Customers", value: String(payload.customerCohort.summary.repeatCustomers) },
        { label: "Repeat Rate", value: formatPercent(payload.customerCohort.summary.repeatRate) },
      ],
      headers: ["Cohort Month", "Customers", "Bookings", "Revenue"],
      rows: payload.customerCohort.rows.map((row) => [
        row.cohortLabel,
        row.customerCount,
        row.bookingCount,
        row.revenue,
      ]),
      emptyState: "No cohort activity matched the selected historical range.",
    };
  }

  if (key === "pickups") {
    return {
      title: titleForKey(key),
      subtitle: "Operational pickup list for the selected range window.",
      sectionMeta,
      scopeLabel,
      vehicleLabel: common.vehicleLabel,
      warnings: sectionMeta.warnings,
      summary: [
        { label: "Pickups", value: String(payload.upcoming.pickups.length) },
        {
          label: "Open Balances",
          value: formatJmd(payload.upcoming.pickups.reduce((sum, row) => sum + row.balanceDue, 0)),
        },
      ],
      headers: [
        "Booking ID",
        "Customer",
        "Vehicle",
        "Pickup Date",
        "Return Date",
        "Status",
        "Payment Option",
        "Payment Status",
        "Non-Blocking",
        "Total",
        "Amount Paid",
        "Balance Due",
      ],
      rows: payload.upcoming.pickups.map((row) => [
        row.bookingId,
        row.customerName,
        row.vehicleLabel,
        row.pickupDate,
        row.returnDate,
        row.status,
        row.paymentOption,
        row.paymentStatus,
        row.isNonBlocking ? "Yes" : "No",
        row.total,
        row.amountPaid,
        row.balanceDue,
      ]),
      emptyState: "No pickups matched the selected operational range.",
    };
  }

  if (key === "returns") {
    return {
      title: titleForKey(key),
      subtitle: "Operational return list for the selected range window.",
      sectionMeta,
      scopeLabel,
      vehicleLabel: common.vehicleLabel,
      warnings: sectionMeta.warnings,
      summary: [
        { label: "Returns", value: String(payload.upcoming.returns.length) },
        {
          label: "Open Balances",
          value: formatJmd(payload.upcoming.returns.reduce((sum, row) => sum + row.balanceDue, 0)),
        },
      ],
      headers: [
        "Booking ID",
        "Customer",
        "Vehicle",
        "Pickup Date",
        "Return Date",
        "Status",
        "Payment Option",
        "Payment Status",
        "Non-Blocking",
        "Total",
        "Amount Paid",
        "Balance Due",
      ],
      rows: payload.upcoming.returns.map((row) => [
        row.bookingId,
        row.customerName,
        row.vehicleLabel,
        row.pickupDate,
        row.returnDate,
        row.status,
        row.paymentOption,
        row.paymentStatus,
        row.isNonBlocking ? "Yes" : "No",
        row.total,
        row.amountPaid,
        row.balanceDue,
      ]),
      emptyState: "No returns matched the selected operational range.",
    };
  }

  if (key === "upcoming_combined") {
    return {
      title: titleForKey(key),
      subtitle: "Operational pickup and return lists across the selected range window.",
      sectionMeta,
      scopeLabel,
      vehicleLabel: common.vehicleLabel,
      warnings: sectionMeta.warnings,
      summary: [
        { label: "Pickups", value: String(payload.upcoming.pickups.length) },
        { label: "Returns", value: String(payload.upcoming.returns.length) },
        {
          label: "Open Balances",
          value: formatJmd(
            [...payload.upcoming.pickups, ...payload.upcoming.returns].reduce(
              (sum, row) => sum + row.balanceDue,
              0,
            ),
          ),
        },
      ],
      headers: [
        "List Type",
        "Booking ID",
        "Customer",
        "Vehicle",
        "Pickup Date",
        "Return Date",
        "Status",
        "Payment Option",
        "Payment Status",
        "Non-Blocking",
        "Total",
        "Amount Paid",
        "Balance Due",
      ],
      rows: [
        ...payload.upcoming.pickups.map((row) => [
          "Pickup",
          row.bookingId,
          row.customerName,
          row.vehicleLabel,
          row.pickupDate,
          row.returnDate,
          row.status,
          row.paymentOption,
          row.paymentStatus,
          row.isNonBlocking ? "Yes" : "No",
          row.total,
          row.amountPaid,
          row.balanceDue,
        ]),
        ...payload.upcoming.returns.map((row) => [
          "Return",
          row.bookingId,
          row.customerName,
          row.vehicleLabel,
          row.pickupDate,
          row.returnDate,
          row.status,
          row.paymentOption,
          row.paymentStatus,
          row.isNonBlocking ? "Yes" : "No",
          row.total,
          row.amountPaid,
          row.balanceDue,
        ]),
      ],
      emptyState: "No pickups or returns matched the selected operational range.",
    };
  }

  return {
    title: titleForKey(key),
    subtitle: "Historical cancellation and refund activity with canonical event timestamps only.",
    sectionMeta,
    scopeLabel,
    vehicleLabel: common.vehicleLabel,
    warnings: sectionMeta.warnings,
    summary: [
      { label: "Cancelled", value: String(payload.cancellationRefundImpact.summary.cancelledCount) },
      { label: "Refund Count", value: String(payload.cancellationRefundImpact.summary.refundCount) },
      { label: "Refund Total", value: formatJmd(payload.cancellationRefundImpact.summary.refundTotal) },
      { label: "Net Impact", value: formatJmd(payload.cancellationRefundImpact.summary.netImpact) },
    ],
    headers: [
      "Row Type",
      "Booking ID",
      "Customer",
      "Vehicle",
      "Status",
      "Overridden",
      "Event At",
      "Reason",
      "Payment ID",
      "Amount",
    ],
    rows: [
      ...payload.cancellationRefundImpact.cancellations.map((row) => [
        "Cancellation",
        row.bookingId,
        row.customerName,
        row.vehicleLabel,
        row.status,
        row.isOverridden ? "Yes" : "No",
        row.cancelledAt,
        row.cancellationReason,
        "",
        "",
      ]),
      ...payload.cancellationRefundImpact.refunds.map((row) => [
        "Refund",
        row.bookingId,
        row.customerName,
        row.vehicleLabel,
        "",
        "",
        row.refundedAt,
        "",
        row.paymentId,
        row.amount,
      ]),
    ],
    emptyState: "No cancellation or refund activity matched the selected historical range.",
  };
}

function buildReportMetaLines(payload: AdminReportsPayload, spec: ExportSpec) {
  return [
    `Generated: ${formatGeneratedAt(payload.generatedAt)} (America/Jamaica)`,
    `Mode: ${spec.sectionMeta.mode === "operational" ? "Operational snapshot" : "Historical analysis"}`,
    `Date basis: ${spec.sectionMeta.dateBasisLabel}`,
    spec.scopeLabel,
    `Vehicle: ${spec.vehicleLabel}`,
    ...spec.warnings.map((warning) => `Warning: ${warning}`),
  ];
}

function exportTableAsCsv(spec: ExportSpec, meta: string[]) {
  const lines: string[] = [`# ${spec.title}`, ...meta.map((line) => `# ${line}`), ""];
  lines.push(spec.headers.map(csvEscape).join(","));
  for (const row of spec.rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  if (spec.rows.length === 0) {
    lines.push(csvEscape(spec.emptyState));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function excelCell(value: ExportCell) {
  if (typeof value === "number") {
    return { type: "Number" as const, value: String(value), style: "cellNumber" };
  }

  const text = normalizeTextCell(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { type: "DateTime" as const, value: `${text}T00:00:00.000`, style: "cellDate" };
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    return { type: "DateTime" as const, value: text.replace(/Z$/, ""), style: "cellDateTime" };
  }
  return { type: "String" as const, value: text, style: "cell" };
}

function createExcel(spec: ExportSpec, meta: string[]) {
  const metaRows = meta.map(
    (line) => `<Row><Cell ss:StyleID="meta"><Data ss:Type="String">${xmlEscape(line)}</Data></Cell></Row>`,
  );
  const summaryRows =
    spec.summary.length === 0
      ? []
      : [
          `<Row><Cell ss:StyleID="section"><Data ss:Type="String">Summary</Data></Cell></Row>`,
          ...spec.summary.map(
            (item) =>
              `<Row><Cell ss:StyleID="summaryLabel"><Data ss:Type="String">${xmlEscape(
                item.label,
              )}</Data></Cell><Cell ss:StyleID="summaryValue"><Data ss:Type="String">${xmlEscape(
                item.value,
              )}</Data></Cell></Row>`,
          ),
          "<Row/>",
        ];
  const warningRows =
    spec.warnings.length === 0
      ? []
      : [
          `<Row><Cell ss:StyleID="section"><Data ss:Type="String">Warnings</Data></Cell></Row>`,
          ...spec.warnings.map(
            (warning) =>
              `<Row><Cell ss:StyleID="warning" ss:MergeAcross="${Math.max(
                0,
                spec.headers.length - 1,
              )}"><Data ss:Type="String">${xmlEscape(warning)}</Data></Cell></Row>`,
          ),
          "<Row/>",
        ];

  const headerRow = `<Row>${spec.headers
    .map((header) => `<Cell ss:StyleID="header"><Data ss:Type="String">${xmlEscape(header)}</Data></Cell>`)
    .join("")}</Row>`;
  const bodyRows =
    spec.rows.length === 0
      ? [
          `<Row><Cell ss:StyleID="empty" ss:MergeAcross="${Math.max(
            0,
            spec.headers.length - 1,
          )}"><Data ss:Type="String">${xmlEscape(spec.emptyState)}</Data></Cell></Row>`,
        ]
      : spec.rows.map((row) => {
          const cells = row
            .map((value) => {
              const cell = excelCell(value);
              return `<Cell ss:StyleID="${cell.style}"><Data ss:Type="${cell.type}">${xmlEscape(
                cell.value,
              )}</Data></Cell>`;
            })
            .join("");
          return `<Row>${cells}</Row>`;
        });

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1a243b"/>
      <Interior ss:Color="#ffffff" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="title">
      <Font ss:FontName="Calibri" ss:Size="16" ss:Bold="1" ss:Color="#14345f"/>
    </Style>
    <Style ss:ID="subtitle">
      <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#5e6e8d"/>
    </Style>
    <Style ss:ID="meta">
      <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#5e6e8d"/>
    </Style>
    <Style ss:ID="section">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#14345f"/>
    </Style>
    <Style ss:ID="header">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#ffffff"/>
      <Interior ss:Color="#1f2d4d" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="summaryLabel">
      <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#5e6e8d"/>
      <Interior ss:Color="#eef7fb" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="summaryValue">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#14345f"/>
      <Interior ss:Color="#eef7fb" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="warning">
      <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#8a4b00"/>
      <Interior ss:Color="#fff4db" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="cell">
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#d4dced"/></Borders>
    </Style>
    <Style ss:ID="cellNumber">
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#d4dced"/></Borders>
      <NumberFormat ss:Format="Standard"/>
    </Style>
    <Style ss:ID="cellDate">
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#d4dced"/></Borders>
      <NumberFormat ss:Format="yyyy-mm-dd"/>
    </Style>
    <Style ss:ID="cellDateTime">
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#d4dced"/></Borders>
      <NumberFormat ss:Format="yyyy-mm-dd hh:mm"/>
    </Style>
    <Style ss:ID="empty">
      <Font ss:FontName="Calibri" ss:Size="10" ss:Italic="1" ss:Color="#5e6e8d"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Report">
    <Table>
      <Row><Cell ss:StyleID="title"><Data ss:Type="String">${xmlEscape(spec.title)}</Data></Cell></Row>
      <Row><Cell ss:StyleID="subtitle" ss:MergeAcross="${Math.max(
        0,
        spec.headers.length - 1,
      )}"><Data ss:Type="String">${xmlEscape(spec.subtitle)}</Data></Cell></Row>
      ${metaRows.join("\n")}
      <Row/>
      ${warningRows.join("\n")}
      ${summaryRows.join("\n")}
      ${headerRow}
      ${bodyRows.join("\n")}
    </Table>
  </Worksheet>
</Workbook>`;
}

function buildPdfColumns(headers: string[]) {
  const weighted = headers.map((header) => {
    if (/customer|vehicle|location/i.test(header)) return { label: header, width: 96 };
    if (/reason/i.test(header)) return { label: header, width: 118 };
    if (/booking|payment|status/i.test(header)) return { label: header, width: 70 };
    if (/date|time|month|period|event/i.test(header)) return { label: header, width: 74 };
    if (/revenue|refund|balance|amount|total|net|paid/i.test(header)) {
      return { label: header, width: 66, align: "right" as const };
    }
    if (/count|days|rate|margin|utilization/i.test(header)) {
      return { label: header, width: 58, align: "right" as const };
    }
    return { label: header, width: 62 };
  });

  const totalWidth = weighted.reduce((sum, column) => sum + column.width, 0);
  const scale = totalWidth > 500 ? 500 / totalWidth : 1;
  return weighted.map((column) => ({
    label: column.label,
    width: Math.max(44, Math.round(column.width * scale)),
    align: column.align,
  }));
}

function createPdf(spec: ExportSpec, meta: string[]) {
  return buildAdminExportPdf({
    title: spec.title,
    subtitle: spec.subtitle,
    metadata: meta,
    summary: spec.summary,
    columns: buildPdfColumns(spec.headers),
    rows: spec.rows.map((row) => row.map((cell) => normalizeTextCell(cell))),
    emptyState: spec.emptyState,
    footerNote: "Generated from the Curated Car Rentals admin reports page.",
  });
}

function filenameScope(payload: AdminReportsPayload, report: ExportReportKey) {
  if (report === "outstanding_balances" || report === "aging_receivables") {
    return `snapshot-${payload.filters.snapshotDate}`;
  }
  return `${payload.filters.rangeFrom}-to-${payload.filters.rangeTo}`;
}

export async function handleReportsGet(request: Request, deps: ReportsRouteDeps = DEFAULT_DEPS) {
  const auth = await requireAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const filters = parseFilters(searchParams);
  const format = String(searchParams.get("format") ?? "").trim().toLowerCase();
  const report = String(searchParams.get("report") ?? "").trim().toLowerCase();

  const payload = await deps.getPayload(filters);

  if (format.length > 0) {
    if (!isExportFormat(format)) {
      return NextResponse.json(
        { ok: false, error: "Invalid format. Use csv, excel, or pdf." },
        { status: 400 },
      );
    }
    if (!isExportReportKey(report)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid report key. Use one of: cash_collections, vehicle_profitability, vehicle_utilization, outstanding_balances, aging_receivables, location_performance, booking_status_funnel, customer_cohort, pickups, returns, upcoming_combined, cancellations_refunds.",
        },
        { status: 400 },
      );
    }

    const spec = buildExportSpec(report, payload);
    const meta = buildReportMetaLines(payload, spec);
    const filenameBase = `${report}-${filenameScope(payload, report)}`;

    if (format === "csv") {
      const csv = exportTableAsCsv(spec, meta);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=${filenameBase}.csv`,
        },
      });
    }

    if (format === "excel") {
      const excel = createExcel(spec, meta);
      return new Response(excel, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.ms-excel; charset=utf-8",
          "Content-Disposition": `attachment; filename=${filenameBase}.xls`,
        },
      });
    }

    const pdf = createPdf(spec, meta);
    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${filenameBase}.pdf`,
      },
    });
  }

  const normalizedFilters = payload.filters;
  return NextResponse.json({
    ok: true,
    filters: normalizedFilters,
    filterQuery: buildReportsFilterQueryString(normalizedFilters),
    report: payload,
  });
}

export async function GET(request: Request) {
  return handleReportsGet(request);
}
