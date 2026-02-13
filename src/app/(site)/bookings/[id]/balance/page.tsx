import Link from "next/link";

import { PayBalanceButton } from "@/components/payments/PayBalanceButton";
import { readBookingOverrideInfo } from "@/lib/bookings/holds";
import { dbQuery } from "@/lib/db";
import { fmtDateOnly } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import {
  computeBookingPricing,
  fetchNetPaidToDate,
  readPaymentOption,
  readPromoPricingFields,
} from "@/lib/payments/pricing";

export default async function BookingBalancePage({
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
    pickup_location: string;
    pricing_json: Record<string, unknown> | null;
    vehicle_make: string;
    vehicle_model: string;
    daily_rate_cents: number;
    deposit_cents: number;
  }>(
    "select b.id, b.status, b.start_date, b.end_date, b.pickup_location, b.pricing_json, v.make as vehicle_make, v.model as vehicle_model, v.daily_rate_cents, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id where b.id = $1",
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
  const overrideInfo = readBookingOverrideInfo(pricing);
  const isCancelled = String(booking.status).toUpperCase() === "CANCELLED";

  if (isCancelled) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8 shadow-sm">
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Balance payment unavailable</h1>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">This booking is no longer active.</p>
          {overrideInfo.isOverridden ? (
            <div className="mt-4 rounded-xl border border-red-300/40 bg-red-500/15 p-4 text-sm text-red-100">
              <p className="font-semibold">Overridden</p>
              <p className="mt-1 text-red-100/90">
                Another customer completed payment for the same vehicle and dates first.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const deposit = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
  const paymentOption = readPaymentOption(pricing);
  const { promoCode, promoDiscount } = readPromoPricingFields(pricing);

  const netPaidToDate = await fetchNetPaidToDate(booking.id);
  const summary = computeBookingPricing({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    dailyRate,
    deposit,
    paymentOption,
    netPaidToDate,
    promoCode,
    promoDiscount,
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Pay Balance</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          Pay the remaining balance to complete your booking.
        </p>

        <div className="mt-4 space-y-2 text-sm text-[var(--ccr-muted)]">
          <p>
            Vehicle:{" "}
            <span className="font-semibold text-[var(--ccr-text)]">
              {booking.vehicle_make} {booking.vehicle_model}
            </span>
          </p>
          <p>
            Dates:{" "}
            <span className="font-semibold text-[var(--ccr-text)]">
              {fmtDateOnly(booking.start_date)} → {fmtDateOnly(booking.end_date)}
            </span>
          </p>
          <p>
            Pickup location:{" "}
            <span className="font-semibold text-[var(--ccr-text)]">{booking.pickup_location}</span>
          </p>
          <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Pricing Summary
            </h3>
            <div className="mt-3 grid gap-2 text-sm text-[var(--ccr-text)]">
              <p>
                Days: <span className="font-semibold">{summary.days}</span>
              </p>
              <p>
                Total rental: <span className="font-semibold">{formatJmd(summary.total)}</span>
              </p>
              {summary.promoDiscount > 0 ? (
                <p>
                  Promo{summary.promoCode ? ` (${summary.promoCode})` : ""}:{" "}
                  <span className="font-semibold">-{formatJmd(summary.promoDiscount)}</span>
                </p>
              ) : null}
              <p>
                Deposit online: <span className="font-semibold">{formatJmd(summary.deposit)}</span>
              </p>
              <p>
                Paid to date: <span className="font-semibold">{formatJmd(summary.netPaidToDate)}</span>
              </p>
              <p>
                Balance due: <span className="font-semibold">{formatJmd(summary.balanceDue)}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {summary.balanceDue > 0 ? (
            <PayBalanceButton bookingId={booking.id} />
          ) : (
            <span className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]">
              Balance paid in full
            </span>
          )}
          <Link
            href={`/bookings/${booking.id}`}
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
          >
            Back to Booking
          </Link>
        </div>
      </div>
    </div>
  );
}
