import Image from "next/image";

import { FlatSection } from "@/components/home/flat/FlatSection";
import { SectionHeading } from "@/components/sections/SectionHeading";
import { VehicleCard } from "@/components/sections/VehicleCard";
import { Container } from "@/components/site/Container";
import { Button } from "@/components/ui/Button";
import { siteContent } from "@/data/content";
import { getPublicVehicles } from "@/lib/publicVehicles";

export async function FlatHomePage() {
  const vehicles = await getPublicVehicles();
  const explicitlyFeaturedVehicles = vehicles.filter((vehicle) => vehicle.featured);
  const fallbackVehicles = vehicles.filter((vehicle) => !vehicle.featured);
  const featuredVehicles = [...explicitlyFeaturedVehicles, ...fallbackVehicles].slice(0, 3);
  const todayKey = (() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  })();

  return (
    <div className="pb-6 md:pb-10">
      <section className="border-b border-[var(--ccr-border)] bg-[var(--ccr-bg)]">
        <Container className="py-10 sm:py-12 md:py-14 lg:py-16">
          <div className="grid gap-7 md:gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ccr-muted)]">
                {siteContent.brand} • {siteContent.location}
              </p>
              <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-[var(--ccr-text)] sm:text-4xl md:text-5xl xl:text-6xl">
                Reliable Jamaica Car Rentals for Every Trip
              </h1>
              <p className="mt-5 max-w-xl text-base text-[var(--ccr-muted)] md:text-lg">{siteContent.heroDescription}</p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button href="/fleet">Explore Fleet</Button>
                <Button href="/book" variant="secondary">
                  Start Booking
                </Button>
              </div>
            </div>

            <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 sm:p-6">
              <div className="overflow-hidden rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]">
                <Image
                  src="/cars/real/nissan-xtrail-2.jpg"
                  alt="Featured Curated Car Rentals vehicle"
                  width={1100}
                  height={620}
                  className="h-44 w-full object-cover sm:h-48"
                  priority={false}
                />
              </div>

              <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-[var(--ccr-muted)]">Quick Booking</p>
              <h2 className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">Plan Your Pickup</h2>

              <form className="mt-5 grid gap-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Vehicle
                  <select className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]">
                    {vehicles.length === 0 ? <option>No vehicles currently available</option> : null}
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id}>{vehicle.name}</option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Pickup Date
                    <input
                      type="date"
                      min={todayKey}
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Return Date
                    <input
                      type="date"
                      min={todayKey}
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                </div>

                <Button href="/book" className="mt-2 w-full">
                  Continue to Booking
                </Button>
              </form>
            </section>
          </div>
        </Container>
      </section>

      <FlatSection className="pt-8 md:pt-10">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            { title: "Fast Confirmation", text: "Clear booking steps with quick response time." },
            { title: "Clean Vehicles", text: "Prepared interiors and checked vehicles for each handover." },
            { title: "Transparent Rates", text: "Deposit and balance breakdown shown before checkout." },
          ].map((item) => (
            <article key={item.title} className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-5">
              <h3 className="text-lg font-bold text-[var(--ccr-text)]">{item.title}</h3>
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">{item.text}</p>
            </article>
          ))}
        </section>
      </FlatSection>

      <FlatSection className="pt-0 md:pt-0">
        <SectionHeading
          eyebrow="Featured Fleet"
          title="Popular Vehicles Available Now"
          description="Browse a few frequently booked options before viewing the full fleet."
          className="mb-6"
        />

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 [&_article]:shadow-none">
          {featuredVehicles.length === 0 ? (
            <article className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm text-[var(--ccr-muted)]">
              Vehicles will appear here once published in Admin.
            </article>
          ) : (
            featuredVehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} />)
          )}
        </div>
      </FlatSection>
    </div>
  );
}
