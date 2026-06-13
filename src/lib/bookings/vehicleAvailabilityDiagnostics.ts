import {
  findVehicleAvailabilityConflict,
  type VehicleAvailabilityConflict,
} from "@/lib/availability/entitlement";
import {
  evaluateVehicleAvailabilityRules,
  getVehicleAvailabilityRulesMap,
} from "@/lib/bookings/availabilityRules";
import type { Queryable } from "@/lib/payments/pricing";

export type VehicleAvailabilityReasonCode =
  | "AVAILABLE"
  | "BOOKING_CONFLICT"
  | "BLOCKOUT_CONFLICT"
  | "MAINTENANCE_BLOCKOUT"
  | "ADVANCE_NOTICE"
  | "PICKUP_HOURS"
  | "DROPOFF_HOURS"
  | "AVAILABILITY_RULE"
  | "PRIVATE"
  | "INACTIVE"
  | "UNAVAILABLE"
  | "MAINTENANCE"
  | "INVALID_PRICING"
  | "INCOMPLETE_CONFIGURATION";

export type AvailabilityDiagnosticVehicle = {
  id: string;
  publicId?: string | null;
  make: string;
  model: string;
  year?: number | null;
  status?: string | null;
  derivedStatus?: string | null;
  publicVisible?: boolean;
  dailyRateCents?: number | null;
  deletedAt?: string | null;
};

export type VehicleAvailabilityDecision<T extends AvailabilityDiagnosticVehicle> = {
  vehicle: T;
  available: boolean;
  publicEligible: boolean;
  reasonCode: VehicleAvailabilityReasonCode;
  reason: string;
  conflict: VehicleAvailabilityConflict | null;
  normalized: {
    startAt: string;
    endAt: string;
    effectiveStartAt: string;
    effectiveEndAt: string;
  } | null;
};

type DecisionOptions = {
  client?: Queryable;
  includeBlockouts?: boolean;
  now?: Date;
  publicEligibility?: boolean;
};

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function ruleReasonCode(reason: string): VehicleAvailabilityReasonCode {
  const normalized = reason.toLowerCase();
  if (normalized.includes("at least") && normalized.includes("hour")) return "ADVANCE_NOTICE";
  if (normalized.includes("pickup time")) return "PICKUP_HOURS";
  if (normalized.includes("dropoff time")) return "DROPOFF_HOURS";
  return "AVAILABILITY_RULE";
}

function eligibilityFailure<T extends AvailabilityDiagnosticVehicle>(
  vehicle: T,
): Pick<VehicleAvailabilityDecision<T>, "reasonCode" | "reason"> | null {
  if (vehicle.deletedAt) {
    return { reasonCode: "INACTIVE", reason: "Vehicle is archived." };
  }
  const status = normalizeStatus(vehicle.status);
  if (status === "INACTIVE") return { reasonCode: "INACTIVE", reason: "Vehicle is inactive." };
  if (status === "UNAVAILABLE") {
    return { reasonCode: "UNAVAILABLE", reason: "Vehicle is manually unavailable." };
  }
  if (status === "MAINTENANCE") {
    return { reasonCode: "MAINTENANCE", reason: "Vehicle is marked for maintenance." };
  }
  if (vehicle.publicVisible === false) {
    return { reasonCode: "PRIVATE", reason: "Vehicle visibility is private." };
  }
  if (!Number.isFinite(Number(vehicle.dailyRateCents)) || Number(vehicle.dailyRateCents) <= 0) {
    return { reasonCode: "INVALID_PRICING", reason: "Vehicle has no valid daily rate." };
  }
  if (!vehicle.make.trim() || !vehicle.model.trim()) {
    return {
      reasonCode: "INCOMPLETE_CONFIGURATION",
      reason: "Vehicle make or model is incomplete.",
    };
  }
  return null;
}

export async function evaluateVehicleAvailability<T extends AvailabilityDiagnosticVehicle>(
  vehicles: T[],
  window: { startAt: string | Date; endAt: string | Date },
  options: DecisionOptions = {},
): Promise<Array<VehicleAvailabilityDecision<T>>> {
  const rulesMap = await getVehicleAvailabilityRulesMap(
    vehicles.map((vehicle) => vehicle.id),
    { client: options.client },
  );

  return Promise.all(
    vehicles.map(async (vehicle) => {
      const eligibility = options.publicEligibility === false ? null : eligibilityFailure(vehicle);
      if (eligibility) {
        return {
          vehicle,
          available: false,
          publicEligible: false,
          ...eligibility,
          conflict: null,
          normalized: null,
        };
      }

      const rules = rulesMap.get(vehicle.id)?.rules;
      if (!rules) {
        return {
          vehicle,
          available: false,
          publicEligible: true,
          reasonCode: "AVAILABILITY_RULE" as const,
          reason: "Availability rules could not be resolved.",
          conflict: null,
          normalized: null,
        };
      }

      const ruleEvaluation = evaluateVehicleAvailabilityRules({
        rules,
        startAt: window.startAt,
        endAt: window.endAt,
        now: options.now,
      });
      if (!ruleEvaluation.ok || !ruleEvaluation.normalized) {
        const reason = ruleEvaluation.reasons[0] ?? "Vehicle availability rules rejected this window.";
        return {
          vehicle,
          available: false,
          publicEligible: true,
          reasonCode: ruleReasonCode(reason),
          reason,
          conflict: null,
          normalized: ruleEvaluation.normalized,
        };
      }

      const conflict = await findVehicleAvailabilityConflict(
        vehicle.id,
        {
          startAt: ruleEvaluation.normalized.effectiveStartAt,
          endAt: ruleEvaluation.normalized.effectiveEndAt,
        },
        {
          client: options.client,
          includeBlockouts: options.includeBlockouts,
        },
      );
      if (conflict?.type === "BOOKING") {
        return {
          vehicle,
          available: false,
          publicEligible: true,
          reasonCode: "BOOKING_CONFLICT" as const,
          reason: `Overlaps booking ${conflict.publicId ?? conflict.id.slice(0, 8)}.`,
          conflict,
          normalized: ruleEvaluation.normalized,
        };
      }
      if (conflict?.type === "BLOCKOUT") {
        const maintenance = conflict.source === "MAINTENANCE" || Boolean(conflict.maintenanceRecordId);
        return {
          vehicle,
          available: false,
          publicEligible: true,
          reasonCode: maintenance ? ("MAINTENANCE_BLOCKOUT" as const) : ("BLOCKOUT_CONFLICT" as const),
          reason: maintenance
            ? `Unavailable for maintenance: ${conflict.reason}.`
            : `Blocked out: ${conflict.reason}.`,
          conflict,
          normalized: ruleEvaluation.normalized,
        };
      }

      return {
        vehicle,
        available: true,
        publicEligible: true,
        reasonCode: "AVAILABLE" as const,
        reason: "Available for the selected rental window.",
        conflict: null,
        normalized: ruleEvaluation.normalized,
      };
    }),
  );
}
