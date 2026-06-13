import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { bookingDateTimeToUtcIso } from "@/lib/bookings/bookingDateTime";
import {
  evaluateVehicleAvailability,
  type AvailabilityDiagnosticVehicle,
  type VehicleAvailabilityDecision,
} from "@/lib/bookings/vehicleAvailabilityDiagnostics";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import {
  hydrateVehiclesWithDerivedStatus,
  type AdminFleetVehicleRow,
} from "@/lib/vehicles/adminFleetSnapshot";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

type DiagnosticVehicleRow = AdminFleetVehicleRow & {
  public_visible: boolean;
};

export type AvailabilityDiagnosticsRouteDeps = {
  authorize: () => Promise<Response | null>;
  loadVehicles: () => Promise<Array<AvailabilityDiagnosticVehicle>>;
  evaluate: (
    vehicles: AvailabilityDiagnosticVehicle[],
    window: { startAt: string; endAt: string },
  ) => Promise<Array<VehicleAvailabilityDecision<AvailabilityDiagnosticVehicle>>>;
};

function normalizeDate(value: string | null) {
  const normalized = String(value ?? "").trim();
  return DATE_ONLY_REGEX.test(normalized) ? normalized : null;
}

function normalizeTime(value: string | null) {
  const normalized = String(value ?? "").trim();
  return TIME_ONLY_REGEX.test(normalized) ? normalized : null;
}

function conflictLink(decision: VehicleAvailabilityDecision<AvailabilityDiagnosticVehicle>) {
  const conflict = decision.conflict;
  if (!conflict) return null;
  if (conflict.type === "BOOKING") return `/admin/bookings/${conflict.id}`;
  if (conflict.maintenanceRecordId) {
    return `/admin/vehicles/${decision.vehicle.id}?tab=maintenance&recordId=${conflict.maintenanceRecordId}`;
  }
  return `/admin/vehicles/${decision.vehicle.id}?tab=blockouts`;
}

const DEFAULT_DEPS: AvailabilityDiagnosticsRouteDeps = {
  authorize: async () => {
    const auth = await requireOperationsAccess();
    return auth.ok ? null : auth.response;
  },
  loadVehicles: async () => {
    const result = await dbQuery<DiagnosticVehicleRow>(
      `select
         v.id,
         v.public_id,
         v.make,
         v.model,
         v.year,
         v.daily_rate_cents,
         v.deposit_cents,
         v.status,
         coalesce((to_jsonb(p)->>'needs_cleaning')::boolean, false) as needs_cleaning,
         lower(coalesce(v.features_json->>'public_visible', 'false')) in ('true','1','yes') as public_visible,
         v.created_at,
         v.updated_at,
         v.deleted_at
       from vehicles v
       left join vehicle_profiles p on p.vehicle_id = v.id
       where v.deleted_at is null
       order by v.created_at desc, v.id desc`,
    );
    const hydrated = await hydrateVehiclesWithDerivedStatus<DiagnosticVehicleRow>(result.rows);
    return hydrated.map((vehicle) => ({
      id: vehicle.id,
      publicId: vehicle.public_id,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      status: vehicle.status,
      derivedStatus: vehicle.derived_status,
      publicVisible: vehicle.public_visible,
      dailyRateCents: vehicle.daily_rate_cents,
      deletedAt: vehicle.deleted_at,
    }));
  },
  evaluate: (vehicles, window) =>
    evaluateVehicleAvailability(vehicles, window, {
      includeBlockouts: true,
      publicEligibility: true,
    }),
};

export async function handleAvailabilityDiagnosticsGet(
  request: Request,
  deps: AvailabilityDiagnosticsRouteDeps = DEFAULT_DEPS,
) {
  const authError = await deps.authorize();
  if (authError) return authError;

  const params = new URL(request.url).searchParams;
  const pickupDate = normalizeDate(params.get("pickupDate"));
  const pickupTime = normalizeTime(params.get("pickupTime"));
  const dropoffDate = normalizeDate(params.get("dropoffDate"));
  const dropoffTime = normalizeTime(params.get("dropoffTime"));
  if (!pickupDate || !pickupTime || !dropoffDate || !dropoffTime) {
    return NextResponse.json(
      { ok: false, error: "Valid pickup and drop-off dates and times are required." },
      { status: 400 },
    );
  }

  const startAt = bookingDateTimeToUtcIso(pickupDate, pickupTime);
  const endAt = bookingDateTimeToUtcIso(dropoffDate, dropoffTime);
  if (!startAt || !endAt || endAt <= startAt) {
    return NextResponse.json(
      { ok: false, error: "Drop-off must be later than pickup." },
      { status: 400 },
    );
  }

  try {
    const decisions = await deps.evaluate(await deps.loadVehicles(), { startAt, endAt });
    return NextResponse.json({
      ok: true,
      window: { pickupDate, pickupTime, dropoffDate, dropoffTime, startAt, endAt },
      rows: decisions.map((decision) => ({
        vehicle: decision.vehicle,
        available: decision.available,
        publicEligible: decision.publicEligible,
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        conflict: decision.conflict,
        conflictLink: conflictLink(decision),
        vehicleLink: `/admin/vehicles/${decision.vehicle.id}`,
      })),
    });
  } catch (error) {
    logError("api.admin.vehicles.availability-diagnostics.GET", error);
    return NextResponse.json(
      { ok: false, error: "Failed to evaluate vehicle availability." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleAvailabilityDiagnosticsGet(request);
}
