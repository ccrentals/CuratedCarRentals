import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  AVAILABILITY_ACTIVE_BOOKING_SQL,
  AVAILABILITY_ENTITLED_SQL,
} from "@/lib/availability/entitlement";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type ReservationView = "upcoming" | "history";
type EventType = "ALL" | "BOOKING" | "BLOCKOUT" | "MAINTENANCE";
type RouteContext = { params: Promise<{ id: string }> };

type VehicleHistoryRowDb = {
  id: string;
  public_id: string | null;
  event_type: "BOOKING" | "BLOCKOUT" | "MAINTENANCE";
  customer_name: string | null;
  customer_email: string | null;
  pickup_at: string | Date;
  return_at: string | Date;
  status: string;
  total_cents: number | null;
  deposit_cents: number | null;
  source: string;
  active_now: boolean;
  impacts_availability: boolean;
  action_href: string;
  created_at: string | Date;
};

type VehicleHistorySummaryDb = {
  upcoming_count: number;
  on_rent_count?: number;
  active_count?: number;
  completed_count: number;
  cancelled_count: number;
  active_blockout_count: number;
};

export type VehicleReservationsQueryInput = {
  vehicleId: string;
  view: ReservationView;
  eventType: EventType;
  status: string | null;
  search: string | null;
  startDate: string | null;
  endDate: string | null;
  startAtIso: string | null;
  endExclusiveIso: string | null;
  limit: number;
  offset: number;
};

type VehicleHistoryQueryResult = {
  rows: VehicleHistoryRowDb[];
  statuses: string[];
  total: number;
  summary: VehicleHistorySummaryDb;
};

export type VehicleReservationsRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  vehicleExists: (vehicleId: string) => Promise<boolean>;
  fetchReservations: (input: VehicleReservationsQueryInput) => Promise<VehicleHistoryQueryResult>;
};

function normalizeView(raw: string | null): ReservationView {
  return raw?.toLowerCase() === "history" ? "history" : "upcoming";
}

function normalizeEventType(raw: string | null): EventType {
  const value = String(raw ?? "ALL").trim().toUpperCase();
  return ["BOOKING", "BLOCKOUT", "MAINTENANCE"].includes(value)
    ? (value as EventType)
    : "ALL";
}

function normalizeStatus(raw: string | null) {
  const value = String(raw ?? "").trim().toUpperCase();
  return !value || value === "ALL" ? null : value;
}

function normalizeSearch(raw: string | null) {
  const value = String(raw ?? "").trim();
  return value ? value.slice(0, 120) : null;
}

function normalizeLimit(raw: string | null) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(MAX_LIMIT, Math.max(1, parsed)) : DEFAULT_LIMIT;
}

function normalizeOffset(raw: string | null) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function dateOnlyUtc(input: Date) {
  return input.toISOString().slice(0, 10);
}

