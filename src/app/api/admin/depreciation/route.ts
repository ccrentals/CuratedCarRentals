import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  DEPRECIATION_REPORT_SORT_COLUMNS,
  listDepreciationReport,
  type DepreciationReportSortBy,
  type DepreciationReportSortDir,
} from "@/lib/vehicles/depreciationReport";
import { readSortFromSearchParams } from "@/components/admin/tableSort";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  listReport: (options: {
    asOfMonth?: string | null;
    vehicleClass?: string | null;
    vehicleType?: string | null;
    sortBy?: DepreciationReportSortBy;
    sortDir?: DepreciationReportSortDir;
  }) => ReturnType<typeof listDepreciationReport>;
};

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

function normalizeFilter(value: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, 80) : null;
}

const DEFAULT_DEPS: RouteDeps = {
  getSession: () => getSessionFromRequest(),
  listReport: (options) => listDepreciationReport(options),
};

export async function handleAdminDepreciationGet(
  request: Request,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

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

    return NextResponse.json({
      ok: true,
      asOfMonth: report.asOfMonth,
      items: report.items,
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Depreciation tables are not installed." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { ok: false, error: "Failed to load depreciation report." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleAdminDepreciationGet(request);
}
