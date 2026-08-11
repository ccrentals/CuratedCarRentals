import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import {
  normalizeBoolean,
  normalizeNullablePositiveInt,
  normalizeNullableText,
} from "@/lib/maintenance/normalize";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ serviceTypeId: string }>;
};

type ServiceTypeRow = {
  id: string;
  name: string;
  description: string | null;
  default_interval_days: number | null;
  default_interval_odometer: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ServiceTypePayload = {
  name: string;
  description: string | null;
  defaultIntervalDays: number | null;
  defaultIntervalOdometer: number | null;
  isActive: boolean;
};

export type ServiceTypeByIdRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  updateServiceType: (serviceTypeId: string, payload: ServiceTypePayload) => Promise<ServiceTypeRow | null>;
  softDeleteServiceType: (serviceTypeId: string) => Promise<boolean>;
};

function mapServiceType(row: ServiceTypeRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    defaultIntervalDays: row.default_interval_days,
    defaultIntervalOdometer: row.default_interval_odometer,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePayload(body: Record<string, unknown> | null): ServiceTypePayload {
  return {
    name: normalizeNullableText(body?.name, 120) ?? "",
    description: normalizeNullableText(body?.description, 600),
    defaultIntervalDays: normalizeNullablePositiveInt(
      body?.defaultIntervalDays ?? body?.default_interval_days,
    ),
    defaultIntervalOdometer: normalizeNullablePositiveInt(
      body?.defaultIntervalOdometer ?? body?.default_interval_odometer,
    ),
    isActive: normalizeBoolean(body?.isActive ?? body?.is_active, true),
  };
}

const DEFAULT_DEPS: ServiceTypeByIdRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  updateServiceType: async (serviceTypeId, payload) => {
    const result = await dbQuery<ServiceTypeRow>(
      "update maintenance_service_types set name = $2, description = $3, default_interval_days = $4, default_interval_odometer = $5, is_active = $6, updated_at = now() where id = $1::uuid returning id, name, description, default_interval_days, default_interval_odometer, is_active, created_at, updated_at",
      [
        serviceTypeId,
        payload.name,
        payload.description,
        payload.defaultIntervalDays,
        payload.defaultIntervalOdometer,
        payload.isActive,
      ],
    );
    return result.rows[0] ?? null;
  },
  softDeleteServiceType: async (serviceTypeId) => {
    const result = await dbQuery<{ id: string }>(
      "update maintenance_service_types set is_active = false, updated_at = now() where id = $1::uuid and lower(name) <> 'general' returning id",
      [serviceTypeId],
    );
    return result.rowCount > 0;
  },
};

export async function handleMaintenanceServiceTypePatch(
  request: Request,
  context: RouteContext,
  deps: ServiceTypeByIdRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const payload = normalizePayload(body);
  if (!payload.name) {
    return NextResponse.json({ ok: false, error: "Service type name is required." }, { status: 400 });
  }

  const { serviceTypeId } = await context.params;
  if (!UUID_REGEX.test(serviceTypeId)) {
    return NextResponse.json({ ok: false, error: "Invalid service type id." }, { status: 400 });
  }

  try {
    const row = await deps.updateServiceType(serviceTypeId, payload);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Service type not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item: mapServiceType(row) });
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code ?? "");
    if (code === "23505") {
      return NextResponse.json({ ok: false, error: "Service type already exists." }, { status: 409 });
    }
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to update service type." }, { status: 500 });
  }
}

export async function handleMaintenanceServiceTypeDelete(
  request: Request,
  context: RouteContext,
  deps: ServiceTypeByIdRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { serviceTypeId } = await context.params;
  if (!UUID_REGEX.test(serviceTypeId)) {
    return NextResponse.json({ ok: false, error: "Invalid service type id." }, { status: 400 });
  }

  try {
    const deleted = await deps.softDeleteServiceType(serviceTypeId);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Service type not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to delete service type." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleMaintenanceServiceTypePatch(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleMaintenanceServiceTypeDelete(request, context);
}
