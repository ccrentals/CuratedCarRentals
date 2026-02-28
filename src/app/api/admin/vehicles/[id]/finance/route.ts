import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { loadAdminSettings } from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
import {
  computeBookValueAtMonth,
  DEPRECIATION_METHODS,
  monthStartIso,
  type DepreciationMethod,
  type VehicleFinanceInput,
} from "@/lib/vehicles/depreciation";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FinanceRouteContext = {
  params: Promise<{ id: string }>;
};

type VehicleFinanceRow = {
  vehicle_id: string;
  purchase_date: string | null;
  purchase_cost_cents: number | null;
  residual_value_cents: number | null;
  odometer_at_purchase: number | null;
  useful_life_months: number | null;
  depreciation_method: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type FinancePayload = {
  purchaseDate: string | null;
  purchaseCostCents: number | null;
  residualValueCents: number | null;
  odometerAtPurchase: number | null;
  usefulLifeMonths: number | null;
  depreciationMethod: DepreciationMethod;
  isActive: boolean;
  notes: string | null;
};

type FinanceDefaults = {
  depreciationMethod: DepreciationMethod;
  usefulLifeMonths: number;
  residualPercent: number;
};

type VehicleDepreciationSnapshotRow = {
  as_of_month: string;
  book_value_cents: number;
  accumulated_depreciation_cents: number;
  depreciation_for_month_cents: number;
};

type VehicleDepreciationSnapshot = {
  asOfMonth: string;
  bookValueCents: number;
  accumulatedDepreciationCents: number;
  depreciationForMonthCents: number;
};

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getDefaults: () => Promise<FinanceDefaults>;
  getFinance: (vehicleId: string) => Promise<VehicleFinanceRow | null>;
  upsertFinance: (vehicleId: string, payload: FinancePayload) => Promise<VehicleFinanceRow>;
  listSnapshots?: (vehicleId: string) => Promise<VehicleDepreciationSnapshotRow[]>;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeNullableText(value: unknown, maxLength: number) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeNullableDate(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeNullableNonNegativeInt(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 ? rounded : null;
}

function normalizeNullablePositiveInt(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 1 ? rounded : null;
}

function hasNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed < 0;
}

function normalizeBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeDepreciationMethod(
  value: unknown,
  fallback: DepreciationMethod,
): DepreciationMethod {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) return fallback;
  if (
    DEPRECIATION_METHODS.includes(
      normalized as (typeof DEPRECIATION_METHODS)[number],
    )
  ) {
    return normalized as DepreciationMethod;
  }
  return fallback;
}