function addUtcDays(input: Date, days: number) {
  const next = new Date(input);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDateOnly(value: string) {
  if (!DATE_ONLY_REGEX.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateRangeFromQuery(view: ReservationView, startRaw: string | null, endRaw: string | null) {
  if (view === "history" && !startRaw && !endRaw) {
    return {
      startDate: null,
      endDate: null,
      startAtIso: null,
      endExclusiveIso: null,
    } as const;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startDate = startRaw?.trim() || dateOnlyUtc(today);
  const endDate = endRaw?.trim() || dateOnlyUtc(addUtcDays(today, 30));
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) return { error: "Invalid date. Use YYYY-MM-DD." } as const;
  if (start > end) return { error: "Start date must be on or before end date." } as const;

  return {
    startDate,
    endDate,
    startAtIso: start.toISOString(),
    endExclusiveIso: addUtcDays(end, 1).toISOString(),
  } as const;
}

function toIsoString(value: string | Date) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function buildHistorySql(input: VehicleReservationsQueryInput) {
  const values: Array<string | number> = [input.vehicleId];
  const clauses: string[] = [];
  let index = 2;

  if (input.view === "upcoming") clauses.push("events.return_at >= now()");
  if (input.startAtIso && input.endExclusiveIso) {
    clauses.push(`events.pickup_at < $${index + 1}::timestamptz`);
    clauses.push(`events.return_at > $${index}::timestamptz`);
    values.push(input.startAtIso, input.endExclusiveIso);
    index += 2;
  }
  if (input.eventType !== "ALL") {
    clauses.push(`events.event_type = $${index}`);
    values.push(input.eventType);
    index += 1;
  }
  if (input.status) {
    clauses.push(`events.status = $${index}`);
    values.push(input.status);
    index += 1;
  }
  if (input.search) {
    clauses.push(
      `(events.id ilike $${index} or coalesce(events.public_id, '') ilike $${index} or coalesce(events.customer_name, '') ilike $${index} or coalesce(events.customer_email, '') ilike $${index} or coalesce(events.source, '') ilike $${index})`,
    );
    values.push(`%${input.search}%`);
    index += 1;
  }

  return {
    whereSql: clauses.length ? `where ${clauses.join(" and ")}` : "",
    values,
    nextIndex: index,
  };
}

const EVENTS_CTE = `
  with booking_events as (
    select
      b.id::text as id,
      nullif(trim(b.public_id), '') as public_id,
      'BOOKING'::text as event_type,
      coalesce(nullif(trim(c.full_name), ''), 'Unknown customer') as customer_name,
      nullif(trim(c.email), '') as customer_email,
      coalesce(b.start_at, b.start_date::timestamptz) as pickup_at,
      coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day')) as return_at,
      upper(trim(b.status)) as status,
      case when coalesce(b.pricing_json->>'total_cents', '') ~ '^[0-9]+$' then (b.pricing_json->>'total_cents')::int end as total_cents,
      case when coalesce(b.pricing_json->>'deposit_cents', '') ~ '^[0-9]+$' then (b.pricing_json->>'deposit_cents')::int end as deposit_cents,
      'BOOKING'::text as source,
      (
        now() >= coalesce(b.start_at, b.start_date::timestamptz)
        and now() < coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day'))
        and ${AVAILABILITY_ACTIVE_BOOKING_SQL}
        and ${AVAILABILITY_ENTITLED_SQL}
      ) as active_now,
      (${AVAILABILITY_ACTIVE_BOOKING_SQL} and ${AVAILABILITY_ENTITLED_SQL}) as impacts_availability,
      '/admin/bookings/' || b.id::text as action_href,
      b.created_at
    from bookings b
    join vehicles v on v.id = b.vehicle_id
    left join customers c on c.id = b.customer_id
    where b.vehicle_id = $1::uuid and b.archived_at is null
  ),
  blockout_events as (
    select
      bo.id::text as id,
      null::text as public_id,
      case
        when coalesce(to_jsonb(bo)->>'source', '') = 'MAINTENANCE'
          or nullif(to_jsonb(bo)->>'linked_maintenance_id', '') is not null
        then 'MAINTENANCE'
        else 'BLOCKOUT'
      end::text as event_type,
      null::text as customer_name,
      null::text as customer_email,
      bo.start_at as pickup_at,
      bo.end_at as return_at,
      case when now() < bo.start_at then 'UPCOMING' when now() < bo.end_at then 'ACTIVE' else 'COMPLETED' end::text as status,
      null::int as total_cents,
      null::int as deposit_cents,
      coalesce(nullif(to_jsonb(bo)->>'source', ''), 'MANUAL')::text as source,
      (now() >= bo.start_at and now() < bo.end_at) as active_now,
      (now() < bo.end_at) as impacts_availability,
      case
        when nullif(to_jsonb(bo)->>'linked_maintenance_id', '') is not null
        then '/admin/vehicles/' || bo.vehicle_id::text || '?tab=maintenance&recordId=' || (to_jsonb(bo)->>'linked_maintenance_id')
        else '/admin/vehicles/' || bo.vehicle_id::text || '?tab=blockouts'
      end as action_href,
      bo.created_at
    from blockouts bo
    where bo.vehicle_id = $1::uuid
  ),
  events as (
    select * from booking_events
    union all
    select * from blockout_events
  )
`;

async function queryVehicleHistory(input: VehicleReservationsQueryInput): Promise<VehicleHistoryQueryResult> {
  const filtered = buildHistorySql(input);
  const direction = input.view === "upcoming" ? "asc" : "desc";
  const rows = await dbQuery<VehicleHistoryRowDb>(
    `${EVENTS_CTE}
     select * from events
     ${filtered.whereSql}
     order by events.pickup_at ${direction}, events.created_at desc
     limit $${filtered.nextIndex} offset $${filtered.nextIndex + 1}`,
    [...filtered.values, input.limit, input.offset],
  );
  const count = await dbQuery<{ total: number }>(
    `${EVENTS_CTE} select count(*)::int as total from events ${filtered.whereSql}`,
    filtered.values,
  );
  const statuses = await dbQuery<{ status: string }>(
    `${EVENTS_CTE} select distinct status from events order by status`,
    [input.vehicleId],
  );
  const summary = await dbQuery<VehicleHistorySummaryDb>(
    `${EVENTS_CTE}
     select
       count(*) filter (where event_type = 'BOOKING' and return_at >= now() and status not in ('CANCELLED','OVERRIDDEN','NO_SHOW','VOID'))::int as upcoming_count,
       count(*) filter (where event_type = 'BOOKING' and active_now)::int as on_rent_count,
       count(*) filter (where event_type = 'BOOKING' and status in ('RETURNED','COMPLETED'))::int as completed_count,
       count(*) filter (where event_type = 'BOOKING' and status in ('CANCELLED','OVERRIDDEN','NO_SHOW','VOID'))::int as cancelled_count,
       count(*) filter (where event_type in ('BLOCKOUT','MAINTENANCE') and active_now)::int as active_blockout_count
     from events`,
    [input.vehicleId],
  );

  return {
    rows: rows.rows,
    statuses: statuses.rows.map((row: { status: string }) => row.status).filter(Boolean),
    total: Number(count.rows[0]?.total ?? 0),
    summary: summary.rows[0] ?? {
      upcoming_count: 0,
      on_rent_count: 0,
      completed_count: 0,
      cancelled_count: 0,
      active_blockout_count: 0,
    },
  };
}

const DEFAULT_DEPS: VehicleReservationsRouteDeps = {
  getSession: () => getSessionFromRequest(),
  vehicleExists: async (vehicleId) =>
    (await dbQuery("select id from vehicles where id = $1::uuid limit 1", [vehicleId])).rowCount > 0,
  fetchReservations: queryVehicleHistory,
};

export async function handleVehicleReservationsGet(
  request: Request,
  context: RouteContext,
  deps: VehicleReservationsRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireOperationsAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }
  if (!(await deps.vehicleExists(id))) {
    return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const view = normalizeView(params.get("view"));
  const range = dateRangeFromQuery(view, params.get("start"), params.get("end"));
  if ("error" in range) {
    return NextResponse.json({ ok: false, error: range.error }, { status: 400 });
  }

  try {
    const limit = normalizeLimit(params.get("limit"));
    const offset = normalizeOffset(params.get("offset"));
    const result = await deps.fetchReservations({
      vehicleId: id,
      view,
      eventType: normalizeEventType(params.get("eventType")),
      status: normalizeStatus(params.get("status")),
      search: normalizeSearch(params.get("q")),
      ...range,
      limit,
      offset,
    });
    return NextResponse.json({
      ok: true,
      rows: result.rows.map((row) => ({
        id: row.id,
        publicId: row.public_id,
        eventType: row.event_type,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        pickupAt: toIsoString(row.pickup_at),
        returnAt: toIsoString(row.return_at),
        status: row.status,
        totalCents: Number.isFinite(Number(row.total_cents)) ? Number(row.total_cents) : null,
        depositCents: Number.isFinite(Number(row.deposit_cents)) ? Number(row.deposit_cents) : null,
        source: row.source,
        activeNow: Boolean(row.active_now),
        impactsAvailability: Boolean(row.impacts_availability),
        actionHref: row.action_href,
        createdAt: toIsoString(row.created_at),
      })),
      summary: {
        upcomingCount: Number(result.summary.upcoming_count ?? 0),
        onRentCount: Number(result.summary.on_rent_count ?? result.summary.active_count ?? 0),
        activeCount: Number(result.summary.on_rent_count ?? result.summary.active_count ?? 0),
        completedCount: Number(result.summary.completed_count ?? 0),
        cancelledCount: Number(result.summary.cancelled_count ?? 0),
        activeBlockoutCount: Number(result.summary.active_blockout_count ?? 0),
      },
      paging: { limit, offset, total: result.total },
      statuses: result.statuses,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load vehicle history." }, { status: 500 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleVehicleReservationsGet(request, context);
}
