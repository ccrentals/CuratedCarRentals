import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  deleteVehiclePricingRules,
  getVehiclePricingProfile,
  upsertVehiclePricingRules,
  type VehiclePricingDateRangeOverride,
  type VehiclePricingDeliveryZone,
  type VehiclePricingProfile,
  type VehiclePricingRulesPatch,
} from "@/lib/bookings/pricingRules";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type RawBody = Record<string, unknown> | null;

export type AdminVehiclePricingRulesRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  vehicleExists: (vehicleId: string) => Promise<boolean>;
  getProfile: (vehicleId: string) => Promise<VehiclePricingProfile | null>;
  deleteRules: (vehicleId: string) => Promise<void>;
  saveRules: (vehicleId: string, patch: VehiclePricingRulesPatch) => Promise<{
    id: string | null;
    vehicleId: string;
    baseDailyRateCents: number | null;
    baseDepositCents: number | null;
    weekendDailyRateCents: number | null;
    dateRangeOverrides: VehiclePricingDateRangeOverride[];
    deliveryEnabled: boolean;
    deliveryFeeCents: number;
    deliveryZones: VehiclePricingDeliveryZone[];
    currency: string;
    isActive: boolean;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
};

const DEFAULT_DEPS: AdminVehiclePricingRulesRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  vehicleExists: async (vehicleId) => {
    const result = await dbQuery<{ exists: boolean }>(
      "select exists(select 1 from vehicles where id = $1::uuid) as exists",
      [vehicleId],
    );
    return Boolean(result.rows[0]?.exists);
  },
  getProfile: (vehicleId) => getVehiclePricingProfile(vehicleId),
  deleteRules: (vehicleId) => deleteVehiclePricingRules(vehicleId),
  saveRules: (vehicleId, patch) => upsertVehiclePricingRules(vehicleId, patch),
};

function readBodyValue(body: RawBody, keys: string[]) {
  if (!body) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return body[key];
    }
  }
  return undefined;
}

function normalizeOptionalMoney(
  value: unknown,
  fallback: number | null,
  label: string,
): { value: number | null; error?: string } {
  if (value === undefined) return { value: fallback };
  if (value === null) return { value: null };
  if (typeof value === "string" && !value.trim()) return { value: null };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { value: fallback, error: `${label} must be a whole number greater than or equal to 0.` };
  }
  const rounded = Math.round(parsed);
  if (rounded < 0) {
    return { value: fallback, error: `${label} must be greater than or equal to 0.` };
  }
  return { value: rounded };
}

function normalizeMoney(
  value: unknown,
  fallback: number,
  label: string,
): { value: number; error?: string } {
  if (value === undefined) return { value: fallback };
  if (value === null || (typeof value === "string" && !value.trim())) {
    return { value: 0 };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { value: fallback, error: `${label} must be a whole number greater than or equal to 0.` };
  }
  const rounded = Math.round(parsed);
  if (rounded < 0) {
    return { value: fallback, error: `${label} must be greater than or equal to 0.` };
  }
  return { value: rounded };
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeCurrency(value: unknown, fallback: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 8);
}

function normalizeDateOnly(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return DATE_ONLY_REGEX.test(trimmed) ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeDateRangeOverrides(
  value: unknown,
  fallback: VehiclePricingDateRangeOverride[],
): { value: VehiclePricingDateRangeOverride[]; error?: string } {
  if (value === undefined) return { value: fallback };
  if (value === null || value === "") return { value: [] };
  if (!Array.isArray(value)) {
    return { value: fallback, error: "Date range overrides must be an array." };
  }

  const normalized: VehiclePricingDateRangeOverride[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    if (!row) continue;

    const start = normalizeDateOnly(row.start ?? row.start_date);
    const end = normalizeDateOnly(row.end ?? row.end_date);
    const daily = normalizeOptionalMoney(
      row.dailyRateCents ?? row.daily_rate_cents,
      null,
      "Date range daily rate",
    );
    const deposit = normalizeOptionalMoney(
      row.depositCents ?? row.deposit_cents,
      null,
      "Date range deposit",
    );

    if (daily.error || deposit.error) {
      return {
        value: fallback,
        error: daily.error ?? deposit.error ?? "Invalid date range override values.",
      };
    }

    if (!start || !end || daily.value === null) {
      return {
        value: fallback,
        error: "Each date range override requires start, end, and daily rate.",
      };
    }
    if (start > end) {
      return {
        value: fallback,
        error: "Date range override start date cannot be after end date.",
      };
    }

    normalized.push({
      start,
      end,
      dailyRateCents: daily.value,
      depositCents: deposit.value,
    });
    if (normalized.length >= 64) break;
  }

  normalized.sort((a, b) => (a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start)));
  return { value: normalized };
}

