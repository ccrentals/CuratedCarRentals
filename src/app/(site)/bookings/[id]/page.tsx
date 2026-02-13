import Link from "next/link";

import { dbQuery } from "@/lib/db";
import { fmtDateOnly } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import { computeBookingPricing, fetchNetPaidToDate, readPromoPricingFields } from "@/lib/payments/pricing";

export default async function BookingSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const bookingResult = await dbQuery<{
    id: string;
    status: string;
    start_date: string;
    end_date: string;
    pricing_json: Record<string, unknown> | null;
    vehicle_make: string;
    vehicle_model: string;
    daily_rate_cents: number;
    deposit_cents: number;
  }>(
    "select b.id, b.status, b.start_date, b.end_date, b.pricing_json, v.make as vehicle_make, v.model as vehicle_model, v.daily_rate_cents, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [id],
  );

  const booking = bookingResult.rows[0];
  if (!booking) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-sm text-[var(--ccr-muted)]">Booking not found.</p>
      </div>
    );
  }

  const pricing = booking.pricing_json ?? {};
  const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const deposit = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
  const { promoCode, promoDiscount } = readPromoPricingFields(pricing);
  const netPaidToDate = await fetchNetPaidToDate(booking.id);
  const summary = computeBookingPricing({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    dailyRate,
    deposit,
    netPaidToDate,
    promoCode,
    promoDiscount,
  });
  const depositDue = Math.max(0, summary.deposit - summary.netPaidToDate);
  const canPayDeposit = depositDue > 0;
  const canPayBalance = depositDue <= 0 && summary.balanceDue > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Booking Summary</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">Booking ID: {booking.id}</p>

        <div className="mt-4 space-y-2 text-sm text-[var(--ccr-muted)]">
          <p>
            Vehicle: <span className="font-semibold text-[var(--ccr-text)]">{booking.vehicle_make} {booking.vehicle_model}</span>
          </p>
          <p>
            Dates: <span className="font-semibold text-[var(--ccr-text)]">{fmtDateOnly(booking.start_date)} → {fmtDateOnly(booking.end_date)}</span>
          </p>
          <p>
            Status: <span className="font-semibold text-[var(--ccr-text)]">{booking.status}</span>
          </p>
          <p className="text-xs text-[var(--ccr-muted)]">
            Deposit paid online, balance paid on pickup (or pay online anytime).
          </p>
        </div>

        <div className="mt-6 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Pricing Summary</h3>
          <div className="mt-3 grid gap-2 text-sm text-[var(--ccr-text)]">
            <p>Days: <span className="font-semibold">{summary.days}</span></p>
            <p>Total rental: <span className="font-semibold">{formatJmd(summary.total)}</span></p>
            {summary.promoDiscount > 0 ? (
              <p>
                Promo{summary.promoCode ? ` (${summary.promoCode})` : ""}:{" "}
                <span className="font-semibold">-{formatJmd(summary.promoDiscount)}</span>
              </p>
            ) : null}
            <p>Deposit online: <span className="font-semibold">{formatJmd(summary.deposit)}</span></p>
            <p>Paid to date: <span className="font-semibold">{formatJmd(summary.netPaidToDate)}</span></p>
            <p>Balance due: <span className="font-semibold">{formatJmd(summary.balanceDue)}</span></p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Policies & Payment Instructions
          </h3>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--ccr-text)]">
            <li>Deposit secures the booking. Balance is due by pickup.</li>
            <li>Please bring a valid driver’s license and your booking reference.</li>
            <li>Cancellations within 24 hours of pickup may be non-refundable.</li>
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {canPayDeposit ? (
            <Link
              href={`/bookings/${booking.id}/pay`}
              className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              Make Payment
            </Link>
          ) : null}
          {canPayBalance ? (
            <Link
              href={`/bookings/${booking.id}/balance`}
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
            >
              Pay Balance
            </Link>
          ) : null}
          {!canPayDeposit && !canPayBalance ? (
            <span className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]">
              Payment complete
            </span>
          ) : null}
          <Link
            href="/contact"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
          >
            Contact Support
          </Link>
        </div>
      </div>
    </div>
  );
}
