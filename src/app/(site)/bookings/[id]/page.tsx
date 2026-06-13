import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPublicBookingAccessForPage } from "@/lib/bookings/publicAccess";
import { DateRangeArrow } from "@/components/shared/DateRangeArrow";
import { dbQuery } from "@/lib/db";
import { formatBookingDateOnly } from "@/lib/bookings/bookingDateTime";
import { formatJmd } from "@/lib/money";
import { readBookingOverrideInfo } from "@/lib/bookings/holds";
import {
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
} from "@/lib/payments/pricing";

export default async function BookingSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const accessResult = await dbQuery<{
    id: string;
    pricing_json: Record<string, unknown> | null;
  }>("select id, pricing_json from bookings where id = $1", [id]);
  const bookingAccess = accessResult.rows[0];
  if (!bookingAccess) {
    notFound();
  }
  const isAuthorized = await hasPublicBookingAccessForPage(
    bookingAccess.id,
    bookingAccess.pricing_json,
  );
  if (!isAuthorized) {
    notFound();
  }

  const bookingResult = await dbQuery<{
    id: string;
    public_id: string | null;
    status: string;
    start_date: string;
    end_date: string;
    pricing_json: Record<string, unknown> | null;
    vehicle_make: string;
    vehicle_model: string;
    daily_rate_cents: number;
    deposit_cents: number;
  }>(
    "select b.id, b.public_id, b.status, b.start_date, b.end_date, b.pricing_json, v.make as vehicle_make, v.model as vehicle_model, v.daily_rate_cents, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [id],
  );

  const booking = bookingResult.rows[0];
  if (!booking) {
    notFound();
  }
  const bookingRef = String(booking.public_id ?? "").trim() || booking.id;

  const pricing = booking.pricing_json ?? {};
  const overrideInfo = readBookingOverrideInfo(pricing);
  const netPaidToDate = await fetchNetPaidToDate(booking.id);
  const summary = computeBookingPricingFromStoredSnapshot({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    pricing,
    fallbackDailyRate: booking.daily_rate_cents,
    fallbackDeposit: booking.deposit_cents,
    netPaidToDate,
  });
  const depositDue = Math.max(0, summary.deposit - summary.netPaidToDate);
  const canPayDeposit = depositDue > 0;
  const canPayBalance = depositDue <= 0 && summary.balanceDue > 0;
  const isNonBlocking = summary.netPaidToDate <= 0;
  const isOverridden = overrideInfo.isOverridden;
  const isCancelled = String(booking.status).toUpperCase() === "CANCELLED";

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Booking Summary</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">Booking ID: {bookingRef}</p>
        {isOverridden ? (
          <div className="mt-4 rounded-xl border border-red-300/40 bg-red-500/15 p-4 text-sm text-red-100">
            <p className="font-semibold">Overridden</p>
            <p className="mt-1 text-red-100/90">
              This booking was cancelled because another customer completed payment for the same
              vehicle and dates.
            </p>
          </div>
        ) : null}
        {!isOverridden && isNonBlocking ? (
          <div className="mt-4 rounded-xl border border-amber-300/40 bg-amber-400/10 p-4 text-sm text-amber-100">
            <p className="font-semibold">Deposit required to guarantee availability</p>
            <p className="mt-1 text-amber-100/90">
              Please note vehicle availability is not guaranteed without payment. To guarantee
              availability a deposit is required.
            </p>
          </div>
        ) : null}

        <div className="mt-4 space-y-2 text-sm text-[var(--ccr-muted)]">
          <p>
            Vehicle: <span className="font-semibold text-[var(--ccr-text)]">{booking.vehicle_make} {booking.vehicle_model}</span>
          </p>
          <p>
            Dates:{" "}
            <span className="inline-flex items-center font-semibold text-[var(--ccr-text)]">
              {formatBookingDateOnly(booking.start_date)}
              <DateRangeArrow />
              {formatBookingDateOnly(booking.end_date)}
            </span>
          </p>
          <p>
            Status: <span className="font-semibold text-[var(--ccr-text)]">{booking.status}</span>
          </p>
          <p>
            Payment option: <span className="font-semibold text-[var(--ccr-text)]">{summary.paymentOption.replace(/_/g, " ")}</span>
          </p>
          <p className="text-xs text-[var(--ccr-muted)]">
            Deposit paid online, balance paid on pickup (or pay online anytime).
          </p>
        </div>

        <div className="mt-6 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Pricing Summary</h3>
          <div className="mt-3 grid gap-2 text-sm text-[var(--ccr-text)]">
            <p>Days: <span className="font-semibold">{summary.days}</span></p>
            <p>Subtotal: <span className="font-semibold">{formatJmd(summary.subtotal)}</span></p>
            {summary.promoDiscount > 0 ? (
              <p>
                Promo{summary.promoCode ? ` (${summary.promoCode})` : ""}:{" "}
                <span className="font-semibold">-{formatJmd(summary.promoDiscount)}</span>
              </p>
            ) : null}
            <p>Total: <span className="font-semibold">{formatJmd(summary.total)}</span></p>
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
            <li>Please note vehicle availability is not guaranteed without payment. To guarantee availability a deposit is required.</li>
            <li>Please bring a valid driver’s license and your booking reference.</li>
            <li>Cancellations within 24 hours of pickup may be non-refundable.</li>
          </ul>
        </div>

        <div className="mt-6 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Secure Documents
          </h3>
          <div className="mt-3 flex flex-wrap gap-3">
            <a
              href={`/api/public/bookings/${booking.id}/private-files/DRIVERS_LICENSE`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm font-semibold text-[var(--ccr-text)]"
            >
              View Driver&apos;s License
            </a>
            <a
              href={`/api/public/bookings/${booking.id}/private-files/SIGNATURE`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm font-semibold text-[var(--ccr-text)]"
            >
              View Signature
            </a>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {!isCancelled && canPayDeposit ? (
            <Link
              href={`/bookings/${booking.id}/pay`}
              className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              Make Payment
            </Link>
          ) : null}
          {!isCancelled && canPayBalance ? (
            <Link
              href={`/bookings/${booking.id}/balance`}
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
            >
              Pay Balance
            </Link>
          ) : null}
          {!canPayDeposit && !canPayBalance && !isCancelled ? (
            <span className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]">
              Payment complete
            </span>
          ) : null}
          {isCancelled ? (
            <span className="rounded-xl border border-red-300/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100">
              Booking cancelled
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
