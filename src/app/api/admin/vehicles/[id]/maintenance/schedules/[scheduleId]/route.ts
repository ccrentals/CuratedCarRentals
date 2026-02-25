import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
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
  params: Promise<{ id: string; scheduleId: string }>;
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

type SchedulePatchPayload = {
  serviceTypeId?: string;
  intervalDays?: number | null;
  intervalOdometer?: number | null;
  lastServiceDate?: string | null;
  lastServiceOdometer?: number | null;
  status?: MaintenanceScheduleStatus;
  notes?: string | null;
};

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getSchedule: (vehicleId: string, scheduleId: string) => Promise<ScheduleRow | null>;
  updateSchedule: (vehicleId: string, scheduleId: string, payload: SchedulePatchPayload) => Promise<ScheduleRow | null>;
  deleteSchedule: (vehicleId: string, scheduleId: string) => Promise<boolean>;
};

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

function normalizePatchPayload(body: Record<string, unknown> | null): SchedulePatchPayload {
  const payload: SchedulePatchPayload = {};

  if (body && ("serviceTypeId" in body || "service_type_id" in body)) {
    payload.serviceTypeId = String(body.serviceTypeId ?? body.service_type_id ?? "").trim();
  }
  if (body && ("intervalDays" in body || "interval_days" in body)) {
    payload.intervalDays = normalizeNullablePositiveInt(body.intervalDays ?? body.interval_days);
  }
  if (body && ("intervalOdometer" in body || "interval_odometer" in body)) {
    payload.intervalOdometer = normalizeNullablePositiveInt(
      body.intervalOdometer ?? body.interval_odometer,
    );
  }
  if (body && ("lastServiceDate" in body || "last_service_date" in body)) {
    payload.lastServiceDate = normalizeNullableDate(body.lastServiceDate ?? body.last_service_date);
  }
  if (body && ("lastServiceOdometer" in body || "last_service_odometer" in body)) {
    payload.lastServiceOdometer = normalizeNullableNonNegativeInt(
      body.lastServiceOdometer ?? body.last_service_odometer,
    );
  }
  if (body && "status" in body) {
    payload.status = normalizeMaintenanceStatus(body.status, "ACTIVE");
  }
  if (body && "notes" in body) {
    payload.notes = normalizeNullableText(body.notes, 4000);
  }

  return payload;
}

const BASE_SELECT =
  "select s.id, s.vehicle_id, s.service_type_id, t.name as service_type_name, s.interval_days, s.interval_odometer, s.last_service_date, s.last_service_odometer, s.next_due_date, s.next_due_odometer, s.status, s.notes, s.created_at, s.updated_at from vehicle_maintenance_schedules s join maintenance_service_types t on t.id = s.service_type_id";

const DEFAULT_DEPS: RouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getSchedule: async (vehicleId, scheduleId) => {
    const result = await dbQuery<ScheduleRow>(
      `${BASE_SELECT} where s.vehicle_id = $1::uuid and s.id = $2::uuid limit 1`,
      [vehicleId, scheduleId],
    );
    return result.rows[0] ?? null;
  },
  updateSchedule: async (vehicleId, scheduleId, payload) => {
    const currentResult = await dbQuery<{
      id: string;
      service_type_id: string;
      interval_days: number | null;
      interval_odometer: number | null;
      last_service_date: string | null;
      last_service_odometer: number | null;
      status: string;
      notes: string | null;
    }>(
      "select id, service_type_id, interval_days, interval_odometer, last_service_date, last_service_odometer, status, notes from vehicle_maintenance_schedules where vehicle_id = $1::uuid and id = $2::uuid limit 1",
      [vehicleId, scheduleId],
    );
    const current = currentResult.rows[0];
    if (!current) return null;

    const merged = {
      serviceTypeId: payload.serviceTypeId ?? current.service_type_id,
      intervalDays:
        payload.intervalDays === undefined ? current.interval_days : payload.intervalDays,
      intervalOdometer:
        payload.intervalOdometer === undefined ? current.interval_odometer : payload.intervalOdometer,
      lastServiceDate:
        payload.lastServiceDate === undefined ? current.last_service_date : payload.lastServiceDate,
      lastServiceOdometer:
        payload.lastServiceOdometer === undefined
          ? current.last_service_odometer
          : payload.lastServiceOdometer,
      status: payload.status ?? normalizeMaintenanceStatus(current.status, "ACTIVE"),
      notes: payload.notes === undefined ? current.notes : payload.notes,
    };

    const due = computeNextDue({
      intervalDays: merged.intervalDays,
      intervalOdometer: merged.intervalOdometer,
      lastServiceDate: merged.lastServiceDate,
      lastServiceOdometer: merged.lastServiceOdometer,
    });

    await dbQuery(
      "update vehicle_maintenance_schedules set service_type_id = $3::uuid, interval_days = $4, interval_odometer = $5, last_service_date = $6::date, last_service_odometer = $7, next_due_date = $8::date, next_due_odometer = $9, status = $10, notes = $11, updated_at = now() where vehicle_id = $1::uuid and id = $2::uuid",
      [
        vehicleId,
        scheduleId,
        merged.serviceTypeId,
        merged.intervalDays,
        merged.intervalOdometer,
        merged.lastServiceDate,
        merged.lastServiceOdometer,
        due.nextDueDate,
        due.nextDueOdometer,
        merged.status,
        merged.notes,
      ],
    );

    const joined = await dbQuery<ScheduleRow>(
      `${BASE_SELECT} where s.vehicle_id = $1::uuid and s.id = $2::uuid limit 1`,
      [vehicleId, scheduleId],
    );
    return joined.rows[0] ?? null;
  },
  deleteSchedule: async (vehicleId, scheduleId) => {
    const result = await dbQuery<{ id: string }>(
      "delete from vehicle_maintenance_schedules where vehicle_id = $1::uuid and id = $2::uuid returning id",
      [vehicleId, scheduleId],
    );
    return result.rowCount > 0;
  },
};

export async function handleVehicleMaintenanceSchedulePatch(
  request: Request,
  context: RouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id, scheduleId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(scheduleId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const payload = normalizePatchPayload(body);
  if (payload.serviceTypeId !== undefined && !UUID_REGEX.test(payload.serviceTypeId)) {
    return NextResponse.json({ ok: false, error: "Invalid service type id." }, { status: 400 });
  }
  if (payload.intervalDays === null && payload.intervalOdometer === null) {
    return NextResponse.json(
      { ok: false, error: "Provide a day interval or odometer interval." },
      { status: 400 },
    );
  }

  try {
    const row = await deps.updateSchedule(id, scheduleId, payload);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Schedule not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item: mapSchedule(row) });
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code ?? "");
    if (code === "23503") {
      return NextResponse.json({ ok: false, error: "Invalid service type." }, { status: 404 });
    }
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to update schedule." }, { status: 500 });
  }
}

export async function handleVehicleMaintenanceScheduleDelete(
  request: Request,
  context: RouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id, scheduleId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(scheduleId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const deleted = await deps.deleteSchedule(id, scheduleId);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Schedule not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to delete schedule." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceSchedulePatch(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceScheduleDelete(request, context);
}

