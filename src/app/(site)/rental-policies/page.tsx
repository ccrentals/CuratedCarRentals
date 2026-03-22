import { PublicCtaBand } from "@/components/site/PublicCtaBand";
import { PublicPageIntro } from "@/components/site/PublicPageIntro";
import { PublicSection } from "@/components/site/PublicSection";
import {
  rentalPolicyDeposit,
  rentalPolicyRequirements,
  reservationOptions,
} from "@/data/content";

export default function RentalPoliciesPage() {
  return (
    <>
      <PublicPageIntro
        eyebrow="Rental Guidance"
        title="Rental Policies"
        description="You can check available bookings, dates, and pricing directly on our website."
        primaryAction={{ href: "/book", label: "Book Now" }}
        secondaryAction={{ href: "/fleet", label: "Explore Fleet" }}
      />

      <PublicSection
        eyebrow="Requirements"
        title="Clear booking expectations before you reserve."
        description="These core requirements help keep pickup straightforward and the reservation process predictable."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--ccr-text)]">Two Forms of ID Required</h2>
            <ul className="mt-5 space-y-4">
              {rentalPolicyRequirements.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-7 text-[var(--ccr-muted)]">
                  <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--ccr-text)]">Security Deposit</h2>
            <ul className="mt-5 space-y-4">
              {rentalPolicyDeposit.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-7 text-[var(--ccr-muted)]">
                  <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </PublicSection>

      <PublicSection
        eyebrow="Reservation Notice"
        title="Online booking lets you review live dates, prices, and reservation options."
        description={reservationOptions.intro}
        className="bg-[var(--ccr-surface)]/55"
      >
        <div className="grid gap-5 xl:grid-cols-[1fr_1fr_0.9fr]">
          <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
              Paid Reservation
            </p>
            <ul className="mt-5 space-y-4">
              {reservationOptions.paid.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-7 text-[var(--ccr-muted)]">
                  <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
              Non-Paid Reservation
            </p>
            <ul className="mt-5 space-y-4">
              {reservationOptions.unpaid.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-7 text-[var(--ccr-muted)]">
                  <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]">
                    •
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-[var(--ccr-primary)] p-6 text-white shadow-[0_18px_56px_rgba(15,23,42,0.14)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
              Airport Pickup Policy
            </p>
            <p className="mt-4 text-base leading-7 text-white/80">{reservationOptions.airportPickupNote}</p>
            <p className="mt-6 rounded-[1.5rem] bg-white/8 p-4 text-sm leading-7 text-white/76">
              {reservationOptions.recommendation}
            </p>
          </article>
        </div>
      </PublicSection>

      <PublicCtaBand
        eyebrow="Ready to Reserve?"
        title="Check the live fleet, review the dates, and place your reservation online."
        description="Booking online is the easiest way to see current availability, vehicle choices, and pricing before you travel."
        primaryAction={{ href: "/book", label: "Book Now" }}
        secondaryAction={{ href: "/fleet", label: "Explore Fleet" }}
      />
    </>
  );
}
