import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

type VehicleProfileRow = {
  vehicle_id: string;
  vin: string | null;
  license_plate: string | null;
  vehicle_type: string | null;
  vehicle_class: string | null;
  year: number | null;
  color: string | null;
  current_location_label: string | null;
  odometer_value: number | null;
  odometer_unit: string | null;
  fuel_level_value: number | null;
  available_from: string | null;
  available_until: string | null;
  entry_date: string | null;
  exit_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRouteContext = {
  params: Promise<{ id: string }>;
};

type ProfilePayload = {
  vin: string | null;
  license_plate: string | null;
  vehicle_type: string | null;
  vehicle_class: string | null;
  year: number | null;
  color: string | null;
  current_location_label: string | null;
  odometer_value: number | null;
  odometer_unit: string | null;
  fuel_level_value: number | null;
  available_from: string | null;
  available_until: string | null;
  entry_date: string | null;
  exit_date: string | null;
  notes: string | null;
};

export type AdminVehicleProfileRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getProfile: (vehicleId: string) => Promise<VehicleProfileRow | null>;
  upsertProfile: (vehicleId: string, payload: ProfilePayload) => Promise<VehicleProfileRow>;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeNullableText(value: unknown, max = 255) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.slice(0, max);
}

function normalizeNullableDate(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeNullableInt(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

function normalizeFuelLevel(value: unknown) {
  return normalizeNullableInt(value);
}

function normalizePayload(body: Record<string, unknown> | null): ProfilePayload {
  return {
    vin: normalizeNullableText(body?.vin, 64),
    license_plate: normalizeNullableText(body?.license_plate ?? body?.licensePlate, 64),
    vehicle_type: normalizeNullableText(body?.vehicle_type ?? body?.vehicleType, 80),
    vehicle_class: normalizeNullableText(body?.vehicle_class ?? body?.vehicleClass, 80),
    year: normalizeNullableInt(body?.year),
    color: normalizeNullableText(body?.color, 64),
    current_location_label: normalizeNullableText(
      body?.current_location_label ?? body?.currentLocationLabel ?? body?.current_location ?? body?.currentLocation,
      180,
    ),
    odometer_value: normalizeNullableInt(body?.odometer_value ?? body?.odometerValue ?? body?.odometer),
    available_until: normalizeNullableDate(body?.available_until ?? body?.availableUntil),
    fuel_level_value: normalizeFuelLevel(
      body?.fuel_level_value ?? body?.fuelLevelValue ?? body?.fuel_level ?? body?.fuelLevel,
    ),
    available_from: normalizeNullableDate(body?.available_from ?? body?.availableFrom ?? body?.available_date ?? body?.availableDate),
    entry_date: normalizeNullableDate(body?.entry_date ?? body?.entryDate ?? body?.vehicle_entry_date ?? body?.vehicleEntryDate),
    exit_date: normalizeNullableDate(body?.exit_date ?? body?.exitDate ?? body?.vehicle_exit_date ?? body?.vehicleExitDate),
    odometer_unit: normalizeNullableText(body?.odometer_unit ?? body?.odometerUnit, 16),
    notes: normalizeNullableText(body?.notes, 4000),
  };
}

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

const DEFAULT_DEPS: AdminVehicleProfileRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getProfile: async (vehicleId) => {
    const result = await dbQuery<VehicleProfileRow>(
      "select vehicle_id, vin, license_plate, vehicle_type, vehicle_class, year, color, current_location_label, odometer_value, odometer_unit, fuel_level_value, available_from, available_until, entry_date, exit_date, notes, created_at, updated_at from vehicle_profiles where vehicle_id = $1::uuid limit 1",
      [vehicleId],
    );
    return result.rows[0] ?? null;
  },
  upsertProfile: async (vehicleId, payload) => {
    const result = await dbQuery<VehicleProfileRow>(
      "insert into vehicle_profiles (vehicle_id, vin, license_plate, vehicle_type, vehicle_class, year, color, current_location_label, odometer_value, odometer_unit, fuel_level_value, available_from, available_until, entry_date, exit_date, notes) values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13::date, $14::date, $15::date, $16) on conflict (vehicle_id) do update set vin = excluded.vin, license_plate = excluded.license_plate, vehicle_type = excluded.vehicle_type, vehicle_class = excluded.vehicle_class, year = excluded.year, color = excluded.color, current_location_label = excluded.current_location_label, odometer_value = excluded.odometer_value, odometer_unit = excluded.odometer_unit, fuel_level_value = excluded.fuel_level_value, available_from = excluded.available_from, available_until = excluded.available_until, entry_date = excluded.entry_date, exit_date = excluded.exit_date, notes = excluded.notes, updated_at = now() returning vehicle_id, vin, license_plate, vehicle_type, vehicle_class, year, color, current_location_label, odometer_value, odometer_unit, fuel_level_value, available_from, available_until, entry_date, exit_date, notes, created_at, updated_at",
      [
        vehicleId,
        payload.vin,
        payload.license_plate,
        payload.vehicle_type,
        payload.vehicle_class,
        payload.year,
        payload.color,
        payload.current_location_label,
        payload.odometer_value,
        payload.odometer_unit ?? "KM",
        payload.fuel_level_value,
        payload.available_from,
        payload.available_until,
        payload.entry_date,
        payload.exit_date,
        payload.notes,
      ],
    );
    return result.rows[0];
  },
};

export async function handleAdminVehicleProfileGet(
  _request: Request,
  context: ProfileRouteContext,
  deps: AdminVehicleProfileRouteDeps = DEFAULT_DEPS,
) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  try {
    const profile = await deps.getProfile(id);
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle profile tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to load vehicle profile." }, { status: 500 });
  }
}

export async function handleAdminVehicleProfilePatch(
  request: Request,
  context: ProfileRouteContext,
  deps: AdminVehicleProfileRouteDeps = DEFAULT_DEPS,
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

  const payload = normalizePayload(body);
  if (payload.year !== null && (payload.year < 1900 || payload.year > 2100)) {
    return NextResponse.json({ ok: false, error: "Invalid year" }, { status: 400 });
  }
  if (payload.odometer_value !== null && payload.odometer_value < 0) {
    return NextResponse.json({ ok: false, error: "Invalid odometer" }, { status: 400 });
  }
  if (payload.fuel_level_value !== null && (payload.fuel_level_value < 0 || payload.fuel_level_value > 100)) {
    return NextResponse.json({ ok: false, error: "Invalid fuel level" }, { status: 400 });
  }

  const { id } = await context.params;
  try {
    const profile = await deps.upsertProfile(id, payload);
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle profile tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to update vehicle profile." }, { status: 500 });
  }
}

export async function GET(request: Request, context: ProfileRouteContext) {
  return handleAdminVehicleProfileGet(request, context);
}

export async function PATCH(request: Request, context: ProfileRouteContext) {
  return handleAdminVehicleProfilePatch(request, context);
}
