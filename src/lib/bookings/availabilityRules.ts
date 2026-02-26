import {
  isVehicleUnavailableEntitlementBased,
  type OverlapWindowInput,
} from "@/lib/availability/entitlement";
import { dbQuery } from "@/lib/db";
import { logWarn } from "@/lib/log";
import type { Queryable } from "@/lib/payments/pricing";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VehicleAvailabilityRulesRow = {
  id: string;
  vehicle_id: string;
  advance_notice_hours: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  allowed_pickup_start_hour: number | null;
  allowed_pickup_end_hour: number | null;
  allowed_dropoff_start_hour: number | null;
  allowed_dropoff_end_hour: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type VehicleAvailabilityRules = {
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
};

export type VehicleAvailabilityRulesPatch = {
  advanceNoticeHours: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  allowedPickupStartHour: number | null;
  allowedPickupEndHour: number | null;
  allowedDropoffStartHour: number | null;
  allowedDropoffEndHour: number | null;
  isActive: boolean;
};

export type VehicleAvailabilityRulesReadResult = {
  rules: VehicleAvailabilityRules;
  defaultsApplied: boolean;
};

export type AvailabilityRuleEvaluation = {
  ok: boolean;
  reasons: string[];
  normalized: {
    startAt: string;
    endAt: string;
    effectiveStartAt: string;
    effectiveEndAt: string;
  } | null;
};

type VehicleAvailabilityCheckResult = {
  unavailable: boolean;
  reasons: string[];
  rules: VehicleAvailabilityRules;
  defaultsApplied: boolean;
  normalized: {
    startAt: string;
    endAt: string;
    effectiveStartAt: string;
    effectiveEndAt: string;
  } | null;
};

type AvailabilityCheckOptions = {
  client?: Queryable;
  includeBlockouts?: boolean;
  excludeBookingId?: string | null;
  now?: Date;
  rulesOverride?: VehicleAvailabilityRules;
};

type AvailabilityConflictChecker = (
  vehicleId: string,
  window: OverlapWindowInput,
  options: { client?: Queryable; includeBlockouts?: boolean; excludeBookingId?: string | null },
) => Promise<boolean>;

const DEFAULT_RULES: Omit<VehicleAvailabilityRules, "vehicleId" | "id" | "createdAt" | "updatedAt"> = {
  advanceNoticeHours: 0,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  allowedPickupStartHour: null,
  allowedPickupEndHour: null,
  allowedDropoffStartHour: null,
  allowedDropoffEndHour: null,
  isActive: true,
};

function isMissingRulesTableError(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "").toUpperCase();
  if (code !== "42P01") return false;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return message.includes("vehicle_availability_rules");
}

function toIso(value: string | Date) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function clampNonNegativeInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function clampHour(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < 0 || rounded > 23) return null;
  return rounded;
}

function normalizeRulesRow(row: VehicleAvailabilityRulesRow): VehicleAvailabilityRules {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    advanceNoticeHours: clampNonNegativeInt(row.advance_notice_hours),
    bufferBeforeMinutes: clampNonNegativeInt(row.buffer_before_minutes),
    bufferAfterMinutes: clampNonNegativeInt(row.buffer_after_minutes),
    allowedPickupStartHour: clampHour(row.allowed_pickup_start_hour),
    allowedPickupEndHour: clampHour(row.allowed_pickup_end_hour),
    allowedDropoffStartHour: clampHour(row.allowed_dropoff_start_hour),
    allowedDropoffEndHour: clampHour(row.allowed_dropoff_end_hour),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function defaultRulesForVehicle(vehicleId: string): VehicleAvailabilityRules {
  return {
    id: null,
    vehicleId,
    ...DEFAULT_RULES,
    createdAt: null,
    updatedAt: null,
  };
}

function hourOutsideRange(hour: number, startHour: number | null, endHour: number | null) {
  if (startHour !== null && hour < startHour) return true;
  if (endHour !== null && hour > endHour) return true;
  return false;
}

function formatHourRange(startHour: number | null, endHour: number | null) {
  if (startHour === null && endHour === null) return "any time";
  if (startHour !== null && endHour !== null) return `${startHour}:00-${endHour}:59`;
  if (startHour !== null) return `from ${startHour}:00`;
  return `until ${endHour}:59`;
}

function applyBufferWindow(
  startAtIso: string,
  endAtIso: string,
  rules: VehicleAvailabilityRules,
) {
  const start = new Date(startAtIso);
  const end = new Date(endAtIso);
  const effectiveStart = new Date(start.getTime() - rules.bufferBeforeMinutes * 60_000);
  const effectiveEnd = new Date(end.getTime() + rules.bufferAfterMinutes * 60_000);
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    effectiveStartAt: effectiveStart.toISOString(),
    effectiveEndAt: effectiveEnd.toISOString(),
  };
}

