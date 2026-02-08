import { SectionHeading } from "@/components/sections/SectionHeading";
import { Container } from "@/components/site/Container";
import { Button } from "@/components/ui/Button";
import { siteContent } from "@/data/content";

export default function ContactPage() {
  return (
    <div className="py-10 md:py-14">
      <Container>
        <section className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-primary)] px-6 py-10 md:px-10">
          <SectionHeading
            eyebrow="Contact"
            title="Get in touch with Curated Car Rentals"
            description="Use this template form for inquiries and booking questions."
            tone="light"
          />
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Contact Details</h2>
            <ul className="mt-4 space-y-2 text-sm text-[var(--ccr-muted)]">
              <li>Phone: {siteContent.phone}</li>
              <li>Email: {siteContent.email}</li>
              <li>Address: {siteContent.address}</li>
            </ul>
          </section>

          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Send a Message</h2>
            <form className="mt-4 space-y-4">
              <label className="block text-sm text-[var(--ccr-muted)]">
                Name
                <input
                  type="text"
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                />
              </label>
              <label className="block text-sm text-[var(--ccr-muted)]">
                Email
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                />
              </label>
              <label className="block text-sm text-[var(--ccr-muted)]">
                Message
                <textarea className="mt-1 min-h-28 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2" />
              </label>
              <Button type="button">Send Inquiry</Button>
            </form>
          </section>
        </div>
      </Container>
    </div>
  );
}
