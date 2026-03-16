import { dbQuery } from "@/lib/db";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";
import {
  deriveVehicleStatus,
  type DerivedVehicleStatus,
  type VehicleStatusBlockoutLike,
  type VehicleStatusBookingLike,
} from "@/lib/vehicles/vehicleStatus";

export type AdminFleetVehicleRow = {
  id: string;
  public_id: string;
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  deposit_cents: number;
  status: string;
  needs_cleaning: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type FleetVehicleBookingRow = VehicleStatusBookingLike & {
  vehicle_id: string;
};

type FleetVehicleBlockoutRow = VehicleStatusBlockoutLike & {
  vehicle_id: string;
};

export type ActiveFleetVehicleSnapshot = AdminFleetVehicleRow & {
  derived_status: DerivedVehicleStatus;
};

export type ActiveFleetSummary = {
  totalVehicles: number;
  availableVehicles: number;
  maintenanceVehicles: number;
  recentVehicles: ActiveFleetVehicleSnapshot[];
};

function isMissingTableError(error: unknown, tableName: string) {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  if (code !== "42P01") return false;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return message.includes(tableName.toLowerCase());
}

export async function hydrateVehiclesWithDerivedStatus<T extends AdminFleetVehicleRow>(
  vehicleRows: T[],
  now = new Date(),
): Promise<Array<T & { derived_status: DerivedVehicleStatus }>> {
  const vehicleIds = vehicleRows.map((row) => row.id);
  const bookingsByVehicleId = new Map<string, VehicleStatusBookingLike[]>();
  const blockoutsByVehicleId = new Map<string, VehicleStatusBlockoutLike[]>();

  if (vehicleIds.length > 0) {
    const bookingsResult = await dbQuery<FleetVehicleBookingRow>(
      `select
          b.id,
          b.vehicle_id,
          b.status,
          b.archived_at,
          b.start_at,
          b.start_date,
          b.end_at,
          b.end_date,
          b.pricing_json,
          v.deposit_cents as vehicle_deposit_cents
       from bookings b
       join vehicles v on v.id = b.vehicle_id
       where b.vehicle_id = any($1::uuid[])
         and coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day')) >= $2::timestamptz
       order by coalesce(b.start_at, b.start_date::timestamptz) asc`,
      [vehicleIds, now.toISOString()],
    );

    for (const booking of bookingsResult.rows) {
      const existing = bookingsByVehicleId.get(booking.vehicle_id);
      if (existing) {
        existing.push(booking);
      } else {
        bookingsByVehicleId.set(booking.vehicle_id, [booking]);
      }
    }

    try {
      const blockoutsResult = await dbQuery<FleetVehicleBlockoutRow>(
        `select vehicle_id, start_at, end_at
         from blockouts
         where vehicle_id = any($1::uuid[])
           and end_at > $2::timestamptz
         order by start_at asc`,
        [vehicleIds, now.toISOString()],
      );

      for (const blockout of blockoutsResult.rows) {
        const existing = blockoutsByVehicleId.get(blockout.vehicle_id);
        if (existing) {
          existing.push(blockout);
        } else {
          blockoutsByVehicleId.set(blockout.vehicle_id, [blockout]);
        }
      }
    } catch (error) {
      if (!isMissingTableError(error, "blockouts")) {
        throw error;
      }
    }
  }

  return vehicleRows.map((vehicle) => ({
    ...vehicle,
    derived_status: deriveVehicleStatus(vehicle, now, {
      bookings: bookingsByVehicleId.get(vehicle.id) ?? [],
      blockouts: blockoutsByVehicleId.get(vehicle.id) ?? [],
      needsCleaning: vehicle.needs_cleaning === true,
    }),
  }));
}

export async function fetchActiveFleetSnapshot(input?: {
  now?: Date;
}): Promise<ActiveFleetVehicleSnapshot[]> {
  const now = input?.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date();

  let vehicleRows: AdminFleetVehicleRow[] = [];
  try {
    const vehicles = await dbQuery<AdminFleetVehicleRow>(
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
          v.created_at,
          v.updated_at,
          v.deleted_at
       from vehicles v
       left join vehicle_profiles p on p.vehicle_id = v.id
       where v.deleted_at is null
       order by v.created_at desc, v.id::text desc`,
    );
    vehicleRows = vehicles.rows;
  } catch (error) {
    if (!isVehicleExtensionsMissingTableError(error)) {
      throw error;
    }

    const vehicles = await dbQuery<AdminFleetVehicleRow>(
      `select
          v.id,
          v.public_id,
          v.make,
          v.model,
          v.year,
          v.daily_rate_cents,
          v.deposit_cents,
          v.status,
          false as needs_cleaning,
          v.created_at,
          v.updated_at,
          v.deleted_at
       from vehicles v
       where v.deleted_at is null
       order by v.created_at desc, v.id::text desc`,
    );
    vehicleRows = vehicles.rows;
  }

  return hydrateVehiclesWithDerivedStatus(vehicleRows, now);
}

export function summarizeActiveFleetSnapshot(
  rows: ActiveFleetVehicleSnapshot[],
  recentLimit = 5,
): ActiveFleetSummary {
  const activeRows = rows.filter((row) => row.deleted_at == null);
  const recentVehicles = [...activeRows]
    .sort((left, right) => {
      const leftTime = new Date(left.created_at).getTime();
      const rightTime = new Date(right.created_at).getTime();
      if (leftTime !== rightTime) return rightTime - leftTime;
      return right.id.localeCompare(left.id);
    })
    .slice(0, Math.max(0, recentLimit));

  return {
    totalVehicles: activeRows.length,
    availableVehicles: activeRows.filter((row) => row.derived_status === "AVAILABLE").length,
    maintenanceVehicles: activeRows.filter((row) => row.derived_status === "DIRTY").length,
    recentVehicles,
  };
}
