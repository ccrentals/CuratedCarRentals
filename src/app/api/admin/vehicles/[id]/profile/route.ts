import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
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
  seat_count: number | null;
  current_location_label: string | null;
  odometer_value: number | null;
  odometer_unit: string | null;
  fuel_level_value: number | null;
  available_from: string | null;
  available_until: string | null;
  entry_date: string | null;
  exit_date: string | null;
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
  seat_count: number | null;
  current_location_label: string | null;
  odometer_value: number | null;
  odometer_unit: string | null;
  fuel_level_value: number | null;
  available_from: string | null;
  available_until: string | null;
  entry_date: string | null;
  exit_date: string | null;
};

type ParsedProfilePayload = Omit<ProfilePayload, "seat_count"> & {
  seat_count: number | null | typeof INVALID_SEAT_COUNT;
};

const INVALID_SEAT_COUNT = Symbol("INVALID_SEAT_COUNT");

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

function normalizeNullableSeatCount(value: unknown): number | null | typeof INVALID_SEAT_COUNT {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return INVALID_SEAT_COUNT;
  if (parsed < 1 || parsed > 60) return INVALID_SEAT_COUNT;
  return parsed;
}

function normalizeFuelLevel(value: unknown) {
  return normalizeNullableInt(value);
}

function normalizePayload(body: Record<string, unknown> | null): ParsedProfilePayload {
  return {
    vin: normalizeNullableText(body?.vin, 64),
    license_plate: normalizeNullableText(body?.license_plate ?? body?.licensePlate, 64),
    vehicle_type: normalizeNullableText(body?.vehicle_type ?? body?.vehicleType, 80),
    vehicle_class: normalizeNullableText(body?.vehicle_class ?? body?.vehicleClass, 80),
    year: normalizeNullableInt(body?.year),
    color: normalizeNullableText(body?.color, 64),
    seat_count: normalizeNullableSeatCount(body?.seat_count ?? body?.seatCount ?? body?.seats),
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
  };
}

const DEFAULT_DEPS: AdminVehicleProfileRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getProfile: async (vehicleId) => {
    const result = await dbQuery<VehicleProfileRow>(
      "select v.id as vehicle_id, p.vin, p.license_plate, p.vehicle_type, p.vehicle_class, p.year, p.color, v.seat_count, p.current_location_label, p.odometer_value, p.odometer_unit, p.fuel_level_value, p.available_from, p.available_until, p.entry_date, p.exit_date, coalesce(p.created_at, v.created_at) as created_at, coalesce(p.updated_at, v.updated_at) as updated_at from vehicles v left join vehicle_profiles p on p.vehicle_id = v.id where v.id = $1::uuid limit 1",
      [vehicleId],
    );
    return result.rows[0] ?? null;
  },
  upsertProfile: async (vehicleId, payload) => {
    await dbQuery("update vehicles set seat_count = $2, updated_at = now() where id = $1::uuid", [
      vehicleId,
      payload.seat_count,
    ]);
    const result = await dbQuery<VehicleProfileRow>(
      "insert into vehicle_profiles (vehicle_id, vin, license_plate, vehicle_type, vehicle_class, year, color, current_location_label, odometer_value, odometer_unit, fuel_level_value, available_from, available_until, entry_date, exit_date) values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13::date, $14::date, $15::date) on conflict (vehicle_id) do update set vin = excluded.vin, license_plate = excluded.license_plate, vehicle_type = excluded.vehicle_type, vehicle_class = excluded.vehicle_class, year = excluded.year, color = excluded.color, current_location_label = excluded.current_location_label, odometer_value = excluded.odometer_value, odometer_unit = excluded.odometer_unit, fuel_level_value = excluded.fuel_level_value, available_from = excluded.available_from, available_until = excluded.available_until, entry_date = excluded.entry_date, exit_date = excluded.exit_date, updated_at = now() returning vehicle_id, vin, license_plate, vehicle_type, vehicle_class, year, color, $16::int as seat_count, current_location_label, odometer_value, odometer_unit, fuel_level_value, available_from, available_until, entry_date, exit_date, created_at, updated_at",
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
        payload.seat_count,
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
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

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
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const payload = normalizePayload(body);
  if (payload.seat_count === INVALID_SEAT_COUNT) {
    return NextResponse.json(
      { ok: false, error: "Invalid seat count. Number of seats must be an integer between 1 and 60." },
      { status: 400 },
    );
  }
  const normalizedPayload: ProfilePayload = {
    ...payload,
    seat_count: payload.seat_count,
  };
  if (normalizedPayload.year !== null && (normalizedPayload.year < 1900 || normalizedPayload.year > 2100)) {
    return NextResponse.json({ ok: false, error: "Invalid year" }, { status: 400 });
  }
  if (normalizedPayload.odometer_value !== null && normalizedPayload.odometer_value < 0) {
    return NextResponse.json({ ok: false, error: "Invalid odometer" }, { status: 400 });
  }
  if (
    normalizedPayload.fuel_level_value !== null &&
    (normalizedPayload.fuel_level_value < 0 || normalizedPayload.fuel_level_value > 100)
  ) {
    return NextResponse.json({ ok: false, error: "Invalid fuel level" }, { status: 400 });
  }

  const { id } = await context.params;
  try {
    const profile = await deps.upsertProfile(id, normalizedPayload);
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
