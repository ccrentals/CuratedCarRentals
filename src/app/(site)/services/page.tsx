import { SectionHeading } from "@/components/sections/SectionHeading";
import { Container } from "@/components/site/Container";
import { services } from "@/data/services";

export default function ServicesPage() {
  return (
    <div className="py-10 md:py-14">
      <Container>
        <section className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-primary)] px-6 py-10 md:px-10">
          <SectionHeading
            eyebrow="Services"
            title="Helpful Add-ons for Smoother Travel"
            description="Everything here is template content and can be adjusted to match your exact service list."
            tone="light"
          />
        </section>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {services.map((service) => (
            <article
              key={service.title}
              className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm"
            >
              <h2 className="text-lg font-bold text-[var(--ccr-text)]">{service.title}</h2>
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">{service.description}</p>
            </article>
          ))}
        </div>
      </Container>
    </div>
  );
}