function normalizeDeliveryZones(
  value: unknown,
  fallback: VehiclePricingDeliveryZone[],
): { value: VehiclePricingDeliveryZone[]; error?: string } {
  if (value === undefined) return { value: fallback };
  if (value === null || value === "") return { value: [] };
  if (!Array.isArray(value)) {
    return { value: fallback, error: "Delivery zones must be an array." };
  }

  const zones: VehiclePricingDeliveryZone[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    if (!row) continue;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label) {
      return { value: fallback, error: "Each delivery zone requires a label." };
    }
    const fee = normalizeMoney(row.feeCents ?? row.fee_cents, 0, "Delivery zone fee");
    if (fee.error) {
      return { value: fallback, error: fee.error };
    }
    zones.push({ label: label.slice(0, 80), feeCents: fee.value });
    if (zones.length >= 64) break;
  }

  return { value: zones };
}

function normalizePatchInput(
  body: RawBody,
  profile: VehiclePricingProfile,
): { patch: VehiclePricingRulesPatch | null; error: string | null } {
  const current = profile.rules;
  const weekendDaily = normalizeOptionalMoney(
    readBodyValue(body, ["weekendDailyRateCents", "weekend_daily_rate_cents"]),
    current.weekendDailyRateCents,
    "Weekend daily rate",
  );
  if (weekendDaily.error) return { patch: null, error: weekendDaily.error };

  const deliveryFee = normalizeMoney(
    readBodyValue(body, ["deliveryFeeCents", "delivery_fee_cents"]),
    current.deliveryFeeCents,
    "Delivery fee",
  );
  if (deliveryFee.error) return { patch: null, error: deliveryFee.error };

  const dateOverrides = normalizeDateRangeOverrides(
    readBodyValue(body, ["dateRangeOverrides", "date_range_overrides_json"]),
    current.dateRangeOverrides,
  );
  if (dateOverrides.error) return { patch: null, error: dateOverrides.error };

  const deliveryZones = normalizeDeliveryZones(
    readBodyValue(body, ["deliveryZones", "delivery_zones_json"]),
    current.deliveryZones,
  );
  if (deliveryZones.error) return { patch: null, error: deliveryZones.error };

  return {
    patch: {
      baseDailyRateCents: null,
      baseDepositCents: null,
      weekendDailyRateCents: weekendDaily.value,
      dateRangeOverrides: dateOverrides.value,
      deliveryEnabled: normalizeBoolean(
        readBodyValue(body, ["deliveryEnabled", "delivery_enabled"]),
        current.deliveryEnabled,
      ),
      deliveryFeeCents: deliveryFee.value,
      deliveryZones: deliveryZones.value,
      currency: normalizeCurrency(readBodyValue(body, ["currency"]), current.currency),
      isActive: normalizeBoolean(readBodyValue(body, ["isActive", "is_active"]), current.isActive),
    },
    error: null,
  };
}

export async function handleAdminVehiclePricingRulesGet(
  _request: Request,
  context: RouteContext,
  deps: AdminVehiclePricingRulesRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  try {
    const exists = await deps.vehicleExists(id);
    if (!exists) {
      return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
    }

    const profile = await deps.getProfile(id);
    if (!profile) {
      return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      rules: profile.rules,
      defaultsApplied: profile.defaultsApplied,
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle pricing rules tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Failed to load vehicle pricing rules." },
      { status: 500 },
    );
  }
}

export async function handleAdminVehiclePricingRulesDelete(
  request: Request,
  context: RouteContext,
  deps: AdminVehiclePricingRulesRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as RawBody;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  try {
    const exists = await deps.vehicleExists(id);
    if (!exists) {
      return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
    }

    await deps.deleteRules(id);
    const profile = await deps.getProfile(id);
    if (!profile) {
      return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      rules: profile.rules,
      defaultsApplied: profile.defaultsApplied,
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle pricing rules tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Failed to restore default vehicle pricing rules." },
      { status: 500 },
    );
  }
}

export async function handleAdminVehiclePricingRulesPatch(
  request: Request,
  context: RouteContext,
  deps: AdminVehiclePricingRulesRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as RawBody;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  try {
    const exists = await deps.vehicleExists(id);
    if (!exists) {
      return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
    }

    const profile = await deps.getProfile(id);
    if (!profile) {
      return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
    }

    const normalized = normalizePatchInput(body, profile);
    if (!normalized.patch || normalized.error) {
      return NextResponse.json(
        { ok: false, error: normalized.error ?? "Invalid pricing rules payload." },
        { status: 400 },
      );
    }

    const rules = await deps.saveRules(id, normalized.patch);
    return NextResponse.json({
      ok: true,
      rules,
      defaultsApplied: false,
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle pricing rules tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Failed to save vehicle pricing rules." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleAdminVehiclePricingRulesGet(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleAdminVehiclePricingRulesPatch(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleAdminVehiclePricingRulesDelete(request, context);
}
