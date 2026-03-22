import { VehicleCard } from "@/components/sections/VehicleCard";
import { PublicCtaBand } from "@/components/site/PublicCtaBand";
import { PublicPageIntro } from "@/components/site/PublicPageIntro";
import { PublicSection } from "@/components/site/PublicSection";
import { Container } from "@/components/site/Container";
import { getPublicVehicles } from "@/lib/publicVehicles";

export const dynamic = "force-dynamic";

export default async function FleetPage() {
  const vehicles = await getPublicVehicles();
  const categories = Array.from(new Set(vehicles.map((vehicle) => vehicle.category))).slice(0, 6);

  return (
    <>
      <PublicPageIntro
        eyebrow="Fleet"
        title="Our Complete Fleet"
        description="Browse our entire collection of premium vehicles available for your Jamaican adventure. From economic options to luxury rides, we have the perfect car for your needs."
        primaryAction={{ href: "/book", label: "Book Your Vehicle" }}
        secondaryAction={{ href: "/driving-in-jamaica", label: "Driving in Jamaica" }}
      >
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <span
              key={category}
              className="rounded-full border border-white/15 bg-white/6 px-4 py-2 text-sm font-medium text-white/78"
            >
              {category}
            </span>
          ))}
        </div>
      </PublicPageIntro>

      <div className="border-b border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        <Container className="py-4">
          <p className="text-sm font-medium text-[var(--ccr-text)]">
            <span className="font-semibold text-[var(--ccr-accent-strong)]">Pricing note:</span> Our Simple Pricing
            includes all fees and taxes - No Surprises! (*optional insurance is extra)
          </p>
        </Container>
      </div>

      <PublicSection
        eyebrow="Live Availability"
        title="Backend-fed vehicles presented in a cleaner, more breathable browsing layout."
        description="The fleet below remains connected to the live published vehicles in the system. Cards, pricing, images, and booking handoff all stay dynamic."
        className="pt-12 md:pt-16"
      >
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-3xl font-semibold tracking-tight text-[var(--ccr-text)]">{vehicles.length}</p>
            <p className="mt-2 text-sm leading-7 text-[var(--ccr-muted)]">
              Currently published vehicles ready to browse and book.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <span
                key={category}
                className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ccr-muted)]"
              >
                {category}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {vehicles.length === 0 ? (
            <article className="rounded-[1.8rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm leading-7 text-[var(--ccr-muted)] shadow-[0_18px_56px_rgba(15,23,42,0.08)]">
              No vehicles are currently published. Add and publish vehicles from the Admin portal.
            </article>
          ) : (
            vehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} />)
          )}
        </div>
      </PublicSection>

      <PublicCtaBand
        eyebrow="Need Help Choosing?"
        title="Compare the fleet, then book the vehicle that fits your route and pace."
        description="If you already know your travel dates, head straight to booking. If not, keep browsing the fleet and detail pages for the right fit."
        primaryAction={{ href: "/book", label: "Book Now" }}
        secondaryAction={{ href: "/contact", label: "Contact Us" }}
      />
    </>
  );
}
