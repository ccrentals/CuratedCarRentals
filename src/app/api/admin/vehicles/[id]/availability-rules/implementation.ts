import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  deleteVehicleAvailabilityRules,
  getVehicleAvailabilityRules,
  upsertVehicleAvailabilityRules,
  type VehicleAvailabilityRulesPatch,
  type VehicleAvailabilityRulesReadResult,
} from "@/lib/bookings/availabilityRules";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type RawBody = Record<string, unknown> | null;

export type AdminVehicleAvailabilityRulesRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  vehicleExists: (vehicleId: string) => Promise<boolean>;
  getRules: (vehicleId: string) => Promise<VehicleAvailabilityRulesReadResult>;
  deleteRules: (vehicleId: string) => Promise<void>;
  saveRules: (vehicleId: string, patch: VehicleAvailabilityRulesPatch) => Promise<{
    id: string | null;
    vehicleId: string;
    advanceNoticeHours: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    allowedPickupStartHour: number | null;
    allowedPickupEndHour: number | null;
    allowedDropoffStartHour: number | null;
    allowedDropoffEndHour: number | null;
    isActive: boolean;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
};

const DEFAULT_DEPS: AdminVehicleAvailabilityRulesRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  vehicleExists: async (vehicleId) => {
    const result = await dbQuery<{ exists: boolean }>(
      "select exists(select 1 from vehicles where id = $1::uuid) as exists",
      [vehicleId],
    );
    return Boolean(result.rows[0]?.exists);
  },
  getRules: (vehicleId) => getVehicleAvailabilityRules(vehicleId),
  deleteRules: (vehicleId) => deleteVehicleAvailabilityRules(vehicleId),
  saveRules: (vehicleId, patch) => upsertVehicleAvailabilityRules(vehicleId, patch),
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

function parseNonNegativeInt(value: unknown, fallback: number) {
  if (value === undefined) return { value: fallback };
  if (value === null || value === "") return { value: 0 };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { error: "Value must be a whole number." };
  }
  const rounded = Math.round(parsed);
  if (rounded < 0) {
    return { error: "Value must be greater than or equal to 0." };
  }
  return { value: rounded };
}

function parseOptionalHour(value: unknown, fallback: number | null) {
  if (value === undefined) return { value: fallback };
  if (value === null || value === "") return { value: null };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { error: "Hour must be a whole number from 0 to 23." };
  }
  const rounded = Math.round(parsed);
  if (rounded < 0 || rounded > 23) {
    return { error: "Hour must be between 0 and 23." };
  }
  return { value: rounded };
}

