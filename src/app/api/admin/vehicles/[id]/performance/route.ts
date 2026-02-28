import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_PATTERN = "^[0-9]+$";

const RANGE_OPTIONS = ["30d", "90d", "365d", "custom"] as const;
const DEFAULT_RANGE = "90d" as const;

const EXCLUDED_OCCUPANCY_STATUSES = ["CANCELLED", "OVERRIDDEN", "NO_SHOW"] as const;
const REVENUE_ELIGIBLE_STATUSES = ["CONFIRMED", "ACTIVE", "IN_PROGRESS", "PICKED_UP", "RETURNED", "COMPLETED"] as const;

const BOOKING_START_SQL = "coalesce(b.start_at, b.start_date::timestamptz)";
const BOOKING_END_SQL = "coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day'))";
const TOTAL_CENTS_SQL = `case when coalesce(b.pricing_json->>'total_cents', '') ~ '${NUMERIC_PATTERN}' then (b.pricing_json->>'total_cents')::bigint else null end`;
const DEPOSIT_CENTS_SQL = `case when coalesce(b.pricing_json->>'deposit_cents', '') ~ '${NUMERIC_PATTERN}' then (b.pricing_json->>'deposit_cents')::bigint else null end`;

type RangePreset = (typeof RANGE_OPTIONS)[number];

type RouteContext = {
  params: Promise<{ id: string }>;
};

type PerformanceKpis = {
  bookedDays: number;
  availableDays: number;
  utilizationPct: number;
  revenueCents: number | null;
  depositCents: number | null;
  bookingCount: number;
  avgBookingDays: number | null;
  downtimeDays: number;
  maintenanceBlockouts: number;
};

type VehiclePerformanceBreakdown = {
  byMonth: Array<{
    month: string;
    bookedDays: number;
    downtimeDays: number;
    bookingCount: number;
    revenueCents: number | null;
  }>;
  recentBookings: Array<{
    id: string;
    start: string;
    end: string;
    status: string;
    customerName: string | null;
    totalCents: number | null;
    depositCents: number | null;
  }>;
};

type VehiclePerformancePayload = {
  range: { start: string; end: string };
  kpis: PerformanceKpis;
  breakdown: VehiclePerformanceBreakdown;
};

type VehiclePerformanceQueryInput = {
  vehicleId: string;
  startDate: string;
  endDate: string;
  rangePreset: RangePreset;
};

type VehiclePerformanceRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  vehicleExists: (vehicleId: string) => Promise<boolean>;
  fetchPerformance: (input: VehiclePerformanceQueryInput) => Promise<VehiclePerformancePayload>;
};

type MainAggregateRow = {
  booked_days: number | string | null;
  downtime_days: number | string | null;
  booking_count: number | string | null;
  avg_booking_days: number | string | null;
  revenue_cents: number | string | null;
  deposit_cents: number | string | null;
  maintenance_blockouts: number | string | null;
};

type MonthAggregateRow = {
  month: string;
  booked_days: number | string | null;
  downtime_days: number | string | null;
  booking_count: number | string | null;
  revenue_cents: number | string | null;
};

type RecentBookingRow = {
  id: string;
  start_at: string | Date;
  end_at: string | Date;
  status: string;
  customer_name: string | null;
  total_cents: number | string | null;
  deposit_cents: number | string | null;
};

type BlockoutColumns = {
  hasSource: boolean;
  hasLinkedMaintenanceId: boolean;
};

const DEFAULT_DEPS: VehiclePerformanceRouteDeps = {
  getSession: () => getSessionFromRequest(),
  vehicleExists: async (vehicleId) => {
    const result = await dbQuery<{ id: string }>("select id from vehicles where id = $1::uuid limit 1", [
      vehicleId,
    ]);
    return result.rowCount > 0;
  },
  fetchPerformance: fetchVehiclePerformance,
};

function normalizeRangePreset(raw: string | null): RangePreset {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if ((RANGE_OPTIONS as readonly string[]).includes(normalized)) {
    return normalized as RangePreset;
  }
  return DEFAULT_RANGE;
}

