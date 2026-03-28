import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const ACTIVE_STATUSES = ["CONFIRMED", "ACTIVE", "IN_PROGRESS", "PICKED_UP"];
const COMPLETED_STATUSES = ["RETURNED", "COMPLETED"];
const CANCELLED_STATUSES = ["CANCELLED", "NO_SHOW", "VOID"];

type ReservationView = "upcoming" | "history";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type VehicleReservationRowDb = {
  id: string;
  customer_name: string;
  customer_email: string | null;
  pickup_at: string | Date;
  return_at: string | Date;
  status: string;
  total_cents: number | null;
  deposit_cents: number | null;
  created_at: string | Date;
};

type VehicleReservationSummaryDb = {
  upcoming_count: number;
  active_count: number;
  completed_count: number;
  cancelled_count: number;
};

export type VehicleReservationsQueryInput = {
  vehicleId: string;
  view: ReservationView;
  status: string | null;
  search: string | null;
  startDate: string;
  endDate: string;
  startAtIso: string;
  endExclusiveIso: string;
  limit: number;
  offset: number;
};

type VehicleReservationsQueryResult = {
  rows: VehicleReservationRowDb[];
  statuses: string[];
  total: number;
  summary: VehicleReservationSummaryDb;
};

export type VehicleReservationsRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  vehicleExists: (vehicleId: string) => Promise<boolean>;
  fetchReservations: (input: VehicleReservationsQueryInput) => Promise<VehicleReservationsQueryResult>;
};

type WhereSql = {
  whereSql: string;
  values: Array<string | number>;
  nextIndex: number;
};

const PICKUP_AT_SQL = "coalesce(b.start_at, b.start_date::timestamptz)";
const RETURN_AT_SQL = "coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day'))";

function normalizeView(raw: string | null): ReservationView {
  return raw?.toLowerCase() === "history" ? "history" : "upcoming";
}

function normalizeStatus(raw: string | null) {
  const normalized = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!normalized || normalized === "ALL") return null;
  return normalized;
}

function normalizeSearch(raw: string | null) {
  const normalized = String(raw ?? "").trim();
  if (!normalized) return null;
  return normalized.slice(0, 120);
}

function normalizeLimit(raw: string | null) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

