import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery, getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import { parseMoneyToCents, parseImageUrls } from "@/lib/validators";

const STATUS_MAP: Record<string, string> = {
  available: "AVAILABLE",
  unavailable: "INACTIVE",
  maintenance: "MAINTENANCE",
  available_now: "AVAILABLE",
};

const ALLOWED_STATUSES = new Set([
  "AVAILABLE",
  "INACTIVE",
  "MAINTENANCE",
  "RESERVED",
  "RENTED",
]);
const INVALID_SEAT_COUNT = Symbol("INVALID_SEAT_COUNT");
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VehicleRouteContext = { params: Promise<{ id: string }> };
type VehicleProfilePatchInput = {
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

type AdminVehicleDeleteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  findVehicleById: (vehicleId: string) => Promise<{ id: string; deleted_at: string | null } | null>;
  countBlockingBookings: (vehicleId: string) => Promise<number>;
  softDeleteVehicle: (vehicleId: string) => Promise<boolean>;
  writeDeleteAudit: (input: { userId: string; vehicleId: string }) => Promise<void>;
};

const DEFAULT_DELETE_DEPS: AdminVehicleDeleteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  findVehicleById: async (vehicleId) => {
    const result = await dbQuery<{ id: string; deleted_at: string | null }>(
      "select id, deleted_at from vehicles where id = $1::uuid limit 1",
      [vehicleId],
    );
    return result.rows[0] ?? null;
  },
  countBlockingBookings: async (vehicleId) => {
    const result = await dbQuery<{ blocking_count: number }>(
      `select count(*)::int as blocking_count
       from bookings b
       where b.vehicle_id = $1::uuid
         and b.archived_at is null
         and upper(coalesce(b.status, '')) not in ('CANCELLED', 'RETURNED', 'COMPLETED', 'NO_SHOW', 'OVERRIDDEN', 'LOST', 'ARCHIVED')
         and coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day')) > now()`,
      [vehicleId],
    );
    return Number(result.rows[0]?.blocking_count ?? 0);
  },
  softDeleteVehicle: async (vehicleId) => {
    const result = await dbQuery(
      "update vehicles set deleted_at = now(), updated_at = now() where id = $1::uuid and deleted_at is null returning id",
      [vehicleId],
    );
    return result.rowCount > 0;
  },
  writeDeleteAudit: async ({ userId, vehicleId }) => {
    await writeAuditLog({
      userId,
      action: "VEHICLE_DELETE",
      entityType: "vehicle",
      entityId: vehicleId,
      details: { mode: "soft_delete" },
    });
  },
};

function normalizeSeatCount(value: unknown): number | null | typeof INVALID_SEAT_COUNT {
  if (value === undefined) return null;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return INVALID_SEAT_COUNT;
  if (parsed < 1 || parsed > 60) return INVALID_SEAT_COUNT;
  return parsed;
}

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

function parseProfilePatch(body: Record<string, unknown> | null): VehicleProfilePatchInput | null {
  const rawProfile = body?.profile;
  if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) return null;

  const profile = rawProfile as Record<string, unknown>;

  return {
    vin: normalizeNullableText(profile.vin, 64),
    license_plate: normalizeNullableText(profile.license_plate ?? profile.licensePlate, 64),
    vehicle_type: normalizeNullableText(profile.vehicle_type ?? profile.vehicleType, 80),
    vehicle_class: normalizeNullableText(profile.vehicle_class ?? profile.vehicleClass, 80),
    year: normalizeNullableInt(profile.year),
    color: normalizeNullableText(profile.color, 64),
    seat_count: normalizeNullableInt(profile.seat_count ?? profile.seatCount),
    current_location_label: normalizeNullableText(
      profile.current_location_label ??
        profile.currentLocationLabel ??
        profile.current_location ??
        profile.currentLocation,
      180,
    ),
    odometer_value: normalizeNullableInt(
      profile.odometer_value ?? profile.odometerValue ?? profile.odometer,
    ),
    odometer_unit: normalizeNullableText(profile.odometer_unit ?? profile.odometerUnit, 16),
    fuel_level_value: normalizeNullableInt(
      profile.fuel_level_value ?? profile.fuelLevelValue ?? profile.fuel_level ?? profile.fuelLevel,
    ),
    available_from: normalizeNullableDate(
      profile.available_from ?? profile.availableFrom ?? profile.available_date ?? profile.availableDate,
    ),
    available_until: normalizeNullableDate(profile.available_until ?? profile.availableUntil),
    entry_date: normalizeNullableDate(
      profile.entry_date ?? profile.entryDate ?? profile.vehicle_entry_date ?? profile.vehicleEntryDate,
    ),
    exit_date: normalizeNullableDate(
      profile.exit_date ?? profile.exitDate ?? profile.vehicle_exit_date ?? profile.vehicleExitDate,
    ),
  };
}

