import { BookingPayPanel } from "@/components/payments/BookingPayPanel";
import { readBookingOverrideInfo } from "@/lib/bookings/holds";
import { dbQuery } from "@/lib/db";
import { fmtDateOnly } from "@/lib/dateFormat";
import {
  computeBookingPricing,
  fetchNetPaidToDate,
  readInsurancePricingFields,
  readPaymentOption,
  readPromoPricingFields,
} from "@/lib/payments/pricing";

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

  const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const deposit = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
  const paymentOption = readPaymentOption(pricing);
  const { promoCode, promoDiscount } = readPromoPricingFields(pricing);
  const { insuranceSelected, insurancePricePerDay, insuranceTotal } = readInsurancePricingFields(pricing);
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
    insuranceSelected,
    insurancePricePerDay,
    insuranceTotal,
  });

  return (
    <BookingPayPanel
      bookingId={booking.id}
      vehicleLabel={`${booking.vehicle_make} ${booking.vehicle_model}`}
      dateRangeLabel={`${fmtDateOnly(booking.start_date)} → ${fmtDateOnly(booking.end_date)}`}
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
