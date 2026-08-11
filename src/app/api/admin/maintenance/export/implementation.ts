import { NextResponse } from "next/server";

import { handleAdminMaintenanceGet } from "@/app/api/admin/maintenance/implementation";
import { formatJmdDecimalFromMinorUnits } from "@/lib/money";
import { buildAdminExportPdf } from "@/lib/pdf/adminExportPdf";

type MaintenanceExportItem = {
  vehicleLabel: string;
  title: string;
  category: string;
  status: string;
  dueState: string;
  scheduledDate: string | null;
  serviceDate: string | null;
  nextDueDate: string | null;
  totalCostCents: number;
};

type MaintenanceExportPayload = {
  ok?: boolean;
  items?: MaintenanceExportItem[];
  error?: string;
};

type Deps = {
  fetchListResponse: (request: Request) => Promise<Response>;
  now: () => Date;
};

const DEFAULT_DEPS: Deps = {
  fetchListResponse: (request) => handleAdminMaintenanceGet(request),
  now: () => new Date(),
};

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCurrency(cents: number) {
  return formatJmdDecimalFromMinorUnits(cents);
}

function formatDateLabel(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-JM", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatGeneratedAt(now: Date) {
  return now.toLocaleString("en-JM", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildFilterSummary(url: URL) {
  const filters: string[] = [];
  const q = (url.searchParams.get("q") ?? "").trim();
  const vehicleId = (url.searchParams.get("vehicleId") ?? "").trim();
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "").trim();
  const category = (url.searchParams.get("category") ?? "").trim();
  const onlyActive = url.searchParams.get("onlyActive") !== "0";

  filters.push(q ? `Search: ${q}` : "Search: All maintenance records");
  if (vehicleId) filters.push(`Vehicle filter applied`);
  if (status && status !== "all") filters.push(`Status: ${status}`);
  if (category && category !== "all") filters.push(`Category: ${category}`);
  if (from || to) {
    filters.push(`Date range: ${from || "Any"} to ${to || "Any"}`);
  }
  filters.push(onlyActive ? "Records: Only active" : "Records: Include archived");
  return filters;
}

function buildPdf(rows: MaintenanceExportItem[], now: Date, requestUrl: URL) {
  const overdueCount = rows.filter((row) => row.dueState === "OVERDUE").length;
  const dueSoonCount = rows.filter((row) => row.dueState === "DUE_SOON").length;
  const totalCostCents = rows.reduce((sum, row) => sum + Number(row.totalCostCents || 0), 0);

  return buildAdminExportPdf({
    title: "Maintenance Report",
    subtitle: "Fleet-wide service history and upcoming maintenance.",
    metadata: [`Generated: ${formatGeneratedAt(now)}`, ...buildFilterSummary(requestUrl)],
    summary: [
      { label: "Records", value: String(rows.length) },
      { label: "Overdue", value: String(overdueCount) },
      { label: "Due soon", value: String(dueSoonCount) },
      { label: "Total cost", value: `J$${formatCurrency(totalCostCents)}` },
    ],
    columns: [
      { label: "Vehicle", width: 95 },
      { label: "Item / Category", width: 165 },
      { label: "Status", width: 55 },
      { label: "Due State", width: 55 },
      { label: "Scheduled", width: 50 },
      { label: "Next Due", width: 50 },
      { label: "Total", width: 45, align: "right" },
    ],
    rows: rows.map((row) => [
      row.vehicleLabel ?? "Unknown vehicle",
      `${row.title ?? "Maintenance"}${row.category ? ` (${row.category})` : ""}`,
      row.status ?? "Unknown",
      row.dueState ?? "Unknown",
      formatDateLabel(row.scheduledDate),
      formatDateLabel(row.nextDueDate ?? row.serviceDate),
      `J$${formatCurrency(row.totalCostCents ?? 0)}`,
    ]),
    emptyState: "No maintenance records matched the selected filters.",
    footerNote: "Generated from the Curated Car Rentals admin maintenance export.",
  });
}

export async function handleAdminMaintenanceExportGet(request: Request, deps: Deps = DEFAULT_DEPS) {
  const response = await deps.fetchListResponse(request);
  if (!response.ok) return response;

  const payload = (await response.json().catch(() => null)) as MaintenanceExportPayload | null;

  if (!payload?.ok) {
    return NextResponse.json({ ok: false, error: "Failed to export maintenance records." }, { status: 500 });
  }

  const rows = Array.isArray(payload.items) ? payload.items : [];
  const { searchParams } = new URL(request.url);
  const format = (searchParams.get("format") ?? "csv").trim().toLowerCase();

  if (format === "pdf") {
    const pdf = buildPdf(rows, deps.now(), new URL(request.url));
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "cache-control": "no-store",
        "content-disposition": 'attachment; filename="maintenance-export.pdf"',
      },
    });
  }

  const header = [
    "Vehicle",
    "Maintenance Item",
    "Category",
    "Status",
    "Due State",
    "Scheduled Date",
    "Service Date",
    "Next Due Date",
    "Total Cost (JMD)",
  ];

  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.vehicleLabel ?? ""),
        csvEscape(row.title ?? ""),
        csvEscape(row.category ?? ""),
        csvEscape(row.status ?? ""),
        csvEscape(row.dueState ?? ""),
        csvEscape(row.scheduledDate ?? ""),
        csvEscape(row.serviceDate ?? ""),
        csvEscape(row.nextDueDate ?? ""),
        formatCurrency(row.totalCostCents ?? 0),
      ].join(","),
    );
  }

  const csv = `${lines.join("\n")}\n`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="maintenance-export.csv"',
    },
  });
}

export async function GET(request: Request) {
  return handleAdminMaintenanceExportGet(request);
}
