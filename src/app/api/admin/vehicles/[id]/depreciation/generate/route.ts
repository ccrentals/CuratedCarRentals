import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import {
  generateSnapshots,
  monthStartIso,
  type DepreciationMethod,
  type VehicleFinanceInput,
} from "@/lib/vehicles/depreciation";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GenerateRouteContext = {
  params: Promise<{ id: string }>;
};

type VehicleFinanceRow = {
  purchase_date: string | null;
  purchase_cost_cents: number | null;
  residual_value_cents: number | null;
  useful_life_months: number | null;
  depreciation_method: string | null;
  is_active: boolean;
};

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getFinance: (vehicleId: string) => Promise<VehicleFinanceRow | null>;
  upsertSnapshots: (
    snapshots: Array<{
      vehicleId: string;
      asOfMonth: string;
      bookValueCents: number;
      accumulatedDepreciationCents: number;
      depreciationForMonthCents: number;
    }>,
  ) => Promise<number>;
};

function normalizeMonthInput(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}$/.test(text)) {
    return `${text}-01`;
  }
  return monthStartIso(text);
}

const DEFAULT_DEPS: RouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getFinance: async (vehicleId) => {
    const result = await dbQuery<VehicleFinanceRow>(
      `select
        purchase_date,
        purchase_price_cents as purchase_cost_cents,
        expected_rest_value_cents as residual_value_cents,
        depreciation_months as useful_life_months,
        method as depreciation_method,
        is_active
      from vehicle_depreciation_profiles
      where vehicle_id = $1::uuid
      limit 1`,
      [vehicleId],
    );
    return result.rows[0] ?? null;
  },
  upsertSnapshots: async (snapshots) => {
    if (snapshots.length < 1) return 0;

    const payload = snapshots.map((snapshot) => ({
      vehicle_id: snapshot.vehicleId,
      as_of_month: snapshot.asOfMonth,
      book_value_cents: snapshot.bookValueCents,
      accumulated_depreciation_cents: snapshot.accumulatedDepreciationCents,
      depreciation_for_month_cents: snapshot.depreciationForMonthCents,
    }));

    const result = await dbQuery<{ id: string }>(
      `insert into vehicle_depreciation_snapshots (vehicle_id, as_of_month, book_value_cents, accumulated_depreciation_cents, depreciation_for_month_cents)
       select
         item.vehicle_id::uuid,
         item.as_of_month::date,
         item.book_value_cents,
         item.accumulated_depreciation_cents,
         item.depreciation_for_month_cents
       from jsonb_to_recordset($1::jsonb) as item(
         vehicle_id text,
         as_of_month text,
         book_value_cents int,
         accumulated_depreciation_cents int,
         depreciation_for_month_cents int
       )
       on conflict (vehicle_id, as_of_month)
       do update set
         book_value_cents = excluded.book_value_cents,
         accumulated_depreciation_cents = excluded.accumulated_depreciation_cents,
         depreciation_for_month_cents = excluded.depreciation_for_month_cents,
         created_at = now()
       returning id`,
      [JSON.stringify(payload)],
    );

    return result.rowCount;
  },
};

export async function handleAdminVehicleDepreciationGeneratePost(
  request: Request,
  context: GenerateRouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !(await deps.requireCsrfCheck(
      request,
      (body?.csrfToken as string | null | undefined) ?? null,
    ))
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid CSRF token" },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  const startMonth = normalizeMonthInput(body?.startMonth ?? body?.start_month);
  const endMonth = normalizeMonthInput(body?.endMonth ?? body?.end_month);
  if (!startMonth || !endMonth) {
    return NextResponse.json(
      { ok: false, error: "Start month and end month are required." },
      { status: 400 },
    );
  }

  try {
    const finance = await deps.getFinance(id);
    if (!finance) {
      return NextResponse.json(
        { ok: false, error: "Finance record not found for this vehicle." },
        { status: 404 },
      );
    }
    if (!finance.is_active) {
      return NextResponse.json(
        { ok: false, error: "Depreciation profile is inactive for this vehicle." },
        { status: 400 },
      );
    }

    const generated = generateSnapshots(id, startMonth, endMonth, {
      purchaseDate: finance.purchase_date,
      purchaseCostCents: finance.purchase_cost_cents,
      residualValueCents: finance.residual_value_cents,
      usefulLifeMonths: finance.useful_life_months,
      depreciationMethod: finance.depreciation_method as DepreciationMethod | null,
    } satisfies VehicleFinanceInput);

    if (generated.incompleteReason) {
      return NextResponse.json(
        { ok: false, error: generated.incompleteReason },
        { status: 400 },
      );
    }

    if (generated.snapshots.length > 600) {
      return NextResponse.json(
        { ok: false, error: "Requested month range is too large." },
        { status: 400 },
      );
    }

    const savedCount = await deps.upsertSnapshots(generated.snapshots);

    return NextResponse.json({
      ok: true,
      generatedCount: savedCount,
      startMonth,
      endMonth,
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle depreciation tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Failed to generate depreciation snapshots." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: GenerateRouteContext) {
  return handleAdminVehicleDepreciationGeneratePost(request, context);
}
