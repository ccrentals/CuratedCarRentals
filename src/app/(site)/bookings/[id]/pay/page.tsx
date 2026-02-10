import Link from "next/link";

import { PayDepositButton } from "@/components/payments/PayDepositButton";
import { PayInFullButton } from "@/components/payments/PayInFullButton";
import { PayBalanceButton } from "@/components/payments/PayBalanceButton";
import { dbQuery } from "@/lib/db";
import { fmtDateOnly } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import { computeBookingPricing, fetchNetPaidToDate } from "@/lib/payments/pricing";

export default async function BookingPayPage({
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

  const netPaidToDate = await fetchNetPaidToDate(booking.id);
  const summary = computeBookingPricing({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    dailyRate,
    deposit,
    netPaidToDate,
  });
  const depositDue = Math.max(0, summary.deposit - summary.netPaidToDate);
  const canPayInFullFromZero = summary.netPaidToDate <= 0;
  const canPayBalance = summary.netPaidToDate > 0 && summary.balanceDue > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Pay Online</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          Choose to pay the deposit now or pay in full to complete payment.
        </p>

        <div className="mt-4 space-y-2 text-sm text-[var(--ccr-muted)]">
          <p>
            Vehicle: <span className="font-semibold text-[var(--ccr-text)]">{booking.vehicle_make} {booking.vehicle_model}</span>
          </p>
          <p>
            Dates: <span className="font-semibold text-[var(--ccr-text)]">{fmtDateOnly(booking.start_date)} → {fmtDateOnly(booking.end_date)}</span>
          </p>
          <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Pricing Summary</h3>
            <div className="mt-3 grid gap-2 text-sm text-[var(--ccr-text)]">
              <p>Days: <span className="font-semibold">{summary.days}</span></p>
              <p>Total rental: <span className="font-semibold">{formatJmd(summary.total)}</span></p>
              <p>Deposit online: <span className="font-semibold">{formatJmd(summary.deposit)}</span></p>
              <p>Paid to date: <span className="font-semibold">{formatJmd(summary.netPaidToDate)}</span></p>
              <p>Balance due: <span className="font-semibold">{formatJmd(summary.balanceDue)}</span></p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">Pay Deposit</p>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">
              {depositDue > 0
                ? `Pay ${formatJmd(depositDue)} now to confirm. Remaining balance ${formatJmd(
                    Math.max(0, summary.balanceDue - depositDue),
                  )} due on pickup.`
                : "Deposit is already paid."}
            </p>
            <div className="mt-3">
              {depositDue > 0 ? (
                <PayDepositButton bookingId={booking.id} />
              ) : (
                <span className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]">
                  Deposit paid
                </span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">
              {canPayBalance ? "Pay Balance" : "Pay in Full"}
            </p>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">
              {summary.balanceDue <= 0
                ? "This booking is already fully paid."
                : canPayBalance
                  ? `Pay the remaining balance of ${formatJmd(summary.balanceDue)} now.`
                  : `Pay ${formatJmd(summary.total)} now. Balance due becomes ${formatJmd(0)}.`}
            </p>
            <div className="mt-3">
              {summary.balanceDue <= 0 ? (
                <span className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]">
                  Paid in full
                </span>
              ) : canPayBalance ? (
                <PayBalanceButton bookingId={booking.id} />
              ) : canPayInFullFromZero ? (
                <PayInFullButton bookingId={booking.id} />
              ) : (
                <span className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]">
                  Use Pay Balance
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <Link
            href={`/bookings/${booking.id}`}
            className="inline-flex rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
          >
            Back to Booking
          </Link>
        </div>
      </div>
    </div>
  );
}