function normalizeOffset(raw: string | null) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function toDateOnlyUtc(input: Date) {
  const year = input.getUTCFullYear();
  const month = `${input.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${input.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addUtcDays(input: Date, days: number) {
  const next = new Date(input);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateDefaults(view: ReservationView) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (view === "history") {
    return {
      startDate: toDateOnlyUtc(addUtcDays(today, -90)),
      endDate: toDateOnlyUtc(today),
    };
  }
  return {
    startDate: toDateOnlyUtc(today),
    endDate: toDateOnlyUtc(addUtcDays(today, 30)),
  };
}

function parseDateOnly(value: string) {
  if (!DATE_ONLY_REGEX.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function dateRangeFromQuery(view: ReservationView, startRaw: string | null, endRaw: string | null) {
  const defaults = dateDefaults(view);
  const startDate = startRaw?.trim() ? startRaw.trim() : defaults.startDate;
  const endDate = endRaw?.trim() ? endRaw.trim() : defaults.endDate;

  const startParsed = parseDateOnly(startDate);
  if (!startParsed) {
    return { error: "Invalid start date. Use YYYY-MM-DD." } as const;
  }

  const endParsed = parseDateOnly(endDate);
  if (!endParsed) {
    return { error: "Invalid end date. Use YYYY-MM-DD." } as const;
  }

  if (startParsed.getTime() > endParsed.getTime()) {
    return { error: "Start date must be on or before end date." } as const;
  }

  const endExclusive = addUtcDays(endParsed, 1);
  return {
    startDate,
    endDate,
    startAtIso: startParsed.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
  } as const;
}

function toIsoString(value: string | Date) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return String(value);
}

function buildReservationsWhere(input: VehicleReservationsQueryInput, options: {
  includeView: boolean;
  includeStatus: boolean;
  includeSearch: boolean;
}): WhereSql {
  const values: Array<string | number> = [input.vehicleId, input.startAtIso, input.endExclusiveIso];
  const clauses = [
    "b.vehicle_id = $1::uuid",
    "b.archived_at is null",
    `${PICKUP_AT_SQL} >= $2::timestamptz`,
    `${PICKUP_AT_SQL} < $3::timestamptz`,
  ];

  let nextIndex = 4;

  if (options.includeView) {
    clauses.push(input.view === "upcoming" ? `${RETURN_AT_SQL} >= now()` : `${RETURN_AT_SQL} < now()`);
  }

  if (options.includeStatus && input.status) {
    clauses.push(`upper(trim(b.status)) = $${nextIndex}`);
    values.push(input.status);
    nextIndex += 1;
  }

  if (options.includeSearch && input.search) {
    clauses.push(
      `(b.id::text ilike $${nextIndex} or coalesce(c.full_name, '') ilike $${nextIndex} or coalesce(c.email, '') ilike $${nextIndex})`,
    );
    values.push(`%${input.search}%`);
    nextIndex += 1;
  }

  return {
    whereSql: clauses.join(" and "),
    values,
    nextIndex,
  };
}

function buildSummaryWhere(input: VehicleReservationsQueryInput): WhereSql {
  const values: Array<string | number> = [input.vehicleId, input.startAtIso, input.endExclusiveIso];
  const clauses = [
    "b.vehicle_id = $1::uuid",
    "b.archived_at is null",
    `${PICKUP_AT_SQL} >= $2::timestamptz`,
    `${PICKUP_AT_SQL} < $3::timestamptz`,
  ];

  return {
    whereSql: clauses.join(" and "),
    values,
    nextIndex: 4,
  };
}

async function queryVehicleReservations(input: VehicleReservationsQueryInput): Promise<VehicleReservationsQueryResult> {
  const filteredWhere = buildReservationsWhere(input, {
    includeView: true,
    includeStatus: true,
    includeSearch: true,
  });

  const orderDirection = input.view === "upcoming" ? "asc" : "desc";

  const rowsResult = await dbQuery<VehicleReservationRowDb>(
    `select
       b.id::text as id,
       coalesce(nullif(trim(c.full_name), ''), 'Unknown customer') as customer_name,
       nullif(trim(c.email), '') as customer_email,
       ${PICKUP_AT_SQL} as pickup_at,
       ${RETURN_AT_SQL} as return_at,
       upper(trim(b.status)) as status,
       case
         when coalesce(b.pricing_json->>'total_cents', '') ~ '^[0-9]+$' then (b.pricing_json->>'total_cents')::int
         else null
       end as total_cents,
       case
         when coalesce(b.pricing_json->>'deposit_cents', '') ~ '^[0-9]+$' then (b.pricing_json->>'deposit_cents')::int
         else null
       end as deposit_cents,
       b.created_at
     from bookings b
     left join customers c on c.id = b.customer_id
     where ${filteredWhere.whereSql}
     order by ${PICKUP_AT_SQL} ${orderDirection}, b.created_at desc
     limit $${filteredWhere.nextIndex}
     offset $${filteredWhere.nextIndex + 1}`,
    [...filteredWhere.values, input.limit, input.offset],
  );

  const countResult = await dbQuery<{ total: number }>(
    `select count(*)::int as total
     from bookings b
     left join customers c on c.id = b.customer_id
     where ${filteredWhere.whereSql}`,
    filteredWhere.values,
  );

  const statusesWhere = buildReservationsWhere(input, {
    includeView: true,
    includeStatus: false,
    includeSearch: false,
  });

  const statusesResult = await dbQuery<{ status: string }>(
    `select distinct upper(trim(b.status)) as status
     from bookings b
     where ${statusesWhere.whereSql}
     order by 1 asc`,
    statusesWhere.values,
  );

  const summaryWhere = buildSummaryWhere(input);
  const summaryResult = await dbQuery<VehicleReservationSummaryDb>(
    `select
       count(*) filter (
         where ${RETURN_AT_SQL} >= now()
           and upper(trim(b.status)) <> all($${summaryWhere.nextIndex}::text[])
       )::int as upcoming_count,
       count(*) filter (
         where upper(trim(b.status)) = any($${summaryWhere.nextIndex + 1}::text[])
       )::int as active_count,
       count(*) filter (
         where upper(trim(b.status)) = any($${summaryWhere.nextIndex + 2}::text[])
       )::int as completed_count,
       count(*) filter (
         where upper(trim(b.status)) = any($${summaryWhere.nextIndex}::text[])
       )::int as cancelled_count
     from bookings b
     where ${summaryWhere.whereSql}`,
    [
      ...summaryWhere.values,
      CANCELLED_STATUSES,
      ACTIVE_STATUSES,
      COMPLETED_STATUSES,
    ],
  );

  return {
    rows: rowsResult.rows,
    statuses: statusesResult.rows
      .map((row: { status: string }) => String(row.status ?? "").trim().toUpperCase())
      .filter(Boolean),
    total: Number(countResult.rows[0]?.total ?? 0),
    summary: summaryResult.rows[0] ?? {
      upcoming_count: 0,
      active_count: 0,
      completed_count: 0,
      cancelled_count: 0,
    },
  };
}

const DEFAULT_DEPS: VehicleReservationsRouteDeps = {
  getSession: () => getSessionFromRequest(),
  vehicleExists: async (vehicleId: string) => {
    const result = await dbQuery<{ id: string }>("select id from vehicles where id = $1::uuid limit 1", [vehicleId]);
    return result.rowCount > 0;
  },
  fetchReservations: queryVehicleReservations,
};

export async function handleVehicleReservationsGet(
  request: Request,
  context: RouteContext,
  deps: VehicleReservationsRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  const vehicleExists = await deps.vehicleExists(id);
  if (!vehicleExists) {
    return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const view = normalizeView(searchParams.get("view"));
  const status = normalizeStatus(searchParams.get("status"));
  const search = normalizeSearch(searchParams.get("q"));
  const dateRange = dateRangeFromQuery(view, searchParams.get("start"), searchParams.get("end"));
  if ("error" in dateRange) {
    return NextResponse.json({ ok: false, error: dateRange.error }, { status: 400 });
  }

  const limit = normalizeLimit(searchParams.get("limit"));
  const offset = normalizeOffset(searchParams.get("offset"));

  try {
    const result = await deps.fetchReservations({
      vehicleId: id,
      view,
      status,
      search,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      startAtIso: dateRange.startAtIso,
      endExclusiveIso: dateRange.endExclusiveIso,
      limit,
      offset,
    });

    return NextResponse.json({
      ok: true,
      rows: result.rows.map((row) => ({
        id: row.id,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        pickupAt: toIsoString(row.pickup_at),
        returnAt: toIsoString(row.return_at),
        status: row.status,
        totalCents: Number.isFinite(Number(row.total_cents)) ? Number(row.total_cents) : null,
        depositCents: Number.isFinite(Number(row.deposit_cents)) ? Number(row.deposit_cents) : null,
        createdAt: toIsoString(row.created_at),
      })),
      summary: {
        upcomingCount: Number(result.summary.upcoming_count ?? 0),
        activeCount: Number(result.summary.active_count ?? 0),
        completedCount: Number(result.summary.completed_count ?? 0),
        cancelledCount: Number(result.summary.cancelled_count ?? 0),
      },
      paging: {
        limit,
        offset,
        total: Number(result.total ?? 0),
      },
      statuses: result.statuses,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to load vehicle reservations." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleVehicleReservationsGet(request, context);
}
