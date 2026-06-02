import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";

type InsurancePlanRow = {
  id: string;
  vehicle_id: string | null;
  is_enabled: boolean;
  price_per_day_cents: number;
  coverage_cents: number;
  is_global_default: boolean;
};

export const dynamic = "force-dynamic";

function normalizeText(value: string | null) {
  if (!value) return "";
  return value.trim();
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`"${column}"`) && message.includes("does not exist");
}

async function fetchEnabledVehiclePlan(vehicleId: string) {
  try {
    return await dbQuery<InsurancePlanRow>(
      "select id, vehicle_id, is_enabled, price_per_day_cents, coverage_cents, is_global_default from insurance_plans where vehicle_id = $1 and is_enabled = true order by updated_at desc limit 1",
      [vehicleId],
    );
  } catch (error) {
    if (!isUndefinedColumn(error, "coverage_cents")) {
      throw error;
    }

    return await dbQuery<InsurancePlanRow>(
      "select id, vehicle_id, is_enabled, price_per_day_cents, 155000::int as coverage_cents, is_global_default from insurance_plans where vehicle_id = $1 and is_enabled = true order by updated_at desc limit 1",
      [vehicleId],
    );
  }
}

async function fetchEnabledGlobalPlan() {
  try {
    return await dbQuery<InsurancePlanRow>(
      "select id, vehicle_id, is_enabled, price_per_day_cents, coverage_cents, is_global_default from insurance_plans where is_global_default = true and is_enabled = true order by updated_at desc limit 1",
    );
  } catch (error) {
    if (!isUndefinedColumn(error, "coverage_cents")) {
      throw error;
    }

    return await dbQuery<InsurancePlanRow>(
      "select id, vehicle_id, is_enabled, price_per_day_cents, 155000::int as coverage_cents, is_global_default from insurance_plans where is_global_default = true and is_enabled = true order by updated_at desc limit 1",
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const vehicleId = normalizeText(searchParams.get("vehicleId"));

    let plan: InsurancePlanRow | null = null;
    if (vehicleId) {
      const vehiclePlan = await fetchEnabledVehiclePlan(vehicleId);
      plan = vehiclePlan.rows[0] ?? null;
    }

    if (!plan) {
      const globalPlan = await fetchEnabledGlobalPlan();
      plan = globalPlan.rows[0] ?? null;
    }

    if (!plan || !plan.is_enabled) {
      return NextResponse.json({
        insurance: {
          enabled: false,
          planId: null,
          pricePerDayCents: 0,
          coverageCents: 0,
        },
      }, {
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({
      insurance: {
        enabled: true,
        planId: plan.id,
        pricePerDayCents: Math.max(0, Number(plan.price_per_day_cents ?? 0)),
        coverageCents: Math.max(0, Number(plan.coverage_cents ?? 0)),
      },
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logError("api.public.insurance.GET", error);
    return NextResponse.json({ error: "Failed to load insurance options." }, { status: 500 });
  }
}