function mapFinance(row: VehicleFinanceRow | null, defaults: FinanceDefaults) {
  if (!row) {
    return {
      purchaseDate: null,
      purchaseCostCents: null,
      residualValueCents: null,
      odometerAtPurchase: null,
      usefulLifeMonths: defaults.usefulLifeMonths,
      depreciationMethod: defaults.depreciationMethod,
      isActive: true,
      notes: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    purchaseDate: row.purchase_date,
    purchaseCostCents: row.purchase_cost_cents,
    residualValueCents: row.residual_value_cents,
    odometerAtPurchase: row.odometer_at_purchase,
    usefulLifeMonths: row.useful_life_months,
    depreciationMethod: row.depreciation_method,
    isActive: row.is_active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function metricsForFinance(finance: {
  purchaseDate: string | null;
  purchaseCostCents: number | null;
  residualValueCents: number | null;
  odometerAtPurchase: number | null;
  usefulLifeMonths: number | null;
  depreciationMethod: string | null;
  isActive: boolean;
}) {
  const asOfMonth = monthStartIso(new Date()) ?? monthStartIso(new Date())!;
  if (!finance.isActive) {
    return {
      asOfMonth,
      metrics: null,
      incompleteReason: "Depreciation profile is inactive.",
    };
  }

  const computed = computeBookValueAtMonth(
    {
      purchaseDate: finance.purchaseDate,
      purchaseCostCents: finance.purchaseCostCents,
      residualValueCents: finance.residualValueCents,
      usefulLifeMonths: finance.usefulLifeMonths,
      depreciationMethod: finance.depreciationMethod,
    } satisfies VehicleFinanceInput,
    asOfMonth,
  );

  if ("incompleteReason" in computed) {
    return {
      asOfMonth,
      metrics: null,
      incompleteReason: computed.incompleteReason,
    };
  }

  return {
      asOfMonth: computed.asOfMonth,
      metrics: {
        monthlyDepreciationCents: computed.monthlyDepreciationCents,
        depreciationForMonthCents: computed.depreciationForMonthCents,
        depreciatedAmountCents: computed.accumulatedDepreciationCents,
        accumulatedDepreciationCents: computed.accumulatedDepreciationCents,
        bookValueCents: computed.bookValueCents,
        monthsElapsed: computed.monthsElapsed,
        monthsRemaining: computed.monthsRemaining,
      },
      incompleteReason: null,
    };
}

function mapSnapshots(rows: VehicleDepreciationSnapshotRow[]): VehicleDepreciationSnapshot[] {
  return rows.map((row) => ({
    asOfMonth: row.as_of_month,
    bookValueCents: row.book_value_cents,
    accumulatedDepreciationCents: row.accumulated_depreciation_cents,
    depreciationForMonthCents: row.depreciation_for_month_cents,
  }));
}

const DEFAULT_DEPS: RouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getDefaults: async () => {
    const { settings } = await loadAdminSettings();
    return {
      depreciationMethod:
        settings.depreciationDefaultMethod === "STRAIGHT_LINE"
          ? "STRAIGHT_LINE"
          : "STRAIGHT_LINE",
      usefulLifeMonths: settings.depreciationDefaultUsefulLifeMonths,
      residualPercent: settings.depreciationDefaultResidualPercent,
    };
  },
  getFinance: async (vehicleId) => {
    const result = await dbQuery<VehicleFinanceRow>(
      `select
        vehicle_id,
        purchase_date,
        purchase_price_cents as purchase_cost_cents,
        expected_rest_value_cents as residual_value_cents,
        odometer_at_purchase_km as odometer_at_purchase,
        depreciation_months as useful_life_months,
        method as depreciation_method,
        is_active,
        notes,
        created_at,
        updated_at
      from vehicle_depreciation_profiles
      where vehicle_id = $1::uuid
      limit 1`,
      [vehicleId],
    );
    return result.rows[0] ?? null;
  },
  upsertFinance: async (vehicleId, payload) => {
    const result = await dbQuery<VehicleFinanceRow>(
      `insert into vehicle_depreciation_profiles (
        vehicle_id,
        purchase_date,
        purchase_price_cents,
        expected_rest_value_cents,
        odometer_at_purchase_km,
        depreciation_months,
        method,
        is_active,
        notes
      )
      values ($1::uuid, $2::date, $3, $4, $5, $6, $7, $8, $9)
      on conflict (vehicle_id)
      do update set
        purchase_date = excluded.purchase_date,
        purchase_price_cents = excluded.purchase_price_cents,
        expected_rest_value_cents = excluded.expected_rest_value_cents,
        odometer_at_purchase_km = excluded.odometer_at_purchase_km,
        depreciation_months = excluded.depreciation_months,
        method = excluded.method,
        is_active = excluded.is_active,
        notes = excluded.notes,
        updated_at = now()
      returning
        vehicle_id,
        purchase_date,
        purchase_price_cents as purchase_cost_cents,
        expected_rest_value_cents as residual_value_cents,
        odometer_at_purchase_km as odometer_at_purchase,
        depreciation_months as useful_life_months,
        method as depreciation_method,
        is_active,
        notes,
        created_at,
        updated_at`,
      [
        vehicleId,
        payload.purchaseDate,
        payload.purchaseCostCents,
        payload.residualValueCents,
        payload.odometerAtPurchase,
        payload.usefulLifeMonths,
        payload.depreciationMethod,
        payload.isActive,
        payload.notes,
      ],
    );
    return result.rows[0];
  },
  listSnapshots: async (vehicleId) => {
    const result = await dbQuery<VehicleDepreciationSnapshotRow>(
      `select
         as_of_month::text as as_of_month,
         book_value_cents,
         accumulated_depreciation_cents,
         depreciation_for_month_cents
       from vehicle_depreciation_snapshots
       where vehicle_id = $1::uuid
       order by as_of_month desc
       limit 120`,
      [vehicleId],
    );
    return result.rows;
  },
};

export async function handleAdminVehicleFinanceGet(
  _request: Request,
  context: FinanceRouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  try {
    const listSnapshots = deps.listSnapshots ?? (async () => []);
    const [defaults, financeRow] = await Promise.all([
      deps.getDefaults(),
      deps.getFinance(id),
    ]);
    const snapshotRows = await listSnapshots(id);
    const finance = mapFinance(financeRow, defaults);
    const computed = metricsForFinance(finance);

    return NextResponse.json({
      ok: true,
      defaults,
      finance,
      asOfMonth: computed.asOfMonth,
      metrics: computed.metrics,
      incompleteReason: computed.incompleteReason,
      snapshots: mapSnapshots(snapshotRows),
    });
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code ?? "");
    if (code === "23503") {
      return NextResponse.json(
        { ok: false, error: "Vehicle not found." },
        { status: 404 },
      );
    }
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle depreciation profile tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Failed to load vehicle finance." },
      { status: 500 },
    );
  }
}

