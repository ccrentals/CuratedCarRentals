import Link from "next/link";

import { dbQuery } from "@/lib/db";
import { fmtDateOnly } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";

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
    paid_to_date: number;
  }>(
    "select b.id, b.status, b.start_date, b.end_date, b.pricing_json, v.make as vehicle_make, v.model as vehicle_model, v.daily_rate_cents, v.deposit_cents, coalesce(sum(p.deposit_amount_cents), 0) as paid_to_date from bookings b join vehicles v on v.id = b.vehicle_id left join payments p on p.booking_id = b.id and p.status = 'DEPOSIT_PAID' where b.id = $1 group by b.id, v.make, v.model, v.daily_rate_cents, v.deposit_cents",
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

  function daysInclusive(start: unknown, end: unknown) {
    if (!start || !end) return 0;
    const s = new Date(String(start));
    const e = new Date(String(end));
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
    const diff = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff + 1 : 0;
  }

  const days = daysInclusive(booking.start_date, booking.end_date);
  const total = dailyRate * days;
  const paidToDate = Number(booking.paid_to_date ?? 0);
  const balance = Math.max(0, total - paidToDate);
  const canPayDeposit = paidToDate < deposit;
  const canPayBalance = paidToDate >= deposit && balance > 0;

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
            <p>Days: <span className="font-semibold">{days}</span></p>
            <p>Total rental: <span className="font-semibold">{formatJmd(total)}</span></p>
            <p>Deposit online: <span className="font-semibold">{formatJmd(deposit)}</span></p>
            <p>Paid to date: <span className="font-semibold">{formatJmd(paidToDate)}</span></p>
            <p>Balance on pickup: <span className="font-semibold">{formatJmd(balance)}</span></p>
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