export async function GET(
  request: Request,
  { params }: VehicleRouteContext,
) {
  const auth = await requireAdminAccess();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const vehicleResult = await dbQuery(
    "select id, public_id, make, model, year, seat_count, daily_rate_cents, deposit_cents, status, created_at, updated_at from vehicles where id = $1",
    [id],
  );

  if (vehicleResult.rowCount === 0) {
    return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }

  return NextResponse.json({ vehicle: vehicleResult.rows[0] });
}

export async function PATCH(
  request: Request,
  { params }: VehicleRouteContext,
) {
  const auth = await requireAdminAccess();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await requireCsrf(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }
  const profilePatch = parseProfilePatch(body);
  const dailyRateRaw =
    typeof body?.daily_rate === "number"
      ? body.daily_rate
      : typeof body?.daily_rate_cents === "number"
        ? body.daily_rate_cents
        : typeof body?.dailyRate === "number"
          ? body.dailyRate
          : undefined;
  const depositRaw =
    body?.deposit_cents !== undefined
      ? body.deposit_cents
      : body?.deposit !== undefined
        ? body.deposit
        : body?.deposit_jmd !== undefined
          ? body.deposit_jmd
          : undefined;

  const statusRaw = typeof body?.status === "string" ? body.status : undefined;
  const seatCountRaw = body?.seat_count ?? body?.seatCount ?? profilePatch?.seat_count;
  const imageUrls = parseImageUrls(body?.image_urls_json);

  const updates: string[] = [];
  const values: Array<string | number | string[] | null> = [];
  let index = 1;
  const auditFields: string[] = [];

  if (dailyRateRaw !== undefined) {
    if (!Number.isFinite(dailyRateRaw) || dailyRateRaw < 0) {
      return NextResponse.json({ error: "Invalid daily_rate" }, { status: 400 });
    }
    updates.push(`daily_rate_cents = $${index}`);
    values.push(Math.round(dailyRateRaw));
    auditFields.push("daily_rate_cents");
    index += 1;
  }

  if (depositRaw !== undefined) {
    const parsedDeposit =
      typeof depositRaw === "number" ? depositRaw : parseMoneyToCents(depositRaw);
    if (parsedDeposit === null || !Number.isFinite(parsedDeposit) || parsedDeposit < 0) {
      return NextResponse.json({ error: "Invalid deposit" }, { status: 400 });
    }
    updates.push(`deposit_cents = $${index}`);
    values.push(Math.round(parsedDeposit));
    auditFields.push("deposit_cents");
    index += 1;
  }

  if (imageUrls.length > 0 || body?.image_urls_json !== undefined) {
    updates.push(`image_urls_json = $${index}`);
    values.push(imageUrls);
    auditFields.push("image_urls_json");
    index += 1;
  }

  if (statusRaw !== undefined) {
    const normalized = statusRaw.trim().toLowerCase();
    const mapped = STATUS_MAP[normalized] ?? statusRaw.toUpperCase();
    if (!ALLOWED_STATUSES.has(mapped)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    updates.push(`status = $${index}`);
    values.push(mapped);
    auditFields.push("status");
    index += 1;
  }

  if (seatCountRaw !== undefined) {
    const parsedSeatCount = normalizeSeatCount(seatCountRaw);
    if (parsedSeatCount === INVALID_SEAT_COUNT) {
      return NextResponse.json(
        { error: "Invalid seat count. Number of seats must be an integer between 1 and 60." },
        { status: 400 },
      );
    }
    updates.push(`seat_count = $${index}`);
    values.push(parsedSeatCount);
    auditFields.push("seat_count");
    index += 1;
  }

  const profileYear = profilePatch?.year;
  if (profileYear !== null && profileYear !== undefined && (profileYear < 1900 || profileYear > 2100)) {
    return NextResponse.json({ error: "Invalid profile year" }, { status: 400 });
  }
  const profileOdometer = profilePatch?.odometer_value;
  if (profileOdometer !== null && profileOdometer !== undefined && profileOdometer < 0) {
    return NextResponse.json({ error: "Invalid odometer" }, { status: 400 });
  }
  const profileFuelLevel = profilePatch?.fuel_level_value;
  if (
    profileFuelLevel !== null &&
    profileFuelLevel !== undefined &&
    (profileFuelLevel < 0 || profileFuelLevel > 100)
  ) {
    return NextResponse.json({ error: "Invalid fuel level" }, { status: 400 });
  }

  if (updates.length === 0 && !profilePatch) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const db = getDbPool();
  const client = await db.connect();
  let vehicle: Record<string, unknown> | null = null;

  try {
    await client.query("begin");
    const lockedVehicle = (await client.query(
      "select id from vehicles where id = $1::uuid for update",
      [id],
    )) as { rowCount: number; rows: Array<{ id: string }> };
    if (lockedVehicle.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    if (updates.length > 0) {
      values.push(id);
      const updateResult = await client.query(
        `update vehicles set ${updates.join(", ")}, updated_at = now() where id = $${
          index
        }::uuid returning id, public_id, make, model, year, seat_count, daily_rate_cents, deposit_cents, status`,
        values,
      );
      vehicle = (updateResult.rows[0] as Record<string, unknown> | undefined) ?? null;
    }

    if (profilePatch) {
      await client.query(
        `insert into vehicle_profiles (
           vehicle_id,
           vin,
           license_plate,
           vehicle_type,
           vehicle_class,
           year,
           color,
           current_location_label,
           odometer_value,
           odometer_unit,
           fuel_level_value,
           available_from,
           available_until,
           entry_date,
           exit_date
         )
         values (
           $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13::date, $14::date, $15::date
         )
         on conflict (vehicle_id) do update set
           vin = excluded.vin,
           license_plate = excluded.license_plate,
           vehicle_type = excluded.vehicle_type,
           vehicle_class = excluded.vehicle_class,
           year = excluded.year,
           color = excluded.color,
           current_location_label = excluded.current_location_label,
           odometer_value = excluded.odometer_value,
           odometer_unit = excluded.odometer_unit,
           fuel_level_value = excluded.fuel_level_value,
           available_from = excluded.available_from,
           available_until = excluded.available_until,
           entry_date = excluded.entry_date,
           exit_date = excluded.exit_date,
           updated_at = now()`,
        [
          id,
          profilePatch.vin,
          profilePatch.license_plate,
          profilePatch.vehicle_type,
          profilePatch.vehicle_class,
          profilePatch.year,
          profilePatch.color,
          profilePatch.current_location_label,
          profilePatch.odometer_value,
          profilePatch.odometer_unit ?? "KM",
          profilePatch.fuel_level_value,
          profilePatch.available_from,
          profilePatch.available_until,
          profilePatch.entry_date,
          profilePatch.exit_date,
        ],
      );
      auditFields.push("profile");
    }

    if (!vehicle) {
      const selected = await client.query(
        "select id, public_id, make, model, year, seat_count, daily_rate_cents, deposit_cents, status from vehicles where id = $1::uuid",
        [id],
      );
      vehicle = (selected.rows[0] as Record<string, unknown> | undefined) ?? null;
    }

    await client.query("commit");
  } catch {
    await client.query("rollback");
    return NextResponse.json({ error: "Failed to update vehicle." }, { status: 500 });
  } finally {
    client.release();
  }

  await writeAuditLog({
    userId: actor.userId,
    action: "VEHICLE_UPDATE",
    entityType: "vehicle",
    entityId: id,
    details: { fields: auditFields },
  });

  return NextResponse.json({ vehicle });
}

export async function handleAdminVehicleDelete(
  request: Request,
  context: VehicleRouteContext,
  deps: AdminVehicleDeleteDeps = DEFAULT_DELETE_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id" }, { status: 400 });
  }

  const vehicle = await deps.findVehicleById(id);
  if (!vehicle) {
    return NextResponse.json({ ok: false, error: "Vehicle not found" }, { status: 404 });
  }
  if (vehicle.deleted_at) {
    return NextResponse.json({ ok: true, alreadyDeleted: true });
  }

  const blockingCount = await deps.countBlockingBookings(id);
  if (blockingCount > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Vehicle has active or upcoming bookings and cannot be deleted.",
      },
      { status: 409 },
    );
  }

  const deleted = await deps.softDeleteVehicle(id);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: "Vehicle could not be deleted." }, { status: 500 });
  }

  await deps.writeDeleteAudit({ userId: actor.userId, vehicleId: id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: VehicleRouteContext) {
  return handleAdminVehicleDelete(request, context);
}