export async function handleAdminVehicleFinancePatch(
  request: Request,
  context: FinanceRouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
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

  try {
    const listSnapshots = deps.listSnapshots ?? (async () => []);
    const defaults = await deps.getDefaults();
    const rawUsefulLifeMonths = body?.usefulLifeMonths ?? body?.useful_life_months;

    const purchaseCostCents = normalizeNullableNonNegativeInt(
      body?.purchaseCostCents ?? body?.purchase_cost_cents,
    );
    const residualValueCents = normalizeNullableNonNegativeInt(
      body?.residualValueCents ?? body?.residual_value_cents,
    );
    const odometerAtPurchase = normalizeNullableNonNegativeInt(
      body?.odometerAtPurchase ?? body?.odometer_at_purchase,
    );
    const usefulLifeMonths = normalizeNullablePositiveInt(
      body?.usefulLifeMonths ?? body?.useful_life_months,
    );
    const depreciationMethodInput = normalizeText(
      body?.depreciationMethod ?? body?.depreciation_method,
    ).toUpperCase();

    if (
      depreciationMethodInput &&
      !DEPRECIATION_METHODS.includes(
        depreciationMethodInput as (typeof DEPRECIATION_METHODS)[number],
      )
    ) {
      return NextResponse.json(
        { ok: false, error: "Unsupported depreciation method." },
        { status: 400 },
      );
    }

    if (
      hasNegativeNumber(body?.purchaseCostCents ?? body?.purchase_cost_cents) ||
      hasNegativeNumber(body?.residualValueCents ?? body?.residual_value_cents) ||
      hasNegativeNumber(body?.odometerAtPurchase ?? body?.odometer_at_purchase)
    ) {
      return NextResponse.json(
        { ok: false, error: "Negative values are not allowed." },
        { status: 400 },
      );
    }

    if (
      rawUsefulLifeMonths !== undefined &&
      rawUsefulLifeMonths !== null &&
      rawUsefulLifeMonths !== "" &&
      usefulLifeMonths === null
    ) {
      return NextResponse.json(
        { ok: false, error: "Useful life months must be at least 1." },
        { status: 400 },
      );
    }

    if (
      purchaseCostCents !== null &&
      residualValueCents !== null &&
      residualValueCents > purchaseCostCents
    ) {
      return NextResponse.json(
        { ok: false, error: "Residual value cannot exceed purchase cost." },
        { status: 400 },
      );
    }

    const payload: FinancePayload = {
      purchaseDate: normalizeNullableDate(
        body?.purchaseDate ?? body?.purchase_date,
      ),
      purchaseCostCents,
      residualValueCents,
      odometerAtPurchase,
      usefulLifeMonths,
      depreciationMethod: normalizeDepreciationMethod(
        depreciationMethodInput,
        defaults.depreciationMethod,
      ),
      isActive: normalizeBoolean(body?.isActive ?? body?.is_active, true),
      notes: normalizeNullableText(body?.notes, 4000),
    };

    const row = await deps.upsertFinance(id, payload);
    const snapshotRows = await listSnapshots(id);
    const finance = mapFinance(row, defaults);
    const computed = metricsForFinance(finance);

    return NextResponse.json({
      ok: true,
      defaults,
      finance,
      asOfMonth: computed.asOfMonth,
      metrics: computed.metrics,
      incompleteReason: computed.incompleteReason,
      snapshots: mapSnapshots(snapshotRows),
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle depreciation profile tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Failed to update vehicle finance." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request, context: FinanceRouteContext) {
  return handleAdminVehicleFinanceGet(request, context);
}

export async function PATCH(request: Request, context: FinanceRouteContext) {
  return handleAdminVehicleFinancePatch(request, context);
}