function toDateOnlyUtc(input: Date) {
  const year = input.getUTCFullYear();
  const month = `${input.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${input.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string) {
  if (!DATE_ONLY_REGEX.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function addDaysUtc(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function calculateRangeDaysInclusive(startDate: string, endDate: string) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) return 0;
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / 86_400_000) + 1;
}

function parseDateRange(searchParams: URLSearchParams) {
  const rangePreset = normalizeRangePreset(searchParams.get("range"));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (rangePreset !== "custom") {
    const days = rangePreset === "30d" ? 30 : rangePreset === "365d" ? 365 : 90;
    const endDate = toDateOnlyUtc(today);
    const startDate = toDateOnlyUtc(addDaysUtc(today, -(days - 1)));
    return {
      ok: true as const,
      rangePreset,
      startDate,
      endDate,
    };
  }

  const startRaw = String(searchParams.get("start") ?? "").trim();
  const endRaw = String(searchParams.get("end") ?? "").trim();

  if (!startRaw || !endRaw) {
    return {
      ok: false as const,
      error: "Custom range requires both start and end dates (YYYY-MM-DD).",
    };
  }

  const start = parseDateOnly(startRaw);
  if (!start) {
    return { ok: false as const, error: "Invalid start date. Use YYYY-MM-DD." };
  }

  const end = parseDateOnly(endRaw);
  if (!end) {
    return { ok: false as const, error: "Invalid end date. Use YYYY-MM-DD." };
  }

  if (start.getTime() > end.getTime()) {
    return {
      ok: false as const,
      error: "Start date must be on or before end date.",
    };
  }

  return {
    ok: true as const,
    rangePreset,
    startDate: startRaw,
    endDate: endRaw,
  };
}

function toIsoString(value: string | Date) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return String(value);
}

function toNullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function toRoundedNullable(value: unknown, decimals = 2) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const scale = 10 ** decimals;
  return Math.round(parsed * scale) / scale;
}

export function calculateVehiclePerformanceKpis(input: {
  rangeDays: number;
  bookedDays: number;
  downtimeDays: number;
  revenueCents: number | null;
  depositCents: number | null;
  bookingCount: number;
  avgBookingDays: number | null;
  maintenanceBlockouts: number;
}): PerformanceKpis {
  const safeRangeDays = Math.max(0, Math.round(input.rangeDays));
  const safeBookedDays = Math.max(0, Math.round(input.bookedDays));
  const safeDowntimeDays = Math.max(0, Math.round(input.downtimeDays));
  const availableDays = Math.max(0, safeRangeDays - safeDowntimeDays);
  const utilizationBase = Math.max(availableDays, 1);
  const utilizationPct = Math.max(0, Math.min(100, Number(((safeBookedDays / utilizationBase) * 100).toFixed(2))));

  return {
    bookedDays: safeBookedDays,
    availableDays,
    utilizationPct,
    revenueCents: input.revenueCents,
    depositCents: input.depositCents,
    bookingCount: Math.max(0, Math.round(input.bookingCount)),
    avgBookingDays: input.avgBookingDays,
    downtimeDays: safeDowntimeDays,
    maintenanceBlockouts: Math.max(0, Math.round(input.maintenanceBlockouts)),
  };
}

async function resolveBlockoutColumns() {
  const result = await dbQuery<{ column_name: string }>(
    `select column_name
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'blockouts'
       and column_name in ('source', 'linked_maintenance_id')`,
  );

  const names = new Set(result.rows.map((row: { column_name: string }) => String(row.column_name)));
  return {
    hasSource: names.has("source"),
    hasLinkedMaintenanceId: names.has("linked_maintenance_id"),
  } satisfies BlockoutColumns;
}

function maintenanceBlockoutPredicate(columns: BlockoutColumns) {
  if (columns.hasSource && columns.hasLinkedMaintenanceId) {
    return "(coalesce(bo.source, '') = 'MAINTENANCE' or bo.linked_maintenance_id is not null)";
  }
  if (columns.hasSource) {
    return "coalesce(bo.source, '') = 'MAINTENANCE'";
  }
  if (columns.hasLinkedMaintenanceId) {
    return "bo.linked_maintenance_id is not null";
  }
  return "true";
}

async function queryMainAggregates(input: VehiclePerformanceQueryInput, blockoutPredicate: string) {
  const result = await dbQuery<MainAggregateRow>(
    `with range_days as (
       select generate_series($2::date, $3::date, interval '1 day')::date as day
     ),
     booking_rows as (
       select
         b.id,
         ${BOOKING_START_SQL} as start_at,
         ${BOOKING_END_SQL} as end_at,
         upper(trim(coalesce(b.status, ''))) as status,
         ${TOTAL_CENTS_SQL} as total_cents,
         ${DEPOSIT_CENTS_SQL} as deposit_cents
       from bookings b
       where b.vehicle_id = $1::uuid
         and b.archived_at is null
         and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = ''
         and ${BOOKING_START_SQL} < ($3::date + interval '1 day')
         and ${BOOKING_END_SQL} >= $2::date
     ),
     booked_days as (
       select count(distinct d.day)::int as booked_days
       from range_days d
       join booking_rows b on d.day between b.start_at::date and (b.end_at - interval '1 second')::date
       where b.status <> all($4::text[])
     ),
     downtime_days as (
       select count(distinct d.day)::int as downtime_days
       from range_days d
       join blockouts bo
         on bo.vehicle_id = $1::uuid
        and bo.start_at::date <= d.day
        and bo.end_at::date >= d.day
       where ${blockoutPredicate}
     ),
     maintenance_counts as (
       select count(*)::int as maintenance_blockouts
       from blockouts bo
       where bo.vehicle_id = $1::uuid
         and bo.start_at < ($3::date + interval '1 day')
         and bo.end_at >= $2::date
         and ${blockoutPredicate}
     ),
     booking_stats as (
       select
         count(*) filter (where b.status <> all($4::text[]))::int as booking_count,
         avg(greatest(1, (least((b.end_at - interval '1 second')::date, $3::date) - greatest(b.start_at::date, $2::date) + 1)))
           filter (where b.status <> all($4::text[]))::numeric as avg_booking_days,
         sum(b.total_cents) filter (where b.status = any($5::text[]))::numeric as revenue_cents,
         sum(b.deposit_cents) filter (where b.status = any($5::text[]))::numeric as deposit_cents
       from booking_rows b
     )
     select
       coalesce((select booked_days from booked_days), 0)::int as booked_days,
       coalesce((select downtime_days from downtime_days), 0)::int as downtime_days,
       coalesce((select booking_count from booking_stats), 0)::int as booking_count,
       (select avg_booking_days from booking_stats) as avg_booking_days,
       (select revenue_cents from booking_stats) as revenue_cents,
       (select deposit_cents from booking_stats) as deposit_cents,
       coalesce((select maintenance_blockouts from maintenance_counts), 0)::int as maintenance_blockouts`,
    [
      input.vehicleId,
      input.startDate,
      input.endDate,
      [...EXCLUDED_OCCUPANCY_STATUSES],
      [...REVENUE_ELIGIBLE_STATUSES],
    ],
  );

  return result.rows[0] ?? {
    booked_days: 0,
    downtime_days: 0,
    booking_count: 0,
    avg_booking_days: null,
    revenue_cents: null,
    deposit_cents: null,
    maintenance_blockouts: 0,
  };
}

async function queryByMonth(input: VehiclePerformanceQueryInput, blockoutPredicate: string) {
  const result = await dbQuery<MonthAggregateRow>(
    `with month_series as (
       select generate_series(
         date_trunc('month', $2::date)::date,
         date_trunc('month', $3::date)::date,
         interval '1 month'
       )::date as month_start
     ),
     range_days as (
       select generate_series($2::date, $3::date, interval '1 day')::date as day
     ),
     booking_rows as (
       select
         b.id,
         ${BOOKING_START_SQL} as start_at,
         ${BOOKING_END_SQL} as end_at,
         upper(trim(coalesce(b.status, ''))) as status,
         ${TOTAL_CENTS_SQL} as total_cents
       from bookings b
       where b.vehicle_id = $1::uuid
         and b.archived_at is null
         and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = ''
         and ${BOOKING_START_SQL} < ($3::date + interval '1 day')
         and ${BOOKING_END_SQL} >= $2::date
     ),
     booked_by_month as (
       select
         date_trunc('month', d.day::timestamp)::date as month_start,
         count(distinct d.day)::int as booked_days
       from range_days d
       join booking_rows b on d.day between b.start_at::date and (b.end_at - interval '1 second')::date
       where b.status <> all($4::text[])
       group by 1
     ),
     downtime_by_month as (
       select
         date_trunc('month', d.day::timestamp)::date as month_start,
         count(distinct d.day)::int as downtime_days
       from range_days d
       join blockouts bo
         on bo.vehicle_id = $1::uuid
        and bo.start_at::date <= d.day
        and bo.end_at::date >= d.day
       where ${blockoutPredicate}
       group by 1
     ),
     booking_counts as (
       select
         date_trunc('month', b.start_at)::date as month_start,
         count(*) filter (where b.status <> all($4::text[]))::int as booking_count,
         sum(b.total_cents) filter (where b.status = any($5::text[]))::numeric as revenue_cents
       from booking_rows b
       group by 1
     )
     select
       to_char(ms.month_start, 'YYYY-MM') as month,
       coalesce(bb.booked_days, 0)::int as booked_days,
       coalesce(dbm.downtime_days, 0)::int as downtime_days,
       coalesce(bc.booking_count, 0)::int as booking_count,
       bc.revenue_cents
     from month_series ms
     left join booked_by_month bb on bb.month_start = ms.month_start
     left join downtime_by_month dbm on dbm.month_start = ms.month_start
     left join booking_counts bc on bc.month_start = ms.month_start
     order by ms.month_start asc`,
    [
      input.vehicleId,
      input.startDate,
      input.endDate,
      [...EXCLUDED_OCCUPANCY_STATUSES],
      [...REVENUE_ELIGIBLE_STATUSES],
    ],
  );

  return result.rows.map((row: MonthAggregateRow) => ({
    month: row.month,
    bookedDays: Math.max(0, Math.round(toNumber(row.booked_days))),
    downtimeDays: Math.max(0, Math.round(toNumber(row.downtime_days))),
    bookingCount: Math.max(0, Math.round(toNumber(row.booking_count))),
    revenueCents: toNullableInteger(row.revenue_cents),
  }));
}

async function queryRecentBookings(input: VehiclePerformanceQueryInput) {
  const result = await dbQuery<RecentBookingRow>(
    `select
       b.id::text as id,
       ${BOOKING_START_SQL} as start_at,
       ${BOOKING_END_SQL} as end_at,
       upper(trim(coalesce(b.status, ''))) as status,
       nullif(trim(c.full_name), '') as customer_name,
       ${TOTAL_CENTS_SQL} as total_cents,
       ${DEPOSIT_CENTS_SQL} as deposit_cents
     from bookings b
     left join customers c on c.id = b.customer_id
     where b.vehicle_id = $1::uuid
       and b.archived_at is null
       and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = ''
       and ${BOOKING_START_SQL} < ($3::date + interval '1 day')
       and ${BOOKING_END_SQL} >= $2::date
       and upper(trim(coalesce(b.status, ''))) <> 'OVERRIDDEN'
     order by ${BOOKING_START_SQL} desc, b.created_at desc
     limit 10`,
    [input.vehicleId, input.startDate, input.endDate],
  );

  return result.rows.map((row: RecentBookingRow) => ({
    id: row.id,
    start: toIsoString(row.start_at),
    end: toIsoString(row.end_at),
    status: row.status,
    customerName: row.customer_name,
    totalCents: toNullableInteger(row.total_cents),
    depositCents: toNullableInteger(row.deposit_cents),
  }));
}

async function fetchVehiclePerformance(input: VehiclePerformanceQueryInput): Promise<VehiclePerformancePayload> {
  const rangeDays = calculateRangeDaysInclusive(input.startDate, input.endDate);
  const blockoutColumns = await resolveBlockoutColumns();
  const blockoutPredicate = maintenanceBlockoutPredicate(blockoutColumns);

  const [main, byMonth, recentBookings] = await Promise.all([
    queryMainAggregates(input, blockoutPredicate),
    queryByMonth(input, blockoutPredicate),
    queryRecentBookings(input),
  ]);

  const kpis = calculateVehiclePerformanceKpis({
    rangeDays,
    bookedDays: toNumber(main.booked_days),
    downtimeDays: toNumber(main.downtime_days),
    revenueCents: toNullableInteger(main.revenue_cents),
    depositCents: toNullableInteger(main.deposit_cents),
    bookingCount: toNumber(main.booking_count),
    avgBookingDays: toRoundedNullable(main.avg_booking_days),
    maintenanceBlockouts: toNumber(main.maintenance_blockouts),
  });

  return {
    range: {
      start: input.startDate,
      end: input.endDate,
    },
    kpis,
    breakdown: {
      byMonth,
      recentBookings,
    },
  };
}

export async function handleVehiclePerformanceGet(
  request: Request,
  context: RouteContext,
  deps: VehiclePerformanceRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  const exists = await deps.vehicleExists(id);
  if (!exists) {
    return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const dateRange = parseDateRange(searchParams);
  if (!dateRange.ok) {
    return NextResponse.json({ ok: false, error: dateRange.error }, { status: 400 });
  }

  try {
    const payload = await deps.fetchPerformance({
      vehicleId: id,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      rangePreset: dateRange.rangePreset,
    });

    return NextResponse.json({
      ok: true,
      ...payload,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to load vehicle performance." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleVehiclePerformanceGet(request, context);
}
