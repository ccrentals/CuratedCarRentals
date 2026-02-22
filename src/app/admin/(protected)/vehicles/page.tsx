import Link from "next/link";

import { AdminVehicleForm } from "@/components/admin/AdminVehicleForm";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { SlideDownPanel } from "@/components/admin/SlideDownPanel";
import { VehiclesFilters } from "@/components/admin/VehiclesFilters";
import { dbQuery } from "@/lib/db";
import { formatJmd } from "@/lib/money";
import { LoadMorePaginationControls } from "@/components/admin/LoadMorePaginationControls";
import { normalizePageSize, parsePositiveIntParam } from "@/lib/pagination/sharedPagination";

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  deposit_cents: number;
  status: string;
  created_at: string;
};

export default async function AdminVehiclesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const rowsPerPage = normalizePageSize(typeof params.rows === "string" ? params.rows : undefined);
  const requestedVisible = parsePositiveIntParam(params.visible);

  const whereSql = q
    ? "where make ilike $1 or model ilike $1 or id::text ilike $1 or cast(year as text) ilike $1"
    : "";
  const values = q ? [`${q}%`] : [];

  const vehicles = await dbQuery<VehicleRow>(
    `select id, make, model, year, daily_rate_cents, deposit_cents, status, created_at from vehicles ${whereSql} order by created_at desc`,
    values,
  );
  const visibleCount = Math.max(rowsPerPage, requestedVisible ?? rowsPerPage);
  const visibleVehicles = vehicles.rows.slice(0, visibleCount);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
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

      <VehiclesFilters initialQuery={q} />

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {vehicles.rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            No vehicles found.
          </div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Daily Rate</th>
                <th className="px-4 py-3">Deposit</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {visibleVehicles.map((vehicle: VehicleRow) => (
                <tr key={vehicle.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                  <td className="px-4 py-3 text-[var(--ccr-text)]">
                    <Link
                      href={`/admin/vehicles/${vehicle.id}`}
                      className="font-semibold text-[var(--ccr-text)]"
                    >
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">
                    {formatJmd(vehicle.daily_rate_cents)}
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">
                    {formatJmd(vehicle.deposit_cents)}
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">{vehicle.status}</td>
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">
                    <TableDateTime value={vehicle.created_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {vehicles.rows.length > 0 ? (
          <LoadMorePaginationControls
            pageSize={rowsPerPage}
            loadedCount={visibleVehicles.length}
            totalCount={vehicles.rows.length}
            noMoreLabel="No more vehicles"
          />
        ) : null}
      </div>
    </div>
  );
}
