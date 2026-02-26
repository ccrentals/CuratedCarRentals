import Link from "next/link";

import { AdminVehicleForm } from "@/components/admin/AdminVehicleForm";
import { SortableTh } from "@/components/admin/SortableTh";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { SlideDownPanel } from "@/components/admin/SlideDownPanel";
import { VehiclesFilters } from "@/components/admin/VehiclesFilters";
import {
  applySortToSearchParams,
  nextSort,
  type SortDir,
} from "@/components/admin/tableSort";
import { dbQuery } from "@/lib/db";
import { formatJmd } from "@/lib/money";
import { LoadMorePaginationControls } from "@/components/admin/LoadMorePaginationControls";
import { normalizePageSize, parsePositiveIntParam } from "@/lib/pagination/sharedPagination";
import {
  matchesVehicleFilter,
  normalizeVehicleFilter,
  normalizeVehicleSort,
  vehicleDerivedStatusLabel,
  vehicleFilterWhereSql,
  vehicleStatusSortRank,
  type VehicleSortBy,
} from "@/lib/vehicles/adminVehicles";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";
import {
  deriveVehicleStatus,
  type DerivedVehicleStatus,
  type VehicleStatusBlockoutLike,
  type VehicleStatusBookingLike,
} from "@/lib/vehicles/vehicleStatus";

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  deposit_cents: number;
  status: string;
  needs_cleaning: boolean;
  created_at: string;
};

type VehicleBookingRow = VehicleStatusBookingLike & {
  vehicle_id: string;
};

type VehicleBlockoutRow = VehicleStatusBlockoutLike & {
  vehicle_id: string;
};

type VehicleWithDerivedStatus = VehicleRow & {
  derived_status: DerivedVehicleStatus;
};

function isMissingTableError(error: unknown, tableName: string) {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  if (code !== "42P01") return false;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return message.includes(tableName.toLowerCase());
}

function sortVehicles(
  rows: VehicleWithDerivedStatus[],
  sort: { sortBy: VehicleSortBy; sortDir: SortDir },
) {
  const direction = sort.sortDir === "asc" ? 1 : -1;
  const textCompare = (left: string, right: string) =>
    left.localeCompare(right, undefined, { sensitivity: "base" });

  return [...rows].sort((left, right) => {
    let base = 0;

    if (sort.sortBy === "vehicle") {
      base =
        left.year - right.year ||
        textCompare(left.make, right.make) ||
        textCompare(left.model, right.model);
    } else if (sort.sortBy === "dailyRate") {
      base = left.daily_rate_cents - right.daily_rate_cents;
    } else if (sort.sortBy === "deposit") {
      base = left.deposit_cents - right.deposit_cents;
    } else if (sort.sortBy === "status") {
      base =
        vehicleStatusSortRank(left.derived_status) - vehicleStatusSortRank(right.derived_status) ||
        textCompare(
          vehicleDerivedStatusLabel(left.derived_status),
          vehicleDerivedStatusLabel(right.derived_status),
        );
    } else {
      base = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    }

    if (base !== 0) return base * direction;
    return left.id.localeCompare(right.id) * direction;
  });
}

