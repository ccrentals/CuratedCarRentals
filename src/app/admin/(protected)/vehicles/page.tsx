import Link from "next/link";

import { AdminVehicleForm } from "@/components/admin/AdminVehicleForm";
import { VehicleAvailabilityChecker } from "@/components/admin/VehicleAvailabilityChecker";
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
import { canAccessAdmin } from "@/lib/auth/roles";
import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { formatJmd } from "@/lib/money";
import { LoadMorePaginationControls } from "@/components/admin/LoadMorePaginationControls";
import { RestoreVehicleButton } from "@/components/admin/RestoreVehicleButton";
import { normalizePageSize, parsePositiveIntParam } from "@/lib/pagination/sharedPagination";
import {
  matchesVehicleFilter,
  normalizeVehicleFilter,
  normalizeVehicleSort,
  vehicleDerivedStatusLabel,
  vehicleFilterWhereSql,
  vehicleListOrderBySql,
  vehicleStatusSortRank,
  type VehicleSortBy,
} from "@/lib/vehicles/adminVehicles";
import {
  hydrateVehiclesWithDerivedStatus,
  type ActiveFleetVehicleSnapshot,
  type AdminFleetVehicleRow,
} from "@/lib/vehicles/adminFleetSnapshot";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";
import { type DerivedVehicleStatus } from "@/lib/vehicles/vehicleStatus";

