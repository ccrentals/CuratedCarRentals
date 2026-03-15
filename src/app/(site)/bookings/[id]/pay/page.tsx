import { BookingPayPanel } from "@/components/payments/BookingPayPanel";
import { notFound } from "next/navigation";
import { readBookingOverrideInfo } from "@/lib/bookings/holds";
import { hasPublicBookingAccessForPage } from "@/lib/bookings/publicAccess";
import { dbQuery } from "@/lib/db";
import { fmtDateOnly } from "@/lib/dateFormat";
import {
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
} from "@/lib/payments/pricing";

export default async function BookingPayPage({
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
    notFound();
  }

  const pricing = booking.pricing_json ?? {};
  const overrideInfo = readBookingOverrideInfo(pricing);
  const isCancelled = String(booking.status).toUpperCase() === "CANCELLED";

  if (isCancelled) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8 shadow-sm">
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Payment unavailable</h1>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            This booking is no longer active.
          </p>
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

  return (
    <BookingPayPanel
      bookingId={booking.id}
      vehicleLabel={`${booking.vehicle_make} ${booking.vehicle_model}`}
      startDateLabel={fmtDateOnly(booking.start_date)}
      endDateLabel={fmtDateOnly(booking.end_date)}
      initialSummary={{
        days: summary.days,
        subtotal: summary.subtotal,
        total: summary.total,
        deposit: summary.deposit,
        netPaidToDate: summary.netPaidToDate,
        balanceDue: summary.balanceDue,
        promoCode: summary.promoCode,
        promoDiscount: summary.promoDiscount,
        paymentStatus: summary.paymentStatus,
        paymentOption: summary.paymentOption,
      }}
    />
  );
}
