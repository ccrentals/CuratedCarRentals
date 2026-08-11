import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  DEPRECIATION_REPORT_SORT_COLUMNS,
  listDepreciationReport,
  type DepreciationReportItem,
  type DepreciationReportSortBy,
  type DepreciationReportSortDir,
} from "@/lib/vehicles/depreciationReport";
import { readSortFromSearchParams } from "@/components/admin/tableSort";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

function normalizeFilter(value: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, 80) : null;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function lineForRow(row: DepreciationReportItem) {
  return [
    row.vehicleId,
    `${row.year} ${row.make} ${row.model}`,
    row.vehicleType ?? "",
    row.vehicleClass ?? "",
    row.purchaseDate ?? "",
    row.purchaseCostCents ?? "",
    row.bookValueCents ?? "",
    row.accumulatedDepreciationCents ?? "",
    row.monthlyDepreciationCents ?? "",
    row.residualValueCents ?? "",
    row.usefulLifeMonths ?? "",
    row.depreciationMethod ?? "",
    row.asOfMonth,
    row.incompleteReason ?? "",
  ]
    .map((value) => csvEscape(value))
    .join(",");
}

type ExportDeps = {
  getSession: () => Promise<AdminSession | null>;
  listReport: (options: {
    asOfMonth?: string | null;
    vehicleClass?: string | null;
    vehicleType?: string | null;
    sortBy?: DepreciationReportSortBy;
    sortDir?: DepreciationReportSortDir;
  }) => ReturnType<typeof listDepreciationReport>;
};

const DEFAULT_DEPS: ExportDeps = {
  getSession: () => getSessionFromRequest(),
  listReport: (options) => listDepreciationReport(options),
};

export async function handleAdminDepreciationExportGet(
  request: Request,
  deps: ExportDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({
    getSession: deps.getSession,
    responseFormat: "text",
  });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const asOfMonth = normalizeFilter(searchParams.get("asOfMonth"));
  const vehicleClass = normalizeFilter(searchParams.get("vehicleClass"));
  const vehicleType = normalizeFilter(searchParams.get("vehicleType"));

  const sort = readSortFromSearchParams(searchParams, {
    allowedSortBy: DEPRECIATION_REPORT_SORT_COLUMNS,
    defaultSortBy: "vehicle",
    defaultSortDir: "asc",
  });

  try {
    const report = await deps.listReport({
      asOfMonth,
      vehicleClass,
      vehicleType,
      sortBy: (sort.sortBy as DepreciationReportSortBy | undefined) ?? "vehicle",
      sortDir: (sort.sortDir as DepreciationReportSortDir | undefined) ?? "asc",
    });

    const header = [
      "vehicle_id",
      "vehicle",
      "vehicle_type",
      "vehicle_class",
      "purchase_date",
      "purchase_cost_cents",
      "book_value_cents",
      "accumulated_depreciation_cents",
      "monthly_depreciation_cents",
      "residual_value_cents",
      "useful_life_months",
      "depreciation_method",
      "as_of_month",
      "incomplete_reason",
    ];

    const lines = [header.join(","), ...report.items.map((row) => lineForRow(row))];
    const filename = `depreciation-${report.asOfMonth}.csv`;

    return new Response(`${lines.join("\n")}\n`, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=${filename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return new Response("Depreciation tables are not installed.", {
        status: 503,
      });
    }
    return new Response("Failed to export depreciation report.", { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleAdminDepreciationExportGet(request);
}
