import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  buildReportsFilterQueryString,
  exportReportsCsvByKey,
  getAdminReportsPayload,
  isCsvExportReportKey,
  normalizeReportsFilters,
  type AdminReportsPayload,
  type ReportsFilterInput,
} from "@/lib/reports/adminReports";

function isAdminRole(role: string | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase() === "ADMIN";
}

export type ReportsRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  getPayload: (
    filters: ReportsFilterInput,
  ) => Promise<AdminReportsPayload>;
};

const DEFAULT_DEPS: ReportsRouteDeps = {
  getSession: () => getSessionFromRequest(),
  getPayload: (filters) => getAdminReportsPayload(filters),
};

function parseFilters(searchParams: URLSearchParams): ReportsFilterInput {
  return {
    dateFrom: searchParams.get("dateFrom"),
    dateTo: searchParams.get("dateTo"),
    vehicleId: searchParams.get("vehicleId"),
    revenueGranularity: searchParams.get("revenueGranularity"),
  };
}

export async function handleReportsGet(request: Request, deps: ReportsRouteDeps = DEFAULT_DEPS) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const filters = parseFilters(searchParams);
  const format = String(searchParams.get("format") ?? "").trim().toLowerCase();
  const report = String(searchParams.get("report") ?? "").trim().toLowerCase();

  const payload = await deps.getPayload(filters);

  if (format === "csv") {
    if (!isCsvExportReportKey(report)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid report key. Use one of: outstanding_balances, pickups, returns, cancellations_refunds.",
        },
        { status: 400 },
      );
    }
    const csv = exportReportsCsvByKey(report, payload);
    const filename = `${report}-${payload.filters.dateFrom}-to-${payload.filters.dateTo}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=${filename}`,
      },
    });
  }

  const normalizedFilters = normalizeReportsFilters(filters);
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
