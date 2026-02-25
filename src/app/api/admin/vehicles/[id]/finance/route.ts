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
  useful_life_months: number | null;
  depreciation_method: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type FinancePayload = {
  purchaseDate: string | null;
  purchaseCostCents: number | null;
  residualValueCents: number | null;
  usefulLifeMonths: number | null;
  depreciationMethod: DepreciationMethod;
  notes: string | null;
};

type FinanceDefaults = {
  depreciationMethod: DepreciationMethod;
  usefulLifeMonths: number;
  residualPercent: number;
};

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getDefaults: () => Promise<FinanceDefaults>;
  getFinance: (vehicleId: string) => Promise<VehicleFinanceRow | null>;
  upsertFinance: (vehicleId: string, payload: FinancePayload) => Promise<VehicleFinanceRow>;
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
      usefulLifeMonths: defaults.usefulLifeMonths,
      depreciationMethod: defaults.depreciationMethod,
      notes: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    purchaseDate: row.purchase_date,
    purchaseCostCents: row.purchase_cost_cents,
    residualValueCents: row.residual_value_cents,
    usefulLifeMonths: row.useful_life_months,
    depreciationMethod: row.depreciation_method,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function metricsForFinance(finance: {
  purchaseDate: string | null;
  purchaseCostCents: number | null;
  residualValueCents: number | null;
  usefulLifeMonths: number | null;
  depreciationMethod: string | null;
}) {
  const asOfMonth = monthStartIso(new Date()) ?? monthStartIso(new Date())!;
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
      accumulatedDepreciationCents: computed.accumulatedDepreciationCents,
      bookValueCents: computed.bookValueCents,
    },
    incompleteReason: null,
  };
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
      "select vehicle_id, purchase_date, purchase_cost_cents, residual_value_cents, useful_life_months, depreciation_method, notes, created_at, updated_at from vehicle_finance where vehicle_id = $1::uuid limit 1",
      [vehicleId],
    );
    return result.rows[0] ?? null;
  },
  upsertFinance: async (vehicleId, payload) => {
    const result = await dbQuery<VehicleFinanceRow>(
      "insert into vehicle_finance (vehicle_id, purchase_date, purchase_cost_cents, residual_value_cents, useful_life_months, depreciation_method, notes) values ($1::uuid, $2::date, $3, $4, $5, $6, $7) on conflict (vehicle_id) do update set purchase_date = excluded.purchase_date, purchase_cost_cents = excluded.purchase_cost_cents, residual_value_cents = excluded.residual_value_cents, useful_life_months = excluded.useful_life_months, depreciation_method = excluded.depreciation_method, notes = excluded.notes, updated_at = now() returning vehicle_id, purchase_date, purchase_cost_cents, residual_value_cents, useful_life_months, depreciation_method, notes, created_at, updated_at",
      [
        vehicleId,
        payload.purchaseDate,
        payload.purchaseCostCents,
        payload.residualValueCents,
        payload.usefulLifeMonths,
        payload.depreciationMethod,
        payload.notes,
      ],
    );
    return result.rows[0];
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
    const [defaults, financeRow] = await Promise.all([
      deps.getDefaults(),
      deps.getFinance(id),
    ]);
    const finance = mapFinance(financeRow, defaults);
    const computed = metricsForFinance(finance);

    return NextResponse.json({
      ok: true,
      defaults,
      finance,
      asOfMonth: computed.asOfMonth,
      metrics: computed.metrics,
      incompleteReason: computed.incompleteReason,
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
        { ok: false, error: "Vehicle finance tables are not installed." },
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
    const defaults = await deps.getDefaults();

    const purchaseCostCents = normalizeNullableNonNegativeInt(
      body?.purchaseCostCents ?? body?.purchase_cost_cents,
    );
    const residualValueCents = normalizeNullableNonNegativeInt(
      body?.residualValueCents ?? body?.residual_value_cents,
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
      usefulLifeMonths,
      depreciationMethod: normalizeDepreciationMethod(
        depreciationMethodInput,
        defaults.depreciationMethod,
      ),
      notes: normalizeNullableText(body?.notes, 4000),
    };

    const row = await deps.upsertFinance(id, payload);
    const finance = mapFinance(row, defaults);
    const computed = metricsForFinance(finance);

    return NextResponse.json({
      ok: true,
      defaults,
      finance,
      asOfMonth: computed.asOfMonth,
      metrics: computed.metrics,
      incompleteReason: computed.incompleteReason,
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle finance tables are not installed." },
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
