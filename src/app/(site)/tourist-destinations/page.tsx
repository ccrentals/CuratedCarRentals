import { SectionHeading } from "@/components/sections/SectionHeading";
import { Container } from "@/components/site/Container";
import { destinations } from "@/data/content";

export default function TouristDestinationsPage() {
  return (
    <div className="py-10 md:py-14">
      <Container>
        <section className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-primary)] px-6 py-10 md:px-10">
          <SectionHeading
            eyebrow="Tourist Destinations"
            title="Explore Jamaica with confidence"
            description="Sample destination highlights you can customize based on the areas you serve most often."
            tone="light"
          />
        </section>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {destinations.map((destination) => (
            <article
              key={destination.name}
              className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-accent-strong)]">
                {destination.parish}
              </p>
              <h2 className="mt-1 text-lg font-bold text-[var(--ccr-text)]">{destination.name}</h2>
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">{destination.description}</p>
            </article>
          ))}
        </div>
      </Container>
    </div>
  );
}
