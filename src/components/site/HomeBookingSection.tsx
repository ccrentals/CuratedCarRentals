import Link from "next/link";

import { Container } from "@/components/site/Container";
import { buttonStyles } from "@/components/ui/Button";
import type { LandingContent } from "@/lib/landingContent";

export function HomeBookingSection({ content }: { content: LandingContent["home"] }) {
  return (
    <section className="bg-[var(--ccr-home-booking-section-bg)] py-12 sm:py-14 md:py-24">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-[2rem] font-bold leading-tight text-[var(--ccr-home-booking-text)] sm:text-4xl md:text-5xl">
            <span className="inline-flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
              <span
                aria-hidden="true"
                className="ccr-home-booking-icon inline-block h-8 w-8 shrink-0 align-middle sm:h-9 sm:w-9 md:h-10 md:w-10"
              />
              <span>{content.bookingTitle}</span>
            </span>
          </h2>
          <p className="mt-4 text-base leading-7 text-[var(--ccr-home-booking-muted)] sm:text-lg sm:leading-8">
            {content.bookingDescription}
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-5xl rounded-[2rem] border border-[var(--ccr-home-booking-card-border)] bg-[var(--ccr-home-booking-card-bg)] p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:mt-10 sm:p-6 md:mt-12 md:p-10">
          <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                {content.bookingCardEyebrow}
              </p>
              <p className="mt-4 max-w-2xl text-[0.98rem] leading-7 text-[var(--ccr-home-booking-muted)] sm:text-base sm:leading-8">
                {content.bookingCardDescription}
              </p>
            </div>

            <Link
              href="/book"
              className={buttonStyles({
                variant: "primary",
                size: "lg",
                className: "w-full justify-center rounded-full md:w-auto",
              })}
            >
              {content.bookingCtaLabel}
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
