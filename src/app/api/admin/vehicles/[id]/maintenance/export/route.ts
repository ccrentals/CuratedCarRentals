import { NextResponse } from "next/server";

import { handleVehicleMaintenanceGet } from "@/app/api/admin/vehicles/[id]/maintenance/route";
import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { getSessionFromRequest } from "@/lib/auth/session";
import { formatJmdDecimalFromMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type MaintenanceExportRow = {
  id: string;
  publicId?: string;
  title: string;
  status: string;
  category: string;
  scheduledDate: string | null;
  serviceDate: string | null;
  nextDueDate: string | null;
  totalCostCents: number;
  linkedExpenseId: string | null;
  linkedRepairOrderId: string | null;
  updatedAt: string;
};

type MaintenanceExportPayload = {
  ok?: boolean;
  error?: string;
  rows?: MaintenanceExportRow[];
  items?: MaintenanceExportRow[];
  paging?: { total?: number };
};

export type VehicleMaintenanceExportRouteDeps = {
  authorize: () => Promise<Response | null>;
  fetchPage: (request: Request, context: RouteContext) => Promise<Response>;
};

const PAGE_LIMIT = 50;

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatMoney(cents: number | null | undefined) {
  if (!Number.isFinite(Number(cents))) return "";
  return formatJmdDecimalFromMinorUnits(Number(cents));
}

const DEFAULT_DEPS: VehicleMaintenanceExportRouteDeps = {
  authorize: async () => {
    const auth = await requireAdminAccess({ getSession: () => getSessionFromRequest() });
    return auth.ok ? null : auth.response;
  },
  fetchPage: (request, context) => handleVehicleMaintenanceGet(request, context),
};

async function fetchAllRows(
  request: Request,
  context: RouteContext,
  deps: VehicleMaintenanceExportRouteDeps,
) {
  const sourceUrl = new URL(request.url);
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const rows: MaintenanceExportRow[] = [];

  while (rows.length < total) {
    const pagedUrl = new URL(sourceUrl.toString());
    pagedUrl.searchParams.set("limit", String(PAGE_LIMIT));
    pagedUrl.searchParams.set("offset", String(offset));

    const pageResponse = await deps.fetchPage(
      new Request(pagedUrl.toString(), {
        method: "GET",
        headers: request.headers,
      }),
      context,
    );

    if (!pageResponse.ok) {
      return { errorResponse: pageResponse, rows: [] as MaintenanceExportRow[] };
    }

    const payload = (await pageResponse.json().catch(() => null)) as MaintenanceExportPayload | null;
    if (!payload?.ok) {
      return {
        errorResponse: NextResponse.json(
          { ok: false, error: payload?.error ?? "Failed to export maintenance records." },
          { status: 500 },
        ),
        rows: [] as MaintenanceExportRow[],
      };
    }

    const pageRows = Array.isArray(payload.rows)
      ? payload.rows
      : Array.isArray(payload.items)
        ? payload.items
        : [];

    total = Math.max(0, Number(payload.paging?.total ?? pageRows.length));
    rows.push(...pageRows);

    if (pageRows.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  return { errorResponse: null, rows };
}

export async function handleVehicleMaintenanceExportGet(
  request: Request,
  context: RouteContext,
  deps: VehicleMaintenanceExportRouteDeps = DEFAULT_DEPS,
) {
  const authError = await deps.authorize();
  if (authError) return authError;

  const { errorResponse, rows } = await fetchAllRows(request, context, deps);
  if (errorResponse) return errorResponse;

  const header = [
    "record_public_id",
    "title",
    "status",
    "category",
    "scheduled_date",
    "service_date",
    "next_due_date",
    "total_cost_jmd",
    "linked_expense_id",
    "linked_repair_order_id",
    "updated_at",
  ];
  const lines = [header.join(",")];

  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.publicId ?? row.id),
        csvEscape(row.title),
        csvEscape(row.status),
        csvEscape(row.category),
        csvEscape(row.scheduledDate ?? ""),
        csvEscape(row.serviceDate ?? ""),
        csvEscape(row.nextDueDate ?? ""),
        formatMoney(row.totalCostCents),
        csvEscape(row.linkedExpenseId ?? ""),
        csvEscape(row.linkedRepairOrderId ?? ""),
        csvEscape(row.updatedAt),
      ].join(","),
    );
  }

  return new NextResponse(`${lines.join("\n")}\n`, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="vehicle-maintenance-export.csv"',
    },
  });
}

export async function GET(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceExportGet(request, context);
}
