import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { computeNextDue } from "@/lib/maintenance/due";
import {
  normalizeMaintenanceStatus,
  normalizeNullableDate,
  normalizeNullableNonNegativeInt,
  normalizeNullablePositiveInt,
  normalizeNullableText,
  type MaintenanceScheduleStatus,
} from "@/lib/maintenance/normalize";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ScheduleRow = {
  id: string;
  vehicle_id: string;
  service_type_id: string;
  service_type_name: string;
  interval_days: number | null;
  interval_odometer: number | null;
  last_service_date: string | null;
  last_service_odometer: number | null;
  next_due_date: string | null;
  next_due_odometer: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type SchedulePayload = {
  serviceTypeId: string;
  intervalDays: number | null;
  intervalOdometer: number | null;
  lastServiceDate: string | null;
  lastServiceOdometer: number | null;
  status: MaintenanceScheduleStatus;
  notes: string | null;
};

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  listSchedules: (vehicleId: string) => Promise<ScheduleRow[]>;
  createSchedule: (vehicleId: string, payload: SchedulePayload) => Promise<ScheduleRow>;
};

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

function mapSchedule(row: ScheduleRow) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    serviceTypeId: row.service_type_id,
    serviceTypeName: row.service_type_name,
    intervalDays: row.interval_days,
    intervalOdometer: row.interval_odometer,
    lastServiceDate: row.last_service_date,
    lastServiceOdometer: row.last_service_odometer,
    nextDueDate: row.next_due_date,
    nextDueOdometer: row.next_due_odometer,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePayload(body: Record<string, unknown> | null): SchedulePayload {
  return {
    serviceTypeId: String(body?.serviceTypeId ?? body?.service_type_id ?? "").trim(),
    intervalDays: normalizeNullablePositiveInt(body?.intervalDays ?? body?.interval_days),
    intervalOdometer: normalizeNullablePositiveInt(
      body?.intervalOdometer ?? body?.interval_odometer,
    ),
    lastServiceDate: normalizeNullableDate(body?.lastServiceDate ?? body?.last_service_date),
    lastServiceOdometer: normalizeNullableNonNegativeInt(
      body?.lastServiceOdometer ?? body?.last_service_odometer,
    ),
    status: normalizeMaintenanceStatus(body?.status, "ACTIVE"),
    notes: normalizeNullableText(body?.notes, 4000),
  };
}

const BASE_SELECT =
  "select s.id, s.vehicle_id, s.service_type_id, t.name as service_type_name, s.interval_days, s.interval_odometer, s.last_service_date, s.last_service_odometer, s.next_due_date, s.next_due_odometer, s.status, s.notes, s.created_at, s.updated_at from vehicle_maintenance_schedules s join maintenance_service_types t on t.id = s.service_type_id";

const DEFAULT_DEPS: RouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  listSchedules: async (vehicleId) => {
    const result = await dbQuery<ScheduleRow>(
      `${BASE_SELECT} where s.vehicle_id = $1::uuid order by s.created_at desc`,
      [vehicleId],
    );
    return result.rows;
  },
  createSchedule: async (vehicleId, payload) => {
    const due = computeNextDue({
      intervalDays: payload.intervalDays,
      intervalOdometer: payload.intervalOdometer,
      lastServiceDate: payload.lastServiceDate,
      lastServiceOdometer: payload.lastServiceOdometer,
    });

    const result = await dbQuery<ScheduleRow>(
      `insert into vehicle_maintenance_schedules (vehicle_id, service_type_id, interval_days, interval_odometer, last_service_date, last_service_odometer, next_due_date, next_due_odometer, status, notes)
       values ($1::uuid, $2::uuid, $3, $4, $5::date, $6, $7::date, $8, $9, $10)
       returning id, vehicle_id, service_type_id, interval_days, interval_odometer, last_service_date, last_service_odometer, next_due_date, next_due_odometer, status, notes, created_at, updated_at`,
      [
        vehicleId,
        payload.serviceTypeId,
        payload.intervalDays,
        payload.intervalOdometer,
        payload.lastServiceDate,
        payload.lastServiceOdometer,
        due.nextDueDate,
        due.nextDueOdometer,
        payload.status,
        payload.notes,
      ],
    );

    const schedule = result.rows[0];
    const joined = await dbQuery<ScheduleRow>(
      `${BASE_SELECT} where s.id = $1::uuid limit 1`,
      [schedule.id],
    );
    return joined.rows[0];
  },
};

export async function handleVehicleMaintenanceSchedulesGet(
  _request: Request,
  context: RouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  try {
    const rows = await deps.listSchedules(id);
    return NextResponse.json({ ok: true, items: rows.map(mapSchedule) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to load schedules." }, { status: 500 });
  }
}

export async function handleVehicleMaintenanceSchedulesPost(
  request: Request,
  context: RouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  const payload = normalizePayload(body);
  if (!UUID_REGEX.test(payload.serviceTypeId)) {
    return NextResponse.json({ ok: false, error: "Service type is required." }, { status: 400 });
  }
  if (payload.intervalDays === null && payload.intervalOdometer === null) {
    return NextResponse.json(
      { ok: false, error: "Provide a day interval or odometer interval." },
      { status: 400 },
    );
  }

  try {
    const row = await deps.createSchedule(id, payload);
    return NextResponse.json({ ok: true, item: mapSchedule(row) });
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code ?? "");
    if (code === "23503") {
      return NextResponse.json({ ok: false, error: "Vehicle or service type not found." }, { status: 404 });
    }
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to create schedule." }, { status: 500 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceSchedulesGet(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceSchedulesPost(request, context);
}

