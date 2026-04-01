import Link from "next/link";

import { Container } from "@/components/site/Container";
import { buttonStyles } from "@/components/ui/Button";
import { siteContent } from "@/data/content";

export function HomeBookingSection() {
  return (
    <section className="bg-[var(--ccr-home-booking-section-bg)] py-16 md:py-24">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-4xl font-bold text-[var(--ccr-home-booking-text)] md:text-5xl">
            {siteContent.homeBookingTitle}
          </h2>
          <p className="mt-4 text-lg leading-8 text-[var(--ccr-home-booking-muted)]">
            {siteContent.homeBookingDescription}
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-5xl rounded-[2rem] border border-[var(--ccr-home-booking-card-border)] bg-[var(--ccr-home-booking-card-bg)] p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] md:p-10">
          <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                Integrated Booking
              </p>
              <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--ccr-home-booking-muted)]">
                Reserve your perfect vehicle using our current booking flow. Vehicle inventory, published pricing, and backend-fed images remain connected to the live system.
              </p>
            </div>

            <Link
              href="/book"
              className={buttonStyles({
                variant: "primary",
                size: "lg",
                className: "rounded-full",
              })}
            >
              Book Your Vehicle
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
