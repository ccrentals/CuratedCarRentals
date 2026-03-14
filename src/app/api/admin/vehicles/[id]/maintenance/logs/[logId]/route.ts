import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import {
  normalizeNullableDate,
  normalizeNullableNonNegativeInt,
  normalizeNullableText,
} from "@/lib/maintenance/normalize";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string; logId: string }>;
};

type LogRow = {
  id: string;
  vehicle_id: string;
  service_type_id: string;
  service_type_name: string;
  service_date: string;
  odometer_value: number | null;
  cost_cents: number | null;
  vendor: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

type PatchPayload = {
  serviceTypeId?: string;
  serviceDate?: string;
  odometerValue?: number | null;
  costCents?: number | null;
  vendor?: string | null;
  notes?: string | null;
};

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  updateLog: (vehicleId: string, logId: string, payload: PatchPayload) => Promise<LogRow | null>;
  deleteLog: (vehicleId: string, logId: string) => Promise<boolean>;
};

function mapLog(row: LogRow) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    serviceTypeId: row.service_type_id,
    serviceTypeName: row.service_type_name,
    serviceDate: row.service_date,
    odometerValue: row.odometer_value,
    costCents: row.cost_cents,
    vendor: row.vendor,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

function normalizePatchPayload(body: Record<string, unknown> | null): PatchPayload {
  const payload: PatchPayload = {};

  if (body && ("serviceTypeId" in body || "service_type_id" in body)) {
    payload.serviceTypeId = String(body.serviceTypeId ?? body.service_type_id ?? "").trim();
  }
  if (body && ("serviceDate" in body || "service_date" in body)) {
    payload.serviceDate = normalizeNullableDate(body.serviceDate ?? body.service_date) ?? undefined;
  }
  if (body && ("odometerValue" in body || "odometer_value" in body)) {
    payload.odometerValue = normalizeNullableNonNegativeInt(
      body.odometerValue ?? body.odometer_value,
    );
  }
  if (body && ("costCents" in body || "cost_cents" in body)) {
    payload.costCents = normalizeNullableNonNegativeInt(body.costCents ?? body.cost_cents);
  }
  if (body && "vendor" in body) {
    payload.vendor = normalizeNullableText(body.vendor, 180);
  }
  if (body && "notes" in body) {
    payload.notes = normalizeNullableText(body.notes, 4000);
  }

  return payload;
}

const BASE_SELECT =
  "select l.id, l.vehicle_id, l.service_type_id, coalesce(mst.name, l.service_type, 'General') as service_type_name, l.service_date, l.odometer_value, l.cost_cents, l.vendor, l.notes, l.created_by_user_id, l.created_at from vehicle_maintenance_logs l left join maintenance_service_types mst on mst.id = l.service_type_id";

const DEFAULT_DEPS: RouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  updateLog: async (vehicleId, logId, payload) => {
    const currentResult = await dbQuery<{
      id: string;
      service_type_id: string;
      service_date: string;
      odometer_value: number | null;
      cost_cents: number | null;
      vendor: string | null;
      notes: string | null;
    }>(
      "select id, service_type_id, service_date, odometer_value, cost_cents, vendor, notes from vehicle_maintenance_logs where vehicle_id = $1::uuid and id = $2::uuid limit 1",
      [vehicleId, logId],
    );
    const current = currentResult.rows[0];
    if (!current) return null;

    const nextServiceTypeId = payload.serviceTypeId ?? current.service_type_id;
    const nextServiceDate = payload.serviceDate ?? current.service_date;
    const nextOdometerValue = payload.odometerValue === undefined ? current.odometer_value : payload.odometerValue;
    const nextCostCents = payload.costCents === undefined ? current.cost_cents : payload.costCents;
    const nextVendor = payload.vendor === undefined ? current.vendor : payload.vendor;
    const nextNotes = payload.notes === undefined ? current.notes : payload.notes;

    const update = await dbQuery<{ id: string }>(
      `update vehicle_maintenance_logs l
       set service_type_id = $3::uuid,
           service_type = coalesce(mst.name, l.service_type, 'General'),
           service_date = $4::date,
           odometer_value = $5,
           cost_cents = $6,
           vendor = $7,
           notes = $8
       from maintenance_service_types mst
       where l.vehicle_id = $1::uuid and l.id = $2::uuid and mst.id = $3::uuid
       returning l.id`,
      [
        vehicleId,
        logId,
        nextServiceTypeId,
        nextServiceDate,
        nextOdometerValue,
        nextCostCents,
        nextVendor,
        nextNotes,
      ],
    );
    if (update.rowCount < 1) return null;

    const joined = await dbQuery<LogRow>(
      `${BASE_SELECT} where l.vehicle_id = $1::uuid and l.id = $2::uuid limit 1`,
      [vehicleId, logId],
    );
    return joined.rows[0] ?? null;
  },
  deleteLog: async (vehicleId, logId) => {
    const result = await dbQuery<{ id: string }>(
      "delete from vehicle_maintenance_logs where vehicle_id = $1::uuid and id = $2::uuid returning id",
      [vehicleId, logId],
    );
    return result.rowCount > 0;
  },
};

export async function handleVehicleMaintenanceLogPatch(
  request: Request,
  context: RouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id, logId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(logId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const payload = normalizePatchPayload(body);
  if (payload.serviceTypeId && !UUID_REGEX.test(payload.serviceTypeId)) {
    return NextResponse.json({ ok: false, error: "Invalid service type id." }, { status: 400 });
  }

  try {
    const row = await deps.updateLog(id, logId, payload);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Log not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item: mapLog(row) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to update maintenance log." }, { status: 500 });
  }
}

export async function handleVehicleMaintenanceLogDelete(
  request: Request,
  context: RouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id, logId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(logId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const deleted = await deps.deleteLog(id, logId);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Log not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to delete maintenance log." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceLogPatch(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceLogDelete(request, context);
}