export default async function AdminVehiclesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") queryParams.set(key, value);
  }

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const fleetFilter = normalizeVehicleFilter(params.fleet);
  const sort = normalizeVehicleSort(queryParams);
  const rowsPerPage = normalizePageSize(typeof params.rows === "string" ? params.rows : undefined);
  const requestedVisible = parsePositiveIntParam(params.visible);
  const visibleCount = Math.max(rowsPerPage, requestedVisible ?? rowsPerPage);
  const now = new Date();

  const { whereSql, values } = vehicleFilterWhereSql(fleetFilter, q);

  let vehicleRows: VehicleRow[] = [];
  try {
    const vehicles = await dbQuery<VehicleRow>(
      `select
          v.id,
          v.make,
          v.model,
          v.year,
          v.daily_rate_cents,
          v.deposit_cents,
          v.status,
          coalesce((to_jsonb(p)->>'needs_cleaning')::boolean, false) as needs_cleaning,
          v.created_at
       from vehicles v
       left join vehicle_profiles p on p.vehicle_id = v.id
       ${whereSql}
       order by v.created_at desc, v.id::text desc`,
      values,
    );
    vehicleRows = vehicles.rows;
  } catch (error) {
    if (!isVehicleExtensionsMissingTableError(error)) {
      throw error;
    }

    const fallback = vehicleFilterWhereSql(fleetFilter, q, { includeProfileSearch: false });
    const vehicles = await dbQuery<VehicleRow>(
      `select
          v.id,
          v.make,
          v.model,
          v.year,
          v.daily_rate_cents,
          v.deposit_cents,
          v.status,
          false as needs_cleaning,
          v.created_at
       from vehicles v
       ${fallback.whereSql}
       order by v.created_at desc, v.id::text desc`,
      fallback.values,
    );
    vehicleRows = vehicles.rows;
  }

  const vehicleIds = vehicleRows.map((row) => row.id);
  const bookingsByVehicleId = new Map<string, VehicleStatusBookingLike[]>();
  const blockoutsByVehicleId = new Map<string, VehicleStatusBlockoutLike[]>();

  if (vehicleIds.length > 0) {
    const bookingsResult = await dbQuery<VehicleBookingRow>(
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
      const blockoutsResult = await dbQuery<VehicleBlockoutRow>(
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

  const derivedRows = vehicleRows.map<VehicleWithDerivedStatus>((vehicle) => ({
    ...vehicle,
    derived_status: deriveVehicleStatus(vehicle, now, {
      bookings: bookingsByVehicleId.get(vehicle.id) ?? [],
      blockouts: blockoutsByVehicleId.get(vehicle.id) ?? [],
      needsCleaning: vehicle.needs_cleaning === true,
    }),
  }));

  const filteredRows = derivedRows.filter((vehicle) =>
    matchesVehicleFilter(fleetFilter, vehicle.derived_status),
  );
  const sortedRows = sortVehicles(filteredRows, sort);
  const visibleVehicles = sortedRows.slice(0, visibleCount);

  const sortHref = (columnKey: VehicleSortBy, defaultDirection: SortDir) => {
    const next = nextSort(sort, columnKey, defaultDirection);
    const nextParams = applySortToSearchParams(queryParams, next);
    const nextQuery = nextParams.toString();
    return nextQuery ? `/admin/vehicles?${nextQuery}` : "/admin/vehicles";
  };

  const statusPillTone = (status: DerivedVehicleStatus) => {
    if (status === "AVAILABLE") {
      return "border-emerald-300/40 bg-emerald-500/15 text-emerald-100";
    }
    if (status === "UPCOMING") {
      return "border-sky-300/35 bg-sky-500/15 text-sky-100";
    }
    if (status === "ON_RENT") {
      return "border-cyan-300/35 bg-cyan-500/15 text-cyan-100";
    }
    if (status === "DIRTY") {
      return "border-amber-300/40 bg-amber-500/15 text-amber-100";
    }
    return "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]";
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Vehicles</h1>

      <div className="mt-6">
        <SlideDownPanel
          title="Add Vehicle"
          description="Create a vehicle record for the fleet."
          defaultOpen={false}
        >
          <AdminVehicleForm />
        </SlideDownPanel>
      </div>

      <VehiclesFilters initialQuery={q} initialFilter={fleetFilter} initialSort={sort} />

      <div
        data-testid="vehicles-list"
        className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
      >
        {sortedRows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            No vehicles found.
          </div>
        ) : (
          <>
            <div className="divide-y divide-[var(--ccr-border)] md:hidden">
              {visibleVehicles.map((vehicle) => (
                <article
                  key={`mobile-${vehicle.id}`}
                  data-testid="vehicle-mobile-card"
                  className="space-y-3 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--ccr-text)]">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </p>
                      <p className="text-xs text-[var(--ccr-muted)]">
                        Created: <DateTimeInline value={vehicle.created_at} />
                      </p>
                    </div>
                    <span
                      className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold leading-none ${statusPillTone(
                        vehicle.derived_status,
                      )}`}
                    >
                      {vehicleDerivedStatusLabel(vehicle.derived_status)}
                    </span>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 text-xs text-[var(--ccr-muted)]">
                    <div>
                      <dt>Daily Rate</dt>
                      <dd className="text-sm font-semibold text-[var(--ccr-text)]">
                        {formatJmd(vehicle.daily_rate_cents)}
                      </dd>
                    </div>
                    <div>
                      <dt>Deposit</dt>
                      <dd className="text-sm font-semibold text-[var(--ccr-text)]">
                        {formatJmd(vehicle.deposit_cents)}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex gap-2">
                    <Link
                      href={`/admin/vehicles/${vehicle.id}`}
                      data-testid="vehicle-mobile-view"
                      className="inline-flex min-h-11 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                    >
                      View
                    </Link>
                    <Link
                      href={`/admin/calendar?vehicleId=${vehicle.id}`}
                      className="inline-flex min-h-11 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                    >
                      Calendar
                    </Link>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                  <tr>
                    <SortableTh
                      label="Vehicle"
                      columnKey="vehicle"
                      sort={sort}
                      href={sortHref("vehicle", "asc")}
                    />
                    <SortableTh
                      label="Daily Rate"
                      columnKey="dailyRate"
                      sort={sort}
                      href={sortHref("dailyRate", "asc")}
                    />
                    <SortableTh
                      label="Deposit"
                      columnKey="deposit"
                      sort={sort}
                      href={sortHref("deposit", "asc")}
                    />
                    <SortableTh
                      label="Status"
                      columnKey="status"
                      sort={sort}
                      href={sortHref("status", "asc")}
                    />
                    <SortableTh
                      label="Created"
                      columnKey="created"
                      sort={sort}
                      href={sortHref("created", "desc")}
                    />
                  </tr>
                </thead>
                <tbody>
                  {visibleVehicles.map((vehicle) => (
                    <tr
                      key={vehicle.id}
                      data-testid="vehicle-row"
                      data-vehicle-id={vehicle.id}
                      className="border-b border-[var(--ccr-border)] last:border-b-0"
                    >
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        <Link href={`/admin/vehicles/${vehicle.id}`} className="font-semibold text-[var(--ccr-text)]">
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        <Link href={`/admin/vehicles/${vehicle.id}`} className="block text-[var(--ccr-text)]">
                          {formatJmd(vehicle.daily_rate_cents)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        <Link href={`/admin/vehicles/${vehicle.id}`} className="block text-[var(--ccr-text)]">
                          {formatJmd(vehicle.deposit_cents)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-muted)]">
                        <Link href={`/admin/vehicles/${vehicle.id}`} className="inline-flex items-center">
                          <span
                            className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold leading-none ${statusPillTone(
                              vehicle.derived_status,
                            )}`}
                          >
                            {vehicleDerivedStatusLabel(vehicle.derived_status)}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-muted)]">
                        <Link href={`/admin/vehicles/${vehicle.id}`} className="inline-flex">
                          <TableDateTime value={vehicle.created_at} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {sortedRows.length > 0 ? (
          <LoadMorePaginationControls
            pageSize={rowsPerPage}
            loadedCount={visibleVehicles.length}
            totalCount={sortedRows.length}
            noMoreLabel="No more vehicles"
          />
        ) : null}
      </div>
    </div>
  );
}
