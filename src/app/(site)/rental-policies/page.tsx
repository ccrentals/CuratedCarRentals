import { Container } from "@/components/site/Container";
import {
  rentalPolicyDeposit,
  rentalPolicyRequirements,
  reservationOptions,
} from "@/data/content";

export default function RentalPoliciesPage() {
  return (
    <>
      <section className="bg-[var(--ccr-surface-soft)]/65 py-14 md:py-20">
        <Container>
          <h1 className="font-display text-4xl font-bold text-[var(--ccr-text)] md:text-5xl">
            Rental Policies
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--ccr-muted)]">
            You can check available bookings, dates, and pricing directly on our website.
          </p>
        </Container>
      </section>

      <section className="bg-white py-16 md:py-24">
        <Container>
          <div className="mx-auto max-w-4xl space-y-8">
            <article className="rounded-[1.9rem] bg-[var(--ccr-surface-soft)]/65 p-8">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-text)]">
                Two Forms of ID Required
              </h2>
              <ul className="mt-6 space-y-4">
                {rentalPolicyRequirements.map((item) => (
                  <li key={item} className="flex gap-3 text-base leading-7 text-[var(--ccr-muted)]">
                    <span className="mt-1 text-green-600">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-[1.9rem] bg-[var(--ccr-surface-soft)]/65 p-8">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-text)]">
                Security Deposit
              </h2>
              <ul className="mt-6 space-y-4">
                {rentalPolicyDeposit.map((item) => (
                  <li key={item} className="flex gap-3 text-base leading-7 text-[var(--ccr-muted)]">
                    <span className="mt-1 text-green-600">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-[1.9rem] border border-amber-200 bg-amber-50 p-8">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-text)]">
                📢 Online Booking &amp; Reservation Notice
              </h2>
              <p className="mt-5 text-base leading-7 text-[var(--ccr-muted)]">
                {reservationOptions.intro}
              </p>

              <h3 className="mt-8 text-xl font-semibold text-[var(--ccr-text)]">
                Reservation Options ✨
              </h3>

              <div className="mt-6 space-y-6">
                <article className="rounded-[1.5rem] border border-green-200 bg-white p-6">
                  <h4 className="text-lg font-semibold text-green-700">✅ Paid Reservation</h4>
                  <ul className="mt-4 space-y-3">
                    {reservationOptions.paid.map((item) => (
                      <li key={item} className="flex gap-3 text-base leading-7 text-[var(--ccr-muted)]">
                        <span className="mt-1 text-green-600">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </article>

                <article className="rounded-[1.5rem] border border-amber-200 bg-white p-6">
                  <h4 className="text-lg font-semibold text-amber-700">⚠️ Non-Paid Reservation</h4>
                  <ul className="mt-4 space-y-3">
                    {reservationOptions.unpaid.map((item) => (
                      <li key={item} className="flex gap-3 text-base leading-7 text-[var(--ccr-muted)]">
                        <span className="mt-1 text-amber-500">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </article>

                <article className="rounded-[1.5rem] border border-blue-200 bg-blue-50 p-6">
                  <h4 className="text-lg font-semibold text-blue-800">✈️ Airport Pickup Policy</h4>
                  <p className="mt-3 text-base font-medium leading-7 text-blue-800">
                    Airport pickup is provided <strong>ONLY</strong> with a <strong>PAID reservation</strong>.
                  </p>
                </article>

                <article className="rounded-[1.5rem] border border-green-300 bg-green-100 p-6 text-center">
                  <p className="text-base font-medium leading-7 text-green-800">
                    💡 To avoid inconvenience, we <strong>strongly recommend</strong> making a paid reservation to guarantee your booking.
                  </p>
                </article>
              </div>
            </article>
          </div>
        </Container>
      </section>
    </>
  );
}
