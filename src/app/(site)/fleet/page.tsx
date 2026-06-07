import Link from "next/link";

import { VehicleCard } from "@/components/sections/VehicleCard";
import { Container } from "@/components/site/Container";
import { getPublicVehicles } from "@/lib/publicVehicles";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = publicPageMetadata({
  title: "Rental Car Fleet in Kingston, Jamaica",
  description:
    "Browse Curated Car Rentals vehicles for Kingston and Jamaica travel, including daily rates, deposits, passenger capacity, and booking options.",
  path: "/fleet",
});

export default async function FleetPage() {
  const vehicles = await getPublicVehicles();

  return (
    <>
      <section className="border-b border-[var(--ccr-border)] bg-[#f7e0b0] py-3 text-center sm:py-4 min-[1160px]:pt-28">
        <Container>
          <p className="text-[13px] font-medium leading-6 text-[#4c3b16] sm:text-sm md:text-base">
            Our Simple Pricing includes all fees and taxes - No Surprises!{" "}
            <span className="text-[#7a6230]">(*optional insurance is extra)</span>
          </p>
        </Container>
      </section>

      <section className="bg-[var(--ccr-surface-soft)]/65 py-12 sm:py-14 md:py-20 min-[1160px]:pt-44">
        <Container>
          <div className="min-[1160px]:translate-y-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-medium text-[var(--ccr-text)] transition hover:text-[var(--ccr-accent-strong)]"
            >
              <span aria-hidden="true">←</span>
              <span>Back to home</span>
            </Link>

            <h1 className="mt-4 font-display text-[2.15rem] font-bold leading-tight text-[var(--ccr-text)] sm:mt-5 sm:text-[2.55rem] md:text-5xl">
              Our Complete Fleet
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--ccr-muted)] sm:text-lg sm:leading-8">
              Browse our entire collection of premium vehicles available for your Jamaican adventure. From economic options to luxury rides, we have the perfect car for your needs.
            </p>
          </div>
        </Container>
      </section>

      <section className="bg-white py-12 sm:py-14 md:py-24">
        <Container>
          <div className="grid gap-5 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
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
