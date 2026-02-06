import { SectionHeading } from "@/components/sections/SectionHeading";
import { Container } from "@/components/site/Container";
import { aboutHighlights, siteContent } from "@/data/content";

export default function AboutPage() {
  return (
    <div className="py-10 md:py-14">
      <Container>
        <section className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-primary)] px-6 py-10 md:px-10">
          <SectionHeading
            eyebrow="About"
            title="A trusted local partner for Jamaica car rentals"
            description="Curated Car Rentals focuses on clean vehicles, clear communication, and straightforward booking."
            tone="light"
          />
        </section>

        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[var(--ccr-primary)]">Who We Are</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--ccr-muted)]">
              We are a Jamaica-based rental team helping visitors and returning residents secure dependable transportation.
              This page is part of your frontend template and ready for brand copy updates.
            </p>
          </section>

          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[var(--ccr-primary)]">Why Guests Choose Us</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--ccr-muted)]">
              {aboutHighlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-[var(--ccr-muted)]">Based in {siteContent.address}.</p>
          </section>
        </div>
      </Container>
    </div>
  );
}