async function queryRulesByVehicleIds(
  vehicleIds: string[],
  client?: Queryable,
): Promise<Map<string, VehicleAvailabilityRules>> {
  const ids = vehicleIds.filter((vehicleId) => UUID_REGEX.test(vehicleId));
  if (ids.length === 0) return new Map();
  const queryable = client ?? {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };

  try {
    const result = await queryable.query(
      `select
         id,
         vehicle_id,
         advance_notice_hours,
         buffer_before_minutes,
         buffer_after_minutes,
         allowed_pickup_start_hour,
         allowed_pickup_end_hour,
         allowed_dropoff_start_hour,
         allowed_dropoff_end_hour,
         is_active,
         created_at,
         updated_at
       from vehicle_availability_rules
       where vehicle_id = any($1::uuid[])`,
      [ids],
    );

    const map = new Map<string, VehicleAvailabilityRules>();
    for (const rawRow of result.rows as VehicleAvailabilityRulesRow[]) {
      const row = normalizeRulesRow(rawRow);
      map.set(row.vehicleId, row);
    }
    return map;
  } catch (error) {
    if (isMissingRulesTableError(error)) {
      logWarn("vehicle_availability_rules_missing_table", { vehicleCount: ids.length });
      return new Map();
    }
    throw error;
  }
}

export async function getVehicleAvailabilityRules(
  vehicleId: string,
  options: { client?: Queryable } = {},
): Promise<VehicleAvailabilityRulesReadResult> {
  const map = await queryRulesByVehicleIds([vehicleId], options.client);
  const rules = map.get(vehicleId) ?? defaultRulesForVehicle(vehicleId);
  return {
    rules,
    defaultsApplied: !map.has(vehicleId),
  };
}

export async function getVehicleAvailabilityRulesMap(
  vehicleIds: string[],
  options: { client?: Queryable } = {},
) {
  const map = await queryRulesByVehicleIds(vehicleIds, options.client);
  const byVehicle = new Map<string, VehicleAvailabilityRulesReadResult>();

  for (const vehicleId of vehicleIds) {
    const rules = map.get(vehicleId) ?? defaultRulesForVehicle(vehicleId);
    byVehicle.set(vehicleId, {
      rules,
      defaultsApplied: !map.has(vehicleId),
    });
  }

  return byVehicle;
}

export async function upsertVehicleAvailabilityRules(
  vehicleId: string,
  rules: VehicleAvailabilityRulesPatch,
  options: { client?: Queryable } = {},
): Promise<VehicleAvailabilityRules> {
  const queryable = options.client ?? {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };

  const result = await queryable.query(
    `insert into vehicle_availability_rules (
       vehicle_id,
       advance_notice_hours,
       buffer_before_minutes,
       buffer_after_minutes,
       allowed_pickup_start_hour,
       allowed_pickup_end_hour,
       allowed_dropoff_start_hour,
       allowed_dropoff_end_hour,
       is_active
     )
     values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (vehicle_id)
     do update set
       advance_notice_hours = excluded.advance_notice_hours,
       buffer_before_minutes = excluded.buffer_before_minutes,
       buffer_after_minutes = excluded.buffer_after_minutes,
       allowed_pickup_start_hour = excluded.allowed_pickup_start_hour,
       allowed_pickup_end_hour = excluded.allowed_pickup_end_hour,
       allowed_dropoff_start_hour = excluded.allowed_dropoff_start_hour,
       allowed_dropoff_end_hour = excluded.allowed_dropoff_end_hour,
       is_active = excluded.is_active,
       updated_at = now()
     returning
       id,
       vehicle_id,
       advance_notice_hours,
       buffer_before_minutes,
       buffer_after_minutes,
       allowed_pickup_start_hour,
       allowed_pickup_end_hour,
       allowed_dropoff_start_hour,
       allowed_dropoff_end_hour,
       is_active,
       created_at,
       updated_at`,
    [
      vehicleId,
      rules.advanceNoticeHours,
      rules.bufferBeforeMinutes,
      rules.bufferAfterMinutes,
      rules.allowedPickupStartHour,
      rules.allowedPickupEndHour,
      rules.allowedDropoffStartHour,
      rules.allowedDropoffEndHour,
      rules.isActive,
    ],
  );

  return normalizeRulesRow((result.rows[0] ?? defaultRulesForVehicle(vehicleId)) as VehicleAvailabilityRulesRow);
}

