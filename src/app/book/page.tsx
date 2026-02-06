import { SectionHeading } from "@/components/sections/SectionHeading";
import { Container } from "@/components/site/Container";
import { Button } from "@/components/ui/Button";
import { siteContent } from "@/data/content";
import { vehicles } from "@/data/vehicles";
import { formatCurrency } from "@/lib/utils";

const sampleRentalDays = 5;

export default function BookPage() {
  return (
    <div className="py-10 md:py-14">
      <Container>
        <section className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-primary)] px-6 py-8 md:px-8">
          <SectionHeading
            eyebrow="Book"
            title="Secure Your Car in Minutes"
            description="Choose your vehicle and review an estimated deposit and balance. Final payment flow will be connected later."
            tone="light"
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-accent)]">Sample Rental</p>
              <p className="mt-1 text-lg font-bold text-white">{sampleRentalDays} Days</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-accent)]">Deposit Rate</p>
              <p className="mt-1 text-lg font-bold text-white">{Math.round(siteContent.bookingDepositRate * 100)}%</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-accent)]">Currency</p>
              <p className="mt-1 text-lg font-bold text-white">USD</p>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
            <h2 className="text-xl font-bold text-[var(--ccr-primary)]">Reservation Details</h2>
            <form className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="text-sm text-[var(--ccr-muted)]">
                Full Name
                <input
                  type="text"
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                  placeholder="Your name"
                />
              </label>
              <label className="text-sm text-[var(--ccr-muted)]">
                Email
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                  placeholder="you@example.com"
                />
              </label>
              <label className="text-sm text-[var(--ccr-muted)]">
                Pickup Date
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                />
              </label>
              <label className="text-sm text-[var(--ccr-muted)]">
                Return Date
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                />
              </label>
            </form>
          </section>

          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
            <h2 className="text-xl font-bold text-[var(--ccr-primary)]">Estimate Guide</h2>
            <p className="mt-2 text-sm text-[var(--ccr-muted)]">
              Example pricing below uses a {sampleRentalDays}-day rental with a {Math.round(siteContent.bookingDepositRate * 100)}%
              deposit.
            </p>
            <div className="mt-5 space-y-3">
              {vehicles.map((vehicle) => {
                const total = vehicle.pricePerDay * sampleRentalDays;
                const deposit = Math.round(total * siteContent.bookingDepositRate);
                const balance = total - deposit;

                return (
                  <div
                    key={vehicle.id}
                    className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4"
                  >
                    <p className="font-semibold text-[var(--ccr-primary)]">{vehicle.name}</p>
                    <p className="mt-1 text-sm text-[var(--ccr-muted)]">Total: {formatCurrency(total)}</p>
                    <p className="text-sm text-[var(--ccr-muted)]">Deposit: {formatCurrency(deposit)}</p>
                    <p className="text-sm text-[var(--ccr-muted)]">Balance on pickup: {formatCurrency(balance)}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-5">
              <Button className="w-full">Submit Booking Request</Button>
            </div>
          </section>
        </div>
      </Container>
    </div>
  );
}
