import Link from "next/link";

import { VehicleCard } from "@/components/sections/VehicleCard";
import { Container } from "@/components/site/Container";
import { getPublicVehicles } from "@/lib/publicVehicles";

export const dynamic = "force-dynamic";

export default async function FleetPage() {
  const vehicles = await getPublicVehicles();

  return (
    <>
      <section className="border-b border-[var(--ccr-border)] bg-[#f7e0b0] py-4 text-center">
        <Container>
          <p className="text-sm font-medium text-[#4c3b16] md:text-base">
            Our Simple Pricing includes all fees and taxes - No Surprises!{" "}
            <span className="text-[#7a6230]">(*optional insurance is extra)</span>
          </p>
        </Container>
      </section>

      <section className="bg-[var(--ccr-surface-soft)]/65 py-14 md:py-20">
        <Container>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--ccr-text)] transition hover:text-[var(--ccr-accent-strong)]"
          >
            <span aria-hidden="true">←</span>
            <span>Back to home</span>
          </Link>

          <h1 className="mt-5 font-display text-4xl font-bold text-[var(--ccr-text)] md:text-5xl">
            Our Complete Fleet
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--ccr-muted)]">
            Browse our entire collection of premium vehicles available for your Jamaican adventure. From economic options to luxury rides, we have the perfect car for your needs.
          </p>
        </Container>
      </section>

      <section className="bg-white py-16 md:py-24">
        <Container>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {vehicles.length === 0 ? (
              <article className="rounded-[1.8rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm leading-7 text-[var(--ccr-muted)] shadow-[0_18px_56px_rgba(15,23,42,0.08)] xl:col-span-3">
                No vehicles are currently published. Add and publish vehicles from the Admin portal.
              </article>
            ) : (
              vehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} appearance="fleet" />)
            )}
          </div>
        </Container>
      </section>
    </>
  );
}
