import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

type InsurancePlanRow = {
  id: string;
  vehicle_id: string | null;
  is_enabled: boolean;
  price_per_day_cents: number;
  coverage_cents: number;
  is_global_default: boolean;
  updated_at: string;
};

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  status: string;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parsePrice(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return 0;
}

export async function GET() {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const [plans, vehicles] = await Promise.all([
      dbQuery<InsurancePlanRow>(
        "select id, vehicle_id, is_enabled, price_per_day_cents, coverage_cents, is_global_default, updated_at from insurance_plans order by is_global_default desc, updated_at desc",
      ),
      dbQuery<VehicleRow>(
        "select id, make, model, year, status from vehicles where deleted_at is null order by make asc, model asc, year desc",
      ),
    ]);

    return NextResponse.json({
      plans: plans.rows,
      vehicles: vehicles.rows,
    });
  } catch (error) {
    logError("api.admin.insurance-plans.GET", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to load insurance plans." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const scope = normalizeText(body?.scope).toUpperCase();
  const isEnabled = body?.isEnabled === true;
  const pricePerDayCents = parsePrice(body?.pricePerDayCents);
  const coverageCents = parsePrice(body?.coverageCents);

  if (scope !== "GLOBAL" && scope !== "VEHICLE") {
    return NextResponse.json({ error: "scope must be GLOBAL or VEHICLE." }, { status: 400 });
  }

  if (scope === "GLOBAL") {
    try {
      await dbQuery(
        "insert into insurance_plans (vehicle_id, is_enabled, price_per_day_cents, coverage_cents, is_global_default, created_by) values (null, $1, $2, $3, true, $4) on conflict (is_global_default) where is_global_default = true do update set is_enabled = excluded.is_enabled, price_per_day_cents = excluded.price_per_day_cents, coverage_cents = excluded.coverage_cents, updated_at = now()",
        [isEnabled, pricePerDayCents, coverageCents, actor.userId],
      );
      return NextResponse.json({ ok: true });
    } catch (error) {
      logError("api.admin.insurance-plans.PATCH.global", error, { userId: actor.userId });
      return NextResponse.json({ error: "Failed to save global insurance plan." }, { status: 500 });
    }
  }

  const vehicleId = normalizeText(body?.vehicleId);
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicleId is required for VEHICLE scope." }, { status: 400 });
  }

  try {
    const vehicleExists = await dbQuery<{ id: string }>(
      "select id from vehicles where id = $1 limit 1",
      [vehicleId],
    );
    if (vehicleExists.rowCount === 0) {
      return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
    }

    await dbQuery(
      "insert into insurance_plans (vehicle_id, is_enabled, price_per_day_cents, coverage_cents, is_global_default, created_by) values ($1, $2, $3, $4, false, $5) on conflict (vehicle_id) where vehicle_id is not null do update set is_enabled = excluded.is_enabled, price_per_day_cents = excluded.price_per_day_cents, coverage_cents = excluded.coverage_cents, updated_at = now()",
      [vehicleId, isEnabled, pricePerDayCents, coverageCents, actor.userId],
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("api.admin.insurance-plans.PATCH.vehicle", error, {
      userId: actor.userId,
      vehicleId,
    });
    return NextResponse.json({ error: "Failed to save vehicle insurance plan." }, { status: 500 });
  }
}
