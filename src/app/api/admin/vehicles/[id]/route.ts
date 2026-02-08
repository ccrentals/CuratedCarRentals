import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const vehicleResult = await dbQuery(
    "select id, make, model, year, daily_rate_cents, deposit_cents, status, created_at, updated_at from vehicles where id = $1",
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
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const imageUrls = parseImageUrls(body?.image_urls_json);

  const updates: string[] = [];
  const values: Array<string | number | string[]> = [];
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

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(id);

  const updateResult = await dbQuery(
    `update vehicles set ${updates.join(", ")}, updated_at = now() where id = $${
      index
    } returning id, make, model, year, daily_rate_cents, deposit_cents, status`,
    values,
  );

  if (updateResult.rowCount === 0) {
    return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }

  await writeAuditLog({
    userId: session.userId,
    action: "VEHICLE_UPDATE",
    entityType: "vehicle",
    entityId: id,
    details: { fields: updates.map((field) => field.split(" ")[0]) },
  });

  return NextResponse.json({ vehicle: updateResult.rows[0] });
}
