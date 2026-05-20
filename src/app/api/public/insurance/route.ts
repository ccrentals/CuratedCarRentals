import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";

type InsurancePlanRow = {
  id: string;
  vehicle_id: string | null;
  is_enabled: boolean;
  price_per_day_cents: number;
  is_global_default: boolean;
};

function normalizeText(value: string | null) {
  if (!value) return "";
  return value.trim();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const vehicleId = normalizeText(searchParams.get("vehicleId"));

    let plan: InsurancePlanRow | null = null;
    const globalPlan = await dbQuery<InsurancePlanRow>(
      "select id, vehicle_id, is_enabled, price_per_day_cents, is_global_default from insurance_plans where is_global_default = true and is_enabled = true order by updated_at desc limit 1",
    );
    plan = globalPlan.rows[0] ?? null;

    if (!plan && vehicleId) {
      const vehiclePlan = await dbQuery<InsurancePlanRow>(
        "select id, vehicle_id, is_enabled, price_per_day_cents, is_global_default from insurance_plans where vehicle_id = $1 and is_enabled = true order by updated_at desc limit 1",
        [vehicleId],
      );
      plan = vehiclePlan.rows[0] ?? null;
    }

    if (!plan || !plan.is_enabled) {
      return NextResponse.json({
        insurance: {
          enabled: false,
          planId: null,
          pricePerDayCents: 0,
        },
      });
    }

    return NextResponse.json({
      insurance: {
        enabled: true,
        planId: plan.id,
        pricePerDayCents: Math.max(0, Number(plan.price_per_day_cents ?? 0)),
      },
    });
  } catch (error) {
    logError("api.public.insurance.GET", error);
    return NextResponse.json({ error: "Failed to load insurance options." }, { status: 500 });
  }
}
