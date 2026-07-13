import { NextResponse } from "next/server";

import { handleVehicleReservationsGet } from "@/app/api/admin/vehicles/[id]/reservations/route";
import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { getSessionFromRequest } from "@/lib/auth/session";
import { formatJmdDecimal } from "@/lib/money";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ReservationExportRow = {
  id: string;
  publicId: string | null;
  eventType: string;
  customerName: string | null;
  customerEmail: string | null;
  pickupAt: string;
  returnAt: string;
  status: string;
  totalCents: number | null;
  depositCents: number | null;
  source: string;
  activeNow: boolean;
  impactsAvailability: boolean;
  actionHref: string;
  createdAt: string;
};

type ReservationExportPayload = {
  ok?: boolean;
  error?: string;
  rows?: ReservationExportRow[];
  paging?: { total?: number };
};

export type VehicleReservationsExportRouteDeps = {
  authorize: () => Promise<Response | null>;
  fetchPage: (request: Request, context: RouteContext) => Promise<Response>;
};

const PAGE_LIMIT = 200;

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatMoney(amountJmd: number | null | undefined) {
  if (!Number.isFinite(Number(amountJmd))) return "";
  return formatJmdDecimal(Number(amountJmd));
}

const DEFAULT_DEPS: VehicleReservationsExportRouteDeps = {
  authorize: async () => {
    const auth = await requireOperationsAccess({ getSession: () => getSessionFromRequest() });
    return auth.ok ? null : auth.response;
  },
  fetchPage: (request, context) => handleVehicleReservationsGet(request, context),
};

async function fetchAllRows(
  request: Request,
  context: RouteContext,
  deps: VehicleReservationsExportRouteDeps,
) {
  const sourceUrl = new URL(request.url);
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const rows: ReservationExportRow[] = [];

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
      return { errorResponse: pageResponse, rows: [] as ReservationExportRow[] };
    }

    const payload = (await pageResponse.json().catch(() => null)) as ReservationExportPayload | null;
    if (!payload?.ok) {
      return {
        errorResponse: NextResponse.json(
          { ok: false, error: payload?.error ?? "Failed to export reservations." },
          { status: 500 },
        ),
        rows: [] as ReservationExportRow[],
      };
    }

    const pageRows = Array.isArray(payload.rows) ? payload.rows : [];
    total = Math.max(0, Number(payload.paging?.total ?? pageRows.length));
    rows.push(...pageRows);

    if (pageRows.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  return { errorResponse: null, rows };
}

export async function handleVehicleReservationsExportGet(
  request: Request,
  context: RouteContext,
  deps: VehicleReservationsExportRouteDeps = DEFAULT_DEPS,
) {
  const authError = await deps.authorize();
  if (authError) return authError;

  const { errorResponse, rows } = await fetchAllRows(request, context, deps);
  if (errorResponse) return errorResponse;

  const header = [
    "event_id",
    "public_id",
    "event_type",
    "customer_name",
    "customer_email",
    "pickup_at",
    "return_at",
    "status",
    "total_jmd",
    "deposit_jmd",
    "source",
    "active_now",
    "impacts_availability",
    "action_href",
    "created_at",
  ];
  const lines = [header.join(",")];

  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.id),
        csvEscape(row.publicId ?? ""),
        csvEscape(row.eventType),
        csvEscape(row.customerName),
        csvEscape(row.customerEmail ?? ""),
        csvEscape(row.pickupAt),
        csvEscape(row.returnAt),
        csvEscape(row.status),
        formatMoney(row.totalCents),
        formatMoney(row.depositCents),
        csvEscape(row.source),
        row.activeNow ? "yes" : "no",
        row.impactsAvailability ? "yes" : "no",
        csvEscape(row.actionHref),
        csvEscape(row.createdAt),
      ].join(","),
    );
  }

  return new NextResponse(`${lines.join("\n")}\n`, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="vehicle-history-export.csv"',
    },
  });
}

export async function GET(request: Request, context: RouteContext) {
  return handleVehicleReservationsExportGet(request, context);
}