function parseBoolean(value: unknown, fallback: boolean) {
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

function normalizePatchInput(
  body: RawBody,
  current: VehicleAvailabilityRulesReadResult["rules"],
): { patch: VehicleAvailabilityRulesPatch | null; error: string | null } {
  const advanceNotice = parseNonNegativeInt(
    readBodyValue(body, ["advanceNoticeHours", "advance_notice_hours"]),
    current.advanceNoticeHours,
  );
  if (advanceNotice.error) return { patch: null, error: `Advance notice: ${advanceNotice.error}` };

  const bufferBefore = parseNonNegativeInt(
    readBodyValue(body, ["bufferBeforeMinutes", "buffer_before_minutes"]),
    current.bufferBeforeMinutes,
  );
  if (bufferBefore.error) return { patch: null, error: `Buffer before: ${bufferBefore.error}` };

  const bufferAfter = parseNonNegativeInt(
    readBodyValue(body, ["bufferAfterMinutes", "buffer_after_minutes"]),
    current.bufferAfterMinutes,
  );
  if (bufferAfter.error) return { patch: null, error: `Buffer after: ${bufferAfter.error}` };

  const pickupStart = parseOptionalHour(
    readBodyValue(body, ["allowedPickupStartHour", "allowed_pickup_start_hour"]),
    current.allowedPickupStartHour,
  );
  if (pickupStart.error) return { patch: null, error: `Pickup start hour: ${pickupStart.error}` };

  const pickupEnd = parseOptionalHour(
    readBodyValue(body, ["allowedPickupEndHour", "allowed_pickup_end_hour"]),
    current.allowedPickupEndHour,
  );
  if (pickupEnd.error) return { patch: null, error: `Pickup end hour: ${pickupEnd.error}` };

  const dropoffStart = parseOptionalHour(
    readBodyValue(body, ["allowedDropoffStartHour", "allowed_dropoff_start_hour"]),
    current.allowedDropoffStartHour,
  );
  if (dropoffStart.error) return { patch: null, error: `Dropoff start hour: ${dropoffStart.error}` };

  const dropoffEnd = parseOptionalHour(
    readBodyValue(body, ["allowedDropoffEndHour", "allowed_dropoff_end_hour"]),
    current.allowedDropoffEndHour,
  );
  if (dropoffEnd.error) return { patch: null, error: `Dropoff end hour: ${dropoffEnd.error}` };

  const pickupStartValue = pickupStart.value ?? null;
  const pickupEndValue = pickupEnd.value ?? null;
  const dropoffStartValue = dropoffStart.value ?? null;
  const dropoffEndValue = dropoffEnd.value ?? null;

  if (
    pickupStartValue !== null &&
    pickupEndValue !== null &&
    pickupStartValue > pickupEndValue
  ) {
    return { patch: null, error: "Pickup start hour cannot be later than pickup end hour." };
  }

  if (
    dropoffStartValue !== null &&
    dropoffEndValue !== null &&
    dropoffStartValue > dropoffEndValue
  ) {
    return { patch: null, error: "Dropoff start hour cannot be later than dropoff end hour." };
  }

  return {
    patch: {
      advanceNoticeHours: advanceNotice.value ?? 0,
      bufferBeforeMinutes: bufferBefore.value ?? 0,
      bufferAfterMinutes: bufferAfter.value ?? 0,
      allowedPickupStartHour: pickupStartValue,
      allowedPickupEndHour: pickupEndValue,
      allowedDropoffStartHour: dropoffStartValue,
      allowedDropoffEndHour: dropoffEndValue,
      isActive: parseBoolean(readBodyValue(body, ["isActive", "is_active"]), current.isActive),
    },
    error: null,
  };
}

export async function handleAdminVehicleAvailabilityRulesGet(
  _request: Request,
  context: RouteContext,
  deps: AdminVehicleAvailabilityRulesRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
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

    const result = await deps.getRules(id);
    return NextResponse.json({
      ok: true,
      rules: result.rules,
      defaultsApplied: result.defaultsApplied,
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle availability rules tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Failed to load vehicle availability rules." },
      { status: 500 },
    );
  }
}

export async function handleAdminVehicleAvailabilityRulesPatch(
  request: Request,
  context: RouteContext,
  deps: AdminVehicleAvailabilityRulesRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
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

    const current = await deps.getRules(id);
    const normalized = normalizePatchInput(body, current.rules);
    if (!normalized.patch || normalized.error) {
      return NextResponse.json(
        { ok: false, error: normalized.error ?? "Invalid availability rules payload." },
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
        { ok: false, error: "Vehicle availability rules tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Failed to save vehicle availability rules." },
      { status: 500 },
    );
  }
}

export async function handleAdminVehicleAvailabilityRulesDelete(
  request: Request,
  context: RouteContext,
  deps: AdminVehicleAvailabilityRulesRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
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
    const result = await deps.getRules(id);
    return NextResponse.json({
      ok: true,
      rules: result.rules,
      defaultsApplied: result.defaultsApplied,
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle availability rules tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Failed to restore default vehicle availability rules." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleAdminVehicleAvailabilityRulesGet(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleAdminVehicleAvailabilityRulesPatch(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleAdminVehicleAvailabilityRulesDelete(request, context);
}
