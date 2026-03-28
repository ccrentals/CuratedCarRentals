import { NextResponse } from "next/server";

import { requireAdminRole, requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import {
  normalizeBoolean,
  normalizeNullablePositiveInt,
  normalizeNullableText,
} from "@/lib/maintenance/normalize";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

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

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  listServiceTypes: () => Promise<ServiceTypeRow[]>;
  createServiceType: (payload: ServiceTypePayload) => Promise<ServiceTypeRow>;
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
  const name = normalizeNullableText(body?.name, 120) ?? "";
  return {
    name,
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

const DEFAULT_DEPS: RouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  listServiceTypes: async () => {
    const result = await dbQuery<ServiceTypeRow>(
      "select id, name, description, default_interval_days, default_interval_odometer, is_active, created_at, updated_at from maintenance_service_types order by is_active desc, lower(name) asc, created_at asc",
    );
    return result.rows;
  },
  createServiceType: async (payload) => {
    const result = await dbQuery<ServiceTypeRow>(
      "insert into maintenance_service_types (name, description, default_interval_days, default_interval_odometer, is_active) values ($1, $2, $3, $4, $5) returning id, name, description, default_interval_days, default_interval_odometer, is_active, created_at, updated_at",
      [
        payload.name,
        payload.description,
        payload.defaultIntervalDays,
        payload.defaultIntervalOdometer,
        payload.isActive,
      ],
    );
    return result.rows[0];
  },
};

export async function handleMaintenanceServiceTypesGet(
  _request: Request,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  try {
    const rows = await deps.listServiceTypes();
    return NextResponse.json({ ok: true, items: rows.map(mapServiceType) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to load service types." }, { status: 500 });
  }
}

export async function handleMaintenanceServiceTypesPost(
  request: Request,
  deps: RouteDeps = DEFAULT_DEPS,
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

  try {
    const row = await deps.createServiceType(payload);
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
    return NextResponse.json({ ok: false, error: "Failed to create service type." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleMaintenanceServiceTypesGet(request);
}

export async function POST(request: Request) {
  return handleMaintenanceServiceTypesPost(request);
}
