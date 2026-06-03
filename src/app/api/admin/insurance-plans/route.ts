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

export const dynamic = "force-dynamic";

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

function parseUuidOrNull(value: unknown) {
  const text = normalizeText(value);
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
  ) {
    return text;
  }
  return null;
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`"${column}"`) && message.includes("does not exist");
}

async function loadInsurancePlans() {
  try {
    return await dbQuery<InsurancePlanRow>(
      "select id, vehicle_id, is_enabled, price_per_day_cents, coverage_cents, is_global_default, updated_at from insurance_plans order by is_global_default desc, updated_at desc",
    );
  } catch (error) {
    if (!isUndefinedColumn(error, "coverage_cents")) {
      throw error;
    }

    return await dbQuery<InsurancePlanRow>(
      "select id, vehicle_id, is_enabled, price_per_day_cents, 155000::int as coverage_cents, is_global_default, updated_at from insurance_plans order by is_global_default desc, updated_at desc",
    );
  }
}

async function loadVehiclesForInsurance() {
  try {
    return await dbQuery<VehicleRow>(
      "select id, make, model, year, status from vehicles where deleted_at is null order by make asc, model asc, year desc",
    );
  } catch (error) {
    if (!isUndefinedColumn(error, "deleted_at")) {
      throw error;
    }

    return await dbQuery<VehicleRow>(
      "select id, make, model, year, status from vehicles order by make asc, model asc, year desc",
    );
  }
}

async function saveGlobalInsurancePlan({
  isEnabled,
  pricePerDayCents,
  coverageCents,
  actorUserId,
}: {
  isEnabled: boolean;
  pricePerDayCents: number;
  coverageCents: number;
  actorUserId: string | null;
}) {
  const updateResult = await dbQuery(
    "update insurance_plans set is_enabled = $1, price_per_day_cents = $2, coverage_cents = $3, updated_at = now() where is_global_default = true",
    [isEnabled, pricePerDayCents, coverageCents],
  );
  if (updateResult.rowCount > 0) return;

  await dbQuery(
    "insert into insurance_plans (vehicle_id, is_enabled, price_per_day_cents, coverage_cents, is_global_default, created_by) values (null, $1, $2, $3, true, $4::uuid)",
    [isEnabled, pricePerDayCents, coverageCents, actorUserId],
  );
}

async function saveVehicleInsurancePlan({
  vehicleId,
  isEnabled,
  pricePerDayCents,
  coverageCents,
  actorUserId,
}: {
  vehicleId: string;
  isEnabled: boolean;
  pricePerDayCents: number;
  coverageCents: number;
  actorUserId: string | null;
}) {
  const updateResult = await dbQuery(
    "update insurance_plans set is_enabled = $2, price_per_day_cents = $3, coverage_cents = $4, updated_at = now() where vehicle_id = $1::uuid",
    [vehicleId, isEnabled, pricePerDayCents, coverageCents],
  );
  if (updateResult.rowCount > 0) return;

  await dbQuery(
    "insert into insurance_plans (vehicle_id, is_enabled, price_per_day_cents, coverage_cents, is_global_default, created_by) values ($1::uuid, $2, $3, $4, false, $5::uuid)",
    [vehicleId, isEnabled, pricePerDayCents, coverageCents, actorUserId],
  );
}

export async function GET() {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const [plans, vehicles] = await Promise.all([
      loadInsurancePlans(),
      loadVehiclesForInsurance(),
    ]);

    return NextResponse.json({
      plans: plans.rows,
      vehicles: vehicles.rows,
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
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
  const actorUserId = parseUuidOrNull(actor.userId);

  if (scope !== "GLOBAL" && scope !== "VEHICLE") {
    return NextResponse.json({ error: "scope must be GLOBAL or VEHICLE." }, { status: 400 });
  }

  if (scope === "GLOBAL") {
    try {
      await saveGlobalInsurancePlan({ isEnabled, pricePerDayCents, coverageCents, actorUserId });
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

    await saveVehicleInsurancePlan({
      vehicleId,
      isEnabled,
      pricePerDayCents,
      coverageCents,
      actorUserId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("api.admin.insurance-plans.PATCH.vehicle", error, {
      userId: actor.userId,
      vehicleId,
    });
    return NextResponse.json({ error: "Failed to save vehicle insurance plan." }, { status: 500 });
  }
}
