import { Container } from "@/components/site/Container";
import {
  rentalPolicyDeposit,
  rentalPolicyRequirements,
  reservationOptions,
} from "@/data/content";

export default function RentalPoliciesPage() {
  return (
    <>
      <section className="bg-[var(--ccr-surface-soft)]/65 py-14 md:py-20 min-[1160px]:pt-44">
        <Container>
          <div className="min-[1160px]:translate-y-4">
            <h1 className="font-display text-4xl font-bold text-[var(--ccr-text)] md:text-5xl">
              Rental Policies
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--ccr-muted)]">
              You can check available bookings, dates, and pricing directly on our website.
            </p>
          </div>
        </Container>
      </section>

      <section className="bg-white py-16 md:py-24">
        <Container>
          <div className="mx-auto max-w-4xl space-y-8">
            <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-white p-8 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-light-surface-text)]">
                Two Forms of ID Required
              </h2>
              <ul className="mt-6 space-y-4">
                {rentalPolicyRequirements.map((item) => (
                  <li
                    key={item}
                    className="flex gap-3 text-base leading-7 text-[var(--ccr-light-surface-muted)]"
                  >
                    <span className="mt-1 text-[var(--ccr-accent-strong)]">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-white p-8 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-light-surface-text)]">
                Security Deposit
              </h2>
              <ul className="mt-6 space-y-4">
                {rentalPolicyDeposit.map((item) => (
                  <li
                    key={item}
                    className="flex gap-3 text-base leading-7 text-[var(--ccr-light-surface-muted)]"
                  >
                    <span className="mt-1 text-[var(--ccr-accent-strong)]">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-white p-8 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-light-surface-text)]">
                Insurance Coverage Terms
              </h2>
              <p className="mt-5 text-base leading-7 text-[var(--ccr-light-surface-muted)]">
                Customers must choose one of the following insurance options before taking possession of the
                vehicle.
              </p>

              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-warning-border)] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <h3 className="text-xl font-semibold text-[var(--ccr-light-surface-text)]">
                    Decline CDW (Collision Damage Waiver)
                  </h3>
                  <p className="mt-4 text-base leading-7 text-[var(--ccr-light-surface-muted)]">
                    If you decline the CDW, you will be responsible for the full amount of any damage up to
                    the total cost of the vehicle, along with any subsequent loss of use while the vehicle is
                    out of service.
                  </p>
                </article>

                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-success-border)] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <h3 className="text-xl font-semibold text-[var(--ccr-light-surface-text)]">
                    Choose Insurance Coverage
                  </h3>
                  <p className="mt-4 text-base leading-7 text-[var(--ccr-light-surface-muted)]">
                    If you choose the insurance coverage, you will only be responsible for the deductible of
                    the first JMD 155,000.00 in the event of damage.
                  </p>
                </article>
              </div>
            </article>

            <article className="rounded-[1.9rem] border border-[var(--ccr-border)] bg-white p-8 shadow-[0_18px_56px_rgba(15,23,42,0.07)]">
              <h2 className="font-display text-2xl font-bold text-[var(--ccr-accent-strong)]">
                📢 Online Booking &amp; Reservation Notice
              </h2>
              <p className="mt-5 text-base leading-7 text-[var(--ccr-light-surface-muted)]">
                {reservationOptions.intro}
              </p>

              <h3 className="mt-8 text-xl font-semibold text-[var(--ccr-light-surface-text)]">
                Reservation Options ✨
              </h3>

              <div className="mt-6 space-y-6">
                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-success-border)] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <h4 className="text-lg font-semibold text-[var(--ccr-status-success-border)]">
                    ✅ Paid Reservation
                  </h4>
                  <ul className="mt-4 space-y-3">
                    {reservationOptions.paid.map((item) => (
                      <li
                        key={item}
                        className="flex gap-3 text-base leading-7 text-[var(--ccr-light-surface-muted)]"
                      >
                        <span className="mt-1 text-[var(--ccr-status-success-border)]">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </article>

                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-warning-border)] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <h4 className="text-lg font-semibold text-[var(--ccr-status-warning-border)]">
                    ⚠️ Non-Paid Reservation
                  </h4>
                  <ul className="mt-4 space-y-3">
                    {reservationOptions.unpaid.map((item) => (
                      <li
                        key={item}
                        className="flex gap-3 text-base leading-7 text-[var(--ccr-light-surface-muted)]"
                      >
                        <span className="mt-1 text-[var(--ccr-status-warning-border)]">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </article>

                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-info-border)] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <h4 className="text-lg font-semibold text-[var(--ccr-status-info-border)]">
                    ✈️ Airport Pickup Policy
                  </h4>
                  <p className="mt-3 text-base font-medium leading-7 text-[var(--ccr-light-surface-muted)]">
                    Airport pickup is provided <strong>ONLY</strong> with a <strong>PAID reservation</strong>.
                  </p>
                </article>

                <article className="rounded-[1.5rem] border border-[var(--ccr-border)] border-l-4 border-l-[var(--ccr-status-accent-border)] bg-white p-6 text-center shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <p className="text-base font-medium leading-7 text-[var(--ccr-light-surface-text)]">
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
