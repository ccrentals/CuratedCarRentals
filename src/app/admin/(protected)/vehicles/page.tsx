import Link from "next/link";

import { AdminVehicleForm } from "@/components/admin/AdminVehicleForm";
import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";

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

export default async function AdminVehiclesPage() {
  const vehicles = await dbQuery<VehicleRow>(
    "select id, make, model, year, daily_rate_cents, deposit_cents, status, created_at from vehicles order by created_at desc",
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Vehicles</h1>

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[var(--ccr-text)]">Add Vehicle</h2>
        <AdminVehicleForm />
      </section>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
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
            {vehicles.rows.map((vehicle: VehicleRow) => (
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
                  {fmtDate(vehicle.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
