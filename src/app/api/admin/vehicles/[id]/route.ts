import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
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
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireStaffOrAdminRole();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const vehicleResult = await dbQuery(
    "select id, make, model, year, seat_count, daily_rate_cents, deposit_cents, status, created_at, updated_at from vehicles where id = $1",
    [id],
  );

  if (vehicleResult.rowCount === 0) {
    return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }

  return NextResponse.json({ vehicle: vehicleResult.rows[0] });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
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
    } returning id, make, model, year, seat_count, daily_rate_cents, deposit_cents, status`,
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