type VehicleWithDerivedStatus = ActiveFleetVehicleSnapshot;

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
  const session = await getSessionFromRequest();
  if (!canAccessAdmin(session?.role)) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Vehicles</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") queryParams.set(key, value);
  }

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const fleetFilter = normalizeVehicleFilter(params.fleet);
  const includeDeleted = typeof params.includeDeleted === "string" && params.includeDeleted === "1";
  const deletedNotice = typeof params.deleted === "string" && params.deleted === "1";
  const restoredNotice = typeof params.restored === "string" && params.restored === "1";
  const sort = normalizeVehicleSort(queryParams);
  const rowsPerPage = normalizePageSize(typeof params.rows === "string" ? params.rows : undefined);
  const requestedVisible = parsePositiveIntParam(params.visible);
  const visibleCount = Math.max(rowsPerPage, requestedVisible ?? rowsPerPage);
  const now = new Date();
  const canUseSqlPagination = fleetFilter === "all" && sort.sortBy !== "status";

  const { whereSql, values } = vehicleFilterWhereSql(fleetFilter, q);
  const deletedFilterSql = includeDeleted ? "v.deleted_at is not null" : "v.deleted_at is null";
  const combinedWhereSql = whereSql
    ? `${whereSql} and ${deletedFilterSql}`
    : `where ${deletedFilterSql}`;

  let vehicleRows: AdminFleetVehicleRow[] = [];
  let totalVehicles = 0;
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
       ${combinedWhereSql}
       ${canUseSqlPagination ? `${vehicleListOrderBySql(sort)} limit $${values.length + 1}` : "order by v.created_at desc, v.id::text desc"}`,
      canUseSqlPagination ? [...values, visibleCount] : values,
    );
    vehicleRows = vehicles.rows;
    if (canUseSqlPagination) {
      const countResult = await dbQuery<{ total: number }>(
        `select count(*)::int as total
         from vehicles v
         left join vehicle_profiles p on p.vehicle_id = v.id
         ${combinedWhereSql}`,
        values,
      );
      totalVehicles = Number(countResult.rows[0]?.total ?? 0);
    }
  } catch (error) {
    if (!isVehicleExtensionsMissingTableError(error)) {
      throw error;
    }

    const fallback = vehicleFilterWhereSql(fleetFilter, q, { includeProfileSearch: false });
    const fallbackCombinedWhereSql = fallback.whereSql
      ? `${fallback.whereSql} and ${deletedFilterSql}`
      : `where ${deletedFilterSql}`;
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
       ${fallbackCombinedWhereSql}
       ${canUseSqlPagination ? `${vehicleListOrderBySql(sort)} limit $${fallback.values.length + 1}` : "order by v.created_at desc, v.id::text desc"}`,
      canUseSqlPagination ? [...fallback.values, visibleCount] : fallback.values,
    );
    vehicleRows = vehicles.rows;
    if (canUseSqlPagination) {
      const countResult = await dbQuery<{ total: number }>(
        `select count(*)::int as total
         from vehicles v
         ${fallbackCombinedWhereSql}`,
        fallback.values,
      );
      totalVehicles = Number(countResult.rows[0]?.total ?? 0);
    }
  }

  const derivedRows = await hydrateVehiclesWithDerivedStatus(vehicleRows, now);

  let visibleVehicles: VehicleWithDerivedStatus[] = [];
  if (canUseSqlPagination) {
    visibleVehicles = derivedRows;
  } else {
    const filteredRows = derivedRows.filter((vehicle) =>
      matchesVehicleFilter(fleetFilter, vehicle.derived_status),
    );
    const sortedRows = sortVehicles(filteredRows, sort);
    visibleVehicles = sortedRows.slice(0, visibleCount);
    totalVehicles = sortedRows.length;
  }

  const sortHref = (columnKey: VehicleSortBy, defaultDirection: SortDir) => {
    const next = nextSort(sort, columnKey, defaultDirection);
    const nextParams = applySortToSearchParams(queryParams, next);
    const nextQuery = nextParams.toString();
    return nextQuery ? `/admin/vehicles?${nextQuery}` : "/admin/vehicles";
  };

  const viewHref = (showArchived: boolean) => {
    const nextParams = new URLSearchParams(queryParams.toString());
    if (showArchived) {
      nextParams.set("includeDeleted", "1");
    } else {
      nextParams.delete("includeDeleted");
    }
    nextParams.delete("deleted");
    nextParams.delete("restored");
    nextParams.delete("restoreError");
    nextParams.delete("visible");
    const nextQuery = nextParams.toString();
    return nextQuery ? `/admin/vehicles?${nextQuery}` : "/admin/vehicles";
  };

  const restoreReturnTo = (() => {
    const nextParams = new URLSearchParams(queryParams.toString());
    nextParams.set("includeDeleted", "1");
    nextParams.delete("deleted");
    nextParams.delete("restoreError");
    nextParams.set("restored", "1");
    const nextQuery = nextParams.toString();
    return nextQuery ? `/admin/vehicles?${nextQuery}` : "/admin/vehicles?includeDeleted=1&restored=1";
  })();

  const statusPillTone = (status: DerivedVehicleStatus) => {
    if (status === "AVAILABLE") {
      return "border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]";
    }
    if (status === "UPCOMING") {
      return "border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
    }
    if (status === "ON_RENT") {
      return "border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
    }
    if (status === "DIRTY") {
      return "border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] text-[var(--ccr-status-warning-text)]";
    }
    return "border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]";
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Vehicles</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={viewHref(false)}
          data-testid="vehicles-view-active"
          className={`inline-flex min-h-10 items-center rounded-full border px-4 py-2 text-xs font-semibold ${
            includeDeleted
              ? "border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-text)]"
              : "border-[var(--ccr-primary)] bg-[var(--ccr-primary)] text-white"
          }`}
        >
          Active
        </Link>
        <Link
          href={viewHref(true)}
          data-testid="vehicles-view-archived"
          className={`inline-flex min-h-10 items-center rounded-full border px-4 py-2 text-xs font-semibold ${
            includeDeleted
              ? "border-[var(--ccr-primary)] bg-[var(--ccr-primary)] text-white"
              : "border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-text)]"
          }`}
        >
          Archived
        </Link>
      </div>
      {deletedNotice ? (
        <p className="mt-3 rounded-xl border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] px-4 py-3 text-sm text-[var(--ccr-status-success-text)]">
          Vehicle archived successfully.
        </p>
      ) : null}
      {restoredNotice ? (
        <p className="mt-3 rounded-xl border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] px-4 py-3 text-sm text-[var(--ccr-status-success-text)]">
          Vehicle restored successfully.
        </p>
      ) : null}

      <div className="mt-6">
        <SlideDownPanel
          title="Add Vehicle"
          description="Create a vehicle record for the fleet."
          defaultOpen={false}
        >
          <AdminVehicleForm />
        </SlideDownPanel>
      </div>

      {!includeDeleted ? (
        <VehicleAvailabilityChecker
          initialPickupDate={typeof params.pickupDate === "string" ? params.pickupDate : undefined}
          initialPickupTime={typeof params.pickupTime === "string" ? params.pickupTime : undefined}
          initialDropoffDate={typeof params.dropoffDate === "string" ? params.dropoffDate : undefined}
          initialDropoffTime={typeof params.dropoffTime === "string" ? params.dropoffTime : undefined}
        />
      ) : null}

      <VehiclesFilters
        initialQuery={q}
        initialFilter={fleetFilter}
        initialSort={sort}
        includeDeleted={includeDeleted}
      />

      <div
        data-testid="vehicles-list"
        className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
      >
        {totalVehicles === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            {includeDeleted ? "No archived vehicles found." : "No vehicles found."}
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
                      <Link
                        href={`/admin/vehicles/${vehicle.id}`}
                        data-testid="vehicle-public-id"
                        className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                        title="Open vehicle"
                      >
                        {vehicle.public_id}
                      </Link>
                      <p className="font-semibold text-[var(--ccr-text)]">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </p>
                      <p className="text-xs text-[var(--ccr-muted)]">
                        Created: <DateTimeInline value={vehicle.created_at} />
                      </p>
                    </div>
                    <span
                      className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold leading-none ${
                        includeDeleted
                          ? "border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]"
                          : statusPillTone(vehicle.derived_status)
                      }`}
                    >
                      {includeDeleted ? "Archived" : vehicleDerivedStatusLabel(vehicle.derived_status)}
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
                    {includeDeleted ? (
                      <RestoreVehicleButton vehicleId={vehicle.id} returnTo={restoreReturnTo} />
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                  <tr>
                    <th className="px-4 py-3">Vehicle ID</th>
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
                    {includeDeleted ? <th className="px-4 py-3 text-right">Actions</th> : null}
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
                        <Link
                          href={`/admin/vehicles/${vehicle.id}`}
                          data-testid="vehicle-public-id"
                          className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                          title="Open vehicle"
                        >
                          {vehicle.public_id}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        <Link href={`/admin/vehicles/${vehicle.id}`} className="font-semibold text-[var(--ccr-text)]">
                          <span
                            className="sr-only"
                          >
                            {vehicle.public_id}
                          </span>
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
                            className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold leading-none ${
                              includeDeleted
                                ? "border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]"
                                : statusPillTone(vehicle.derived_status)
                            }`}
                          >
                            {includeDeleted ? "Archived" : vehicleDerivedStatusLabel(vehicle.derived_status)}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-muted)]">
                        <Link href={`/admin/vehicles/${vehicle.id}`} className="inline-flex">
                          <TableDateTime value={vehicle.created_at} />
                        </Link>
                      </td>
                      {includeDeleted ? (
                        <td className="px-4 py-3 text-right">
                          <RestoreVehicleButton vehicleId={vehicle.id} returnTo={restoreReturnTo} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {totalVehicles > 0 ? (
          <LoadMorePaginationControls
            pageSize={rowsPerPage}
            loadedCount={visibleVehicles.length}
            totalCount={totalVehicles}
            noMoreLabel="No more vehicles"
          />
        ) : null}
      </div>
    </div>
  );
}
