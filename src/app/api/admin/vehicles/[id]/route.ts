import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
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

export async function GET(
  request: Request,
  { params }: VehicleRouteContext,
) {
  const auth = await requireStaffOrAdminRole();
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
  const auth = await requireStaffOrAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }
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
  const seatCountRaw = body?.seat_count ?? body?.seatCount;
  const imageUrls = parseImageUrls(body?.image_urls_json);

  const updates: string[] = [];
  const values: Array<string | number | string[] | null> = [];
  let index = 1;

  if (dailyRateRaw !== undefined) {
    if (!Number.isFinite(dailyRateRaw) || dailyRateRaw < 0) {
      return NextResponse.json({ error: "Invalid daily_rate" }, { status: 400 });
    }
    updates.push(`daily_rate_cents = $${index}`);
    values.push(Math.round(dailyRateRaw));
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
    index += 1;
  }

  if (imageUrls.length > 0 || body?.image_urls_json !== undefined) {
    updates.push(`image_urls_json = $${index}`);
    values.push(imageUrls);
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
    index += 1;
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(id);

  const updateResult = await dbQuery(
    `update vehicles set ${updates.join(", ")}, updated_at = now() where id = $${
      index
    } returning id, public_id, make, model, year, seat_count, daily_rate_cents, deposit_cents, status`,
    values,
  );

  if (updateResult.rowCount === 0) {
    return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }

  await writeAuditLog({
    userId: actor.userId,
    action: "VEHICLE_UPDATE",
    entityType: "vehicle",
    entityId: id,
    details: { fields: updates.map((field) => field.split(" ")[0]) },
  });

  return NextResponse.json({ vehicle: updateResult.rows[0] });
}

export async function handleAdminVehicleDelete(
  request: Request,
  context: VehicleRouteContext,
  deps: AdminVehicleDeleteDeps = DEFAULT_DELETE_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
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
