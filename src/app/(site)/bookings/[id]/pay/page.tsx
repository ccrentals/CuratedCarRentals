import { BookingPayPanel } from "@/components/payments/BookingPayPanel";
import { dbQuery } from "@/lib/db";
import { fmtDateOnly } from "@/lib/dateFormat";
import { computeBookingPricing, fetchNetPaidToDate, readPromoPricingFields } from "@/lib/payments/pricing";

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
      }}
    />
  );
}
