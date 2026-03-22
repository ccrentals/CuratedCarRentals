import { PublicCtaBand } from "@/components/site/PublicCtaBand";
import { PublicPageIntro } from "@/components/site/PublicPageIntro";
import { PublicSection } from "@/components/site/PublicSection";
import { destinations } from "@/data/content";

export default function TouristDestinationsPage() {
  return (
    <>
      <PublicPageIntro
        eyebrow="Explore Jamaica"
        title="Tourist Destinations"
        description="Discover Jamaica's most breathtaking locations, from pristine beaches to historic landmarks."
        primaryAction={{ href: "/fleet", label: "Explore Fleet" }}
        secondaryAction={{ href: "/book", label: "Book Now" }}
      >
        <div className="flex flex-wrap gap-2">
          {destinations.slice(0, 4).map((destination) => (
            <span
              key={destination.name}
              className="rounded-full border border-white/15 bg-white/6 px-4 py-2 text-sm font-medium text-white/78"
            >
              {destination.location}
            </span>
          ))}
        </div>
      </PublicPageIntro>

      <PublicSection
        eyebrow="Plan the Route"
        title="From waterfalls and beaches to mountain drives and historic stops."
        description="Use the fleet to build a route that suits your trip, whether you want scenic day drives, family stops, or a relaxed coastal itinerary."
      >
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {destinations.map((destination, index) => (
            <article
              key={destination.name}
              className="flex h-full flex-col rounded-[1.8rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_18px_56px_rgba(15,23,42,0.07)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--ccr-text)]">
                {destination.name}
              </h2>
              <p className="mt-2 text-sm font-medium text-[var(--ccr-muted)]">{destination.location}</p>
              <p className="mt-4 text-sm leading-7 text-[var(--ccr-muted)]">{destination.description}</p>
            </article>
          ))}
        </div>
      </PublicSection>

      <PublicCtaBand
        eyebrow="Ready to Explore"
        title="Choose a vehicle that makes island driving feel effortless."
        description="Browse the fleet, plan your stops, and reserve the car that gives you the right balance of space, comfort, and confidence."
        primaryAction={{ href: "/fleet", label: "View Fleet" }}
        secondaryAction={{ href: "/book", label: "Book Now" }}
      />
    </>
  );
}
