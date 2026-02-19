import Link from "next/link";
import Image from "next/image";

import { Container } from "@/components/site/Container";
import { Button } from "@/components/ui/Button";
import { formatJmd } from "@/lib/money";
import { getPublicVehicleByIdentifier } from "@/lib/publicVehicles";

export const dynamic = "force-dynamic";

export default async function FleetVehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const vehicle = await getPublicVehicleByIdentifier(id);

  if (!vehicle) {
    return (
      <div className="py-10 md:py-14">
        <Container>
          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
            <p className="text-sm text-[var(--ccr-muted)]">Vehicle not found.</p>
            <div className="mt-4">
              <Button href="/fleet" variant="secondary">
                Back to Fleet
              </Button>
            </div>
          </section>
        </Container>
      </div>
    );
  }

  return (
    <div className="py-10 md:py-14">
      <Container>
        <section className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm md:p-8">
          <Link href="/fleet" className="text-sm font-semibold text-[var(--ccr-muted)] hover:text-[var(--ccr-text)]">
            Back to Fleet
          </Link>

          <div className="mt-4 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <div className="overflow-hidden rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]">
              <Image
                src={vehicle.images[0] ?? "/window.svg"}
                alt={vehicle.name}
                width={1200}
                height={800}
                className="h-full w-full object-cover"
              />
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">{vehicle.category}</p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--ccr-text)]">
                {vehicle.name}
              </h1>
              <p className="mt-3 text-sm text-[var(--ccr-muted)]">{vehicle.description}</p>

              <div className="mt-5 grid grid-cols-2 gap-2 text-sm text-[var(--ccr-muted)] sm:grid-cols-3">
                <p>{vehicle.transmission}</p>
                <p>{vehicle.seats} Seats</p>
                <p>{vehicle.bags} Bags</p>
              </div>

              <p className="mt-6 text-lg font-semibold text-[var(--ccr-text)]">
                {formatJmd(vehicle.pricePerDay)}/day
              </p>

              <div className="mt-6">
                <Button href={`/book?vehicle=${vehicle.id}`}>Reserve This Car</Button>
              </div>
            </div>
          </div>
        </section>
      </Container>
    </div>
  );
}
