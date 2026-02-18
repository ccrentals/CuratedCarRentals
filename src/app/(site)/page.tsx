import { SectionHeading } from "@/components/sections/SectionHeading";
import { VehicleCard } from "@/components/sections/VehicleCard";
import { Container } from "@/components/site/Container";
import { Button } from "@/components/ui/Button";
import { siteContent } from "@/data/content";
import { getPublicVehicles } from "@/lib/publicVehicles";

export const dynamic = "force-dynamic";

export default async function HomePage() {
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
    <div className="pb-4">
      <section
        className="relative overflow-hidden border-b border-[var(--ccr-border)] bg-[var(--ccr-primary)]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(17,26,49,0.85), rgba(17,26,49,0.6)), url('/cars/real/nissan-xtrail-2.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <Container className="py-14 md:py-20">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_0.9fr] lg:items-start">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ccr-accent)]">
                {siteContent.brand} • {siteContent.location}
              </p>
              <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight text-white md:text-6xl">
                Reliable Jamaica Car Rentals for Every Trip
              </h1>
              <p className="mt-5 text-base text-slate-100 md:text-lg">{siteContent.heroDescription}</p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button href="/fleet" className="bg-[var(--ccr-accent)] text-[var(--ccr-primary)] hover:bg-[#ffd16d]">
                  Explore Fleet
                </Button>
                <Button
                  href="/book"
                  variant="secondary"
                  className="border-white/30 bg-white/10 text-white hover:bg-white/20"
                >
                  Start Booking
                </Button>
              </div>
            </div>

            <section className="rounded-2xl border border-white/25 bg-white/95 p-6 shadow-2xl backdrop-blur">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ccr-accent-strong)]">Quick Booking</p>
              <h2 className="mt-3 text-2xl font-bold text-[var(--ccr-primary)]">Plan Your Pickup</h2>

              <form className="mt-5 grid gap-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Vehicle
                  <select className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] px-3 py-2 text-sm text-[var(--ccr-text)]">
                    {vehicles.length === 0 ? <option>No vehicles currently available</option> : null}
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id}>{vehicle.name}</option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Pickup Date
                    <input
                      type="date"
                      min={todayKey}
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Return Date
                    <input
                      type="date"
                      min={todayKey}
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] px-3 py-2 text-sm text-[var(--ccr-text)]"
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

      <Container className="pt-10 md:pt-14">
        <section className="grid gap-4 md:grid-cols-3">
          {[
            { title: "Fast Confirmation", text: "Clear booking steps with quick response time." },
            { title: "Clean Vehicles", text: "Prepared interiors and checked vehicles for each handover." },
            { title: "Transparent Rates", text: "Deposit and balance breakdown shown before checkout." },
          ].map((item) => (
            <article
              key={item.title}
              className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-sm"
            >
              <h3 className="text-lg font-bold text-[var(--ccr-text)]">{item.title}</h3>
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">{item.text}</p>
            </article>
          ))}
        </section>

        <section className="mt-14">
          <SectionHeading
            eyebrow="Featured Fleet"
            title="Popular Vehicles Available Now"
            description="Browse a few frequently booked options before viewing the full fleet."
            className="mb-6"
          />

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {featuredVehicles.length === 0 ? (
              <article className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm text-sm text-[var(--ccr-muted)]">
                Vehicles will appear here once published in Admin.
              </article>
            ) : (
              featuredVehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} />)
            )}
          </div>
        </section>
      </Container>
    </div>
  );
}
