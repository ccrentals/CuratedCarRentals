import Link from "next/link";

import { VehicleBlockouts } from "@/components/admin/VehicleBlockouts";
import { VehicleDetailForm } from "@/components/admin/VehicleDetailForm";
import { dbQuery } from "@/lib/db";

type VehicleDetail = {
  id: string;
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  status: string;
};

export default async function AdminVehicleDetailPage({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  const vehicleResult = await dbQuery<VehicleDetail>(
    "select id, make, model, year, daily_rate_cents, status from vehicles where id = $1",
    [vehicleId],
  );

  const vehicle = vehicleResult.rows[0];
  if (!vehicle) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <Link href="/admin/vehicles" className="text-sm font-semibold text-[var(--ccr-primary)]">
          Back to vehicles
        </Link>
        <p className="mt-4 text-sm text-[var(--ccr-muted)]">Vehicle not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <Link href="/admin/vehicles" className="text-sm font-semibold text-[var(--ccr-primary)]">
        Back to vehicles
      </Link>

      <div className="mt-4 grid gap-6">
        <VehicleDetailForm vehicle={vehicle} />
        <VehicleBlockouts vehicle={{ id: vehicle.id, make: vehicle.make, model: vehicle.model }} />
      </div>
    </div>
  );
}