export function evaluateVehicleAvailabilityRules(input: {
  rules: VehicleAvailabilityRules;
  startAt: string | Date;
  endAt: string | Date;
  now?: Date;
}): AvailabilityRuleEvaluation {
  const startAtIso = toIso(input.startAt);
  const endAtIso = toIso(input.endAt);
  if (!startAtIso || !endAtIso) {
    return {
      ok: false,
      reasons: ["Invalid rental window."],
      normalized: null,
    };
  }

  const start = new Date(startAtIso);
  const end = new Date(endAtIso);
  if (end <= start) {
    return {
      ok: false,
      reasons: ["Return date/time must be later than pickup date/time."],
      normalized: null,
    };
  }

  const normalized = applyBufferWindow(startAtIso, endAtIso, input.rules);
  if (!input.rules.isActive) {
    return { ok: true, reasons: [], normalized };
  }

  const reasons: string[] = [];
  if (input.rules.advanceNoticeHours > 0) {
    const now = input.now ? new Date(input.now) : new Date();
    const minStart = new Date(now.getTime() + input.rules.advanceNoticeHours * 60 * 60 * 1000);
    if (start < minStart) {
      reasons.push(
        `Pickup must be at least ${input.rules.advanceNoticeHours} hour(s) from now for this vehicle.`,
      );
    }
  }

  const pickupHour = start.getUTCHours();
  if (
    hourOutsideRange(
      pickupHour,
      input.rules.allowedPickupStartHour,
      input.rules.allowedPickupEndHour,
    )
  ) {
    reasons.push(
      `Pickup time must be ${formatHourRange(
        input.rules.allowedPickupStartHour,
        input.rules.allowedPickupEndHour,
      )}.`,
    );
  }

  const dropoffHour = end.getUTCHours();
  if (
    hourOutsideRange(
      dropoffHour,
      input.rules.allowedDropoffStartHour,
      input.rules.allowedDropoffEndHour,
    )
  ) {
    reasons.push(
      `Dropoff time must be ${formatHourRange(
        input.rules.allowedDropoffStartHour,
        input.rules.allowedDropoffEndHour,
      )}.`,
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    normalized,
  };
}

export async function isVehicleUnavailableWithAvailabilityRules(
  input: {
    vehicleId: string;
    startAt: string | Date;
    endAt: string | Date;
  },
  options: AvailabilityCheckOptions = {},
): Promise<VehicleAvailabilityCheckResult> {
  const checker: AvailabilityConflictChecker = isVehicleUnavailableEntitlementBased;
  const rulesResult = options.rulesOverride
    ? { rules: options.rulesOverride, defaultsApplied: false }
    : await getVehicleAvailabilityRules(input.vehicleId, { client: options.client });

  const evaluation = evaluateVehicleAvailabilityRules({
    rules: rulesResult.rules,
    startAt: input.startAt,
    endAt: input.endAt,
    now: options.now,
  });

  if (!evaluation.ok || !evaluation.normalized) {
    return {
      unavailable: true,
      reasons: evaluation.reasons.length > 0 ? evaluation.reasons : ["Vehicle unavailable."],
      rules: rulesResult.rules,
      defaultsApplied: rulesResult.defaultsApplied,
      normalized: evaluation.normalized,
    };
  }

  const unavailable = await checker(
    input.vehicleId,
    {
      startAt: evaluation.normalized.effectiveStartAt,
      endAt: evaluation.normalized.effectiveEndAt,
    },
    {
      client: options.client,
      includeBlockouts: options.includeBlockouts,
      excludeBookingId: options.excludeBookingId ?? null,
    },
  );

  return {
    unavailable,
    reasons: unavailable
      ? [
          "Vehicle unavailable for the selected rental window (including booking/blockout buffer).",
        ]
      : [],
    rules: rulesResult.rules,
    defaultsApplied: rulesResult.defaultsApplied,
    normalized: evaluation.normalized,
  };
}

export async function listAvailableVehiclesWithAvailabilityRules<T extends { id: string }>(
  vehicles: T[],
  window: {
    startAt: string | Date;
    endAt: string | Date;
  },
  options: {
    client?: Queryable;
    includeBlockouts?: boolean;
    now?: Date;
  } = {},
): Promise<T[]> {
  if (vehicles.length === 0) return [];

  const rulesMap = await getVehicleAvailabilityRulesMap(
    vehicles.map((vehicle) => vehicle.id),
    { client: options.client },
  );

  const checks = await Promise.all(
    vehicles.map(async (vehicle) => {
      const resolved = rulesMap.get(vehicle.id);
      const rules = resolved?.rules ?? defaultRulesForVehicle(vehicle.id);
      const evaluation = evaluateVehicleAvailabilityRules({
        rules,
        startAt: window.startAt,
        endAt: window.endAt,
        now: options.now,
      });
      if (!evaluation.ok || !evaluation.normalized) return false;

      const unavailable = await isVehicleUnavailableEntitlementBased(
        vehicle.id,
        {
          startAt: evaluation.normalized.effectiveStartAt,
          endAt: evaluation.normalized.effectiveEndAt,
        },
        {
          client: options.client,
          includeBlockouts: options.includeBlockouts,
        },
      );
      return !unavailable;
    }),
  );

  return vehicles.filter((_, index) => checks[index]);
}
