import { dbQuery } from "@/lib/db";
import { calcDaysInclusive, fetchNetPaidToDate, type Queryable } from "@/lib/payments/pricing";

export type BookingPaymentSummary = {
  bookingId: string;
  days: number;
  dailyRate: number;
  subtotalAmount: number;
  promoCode: string | null;
  promoDiscount: number;
  totalAmount: number;
  depositAmount: number;
  netPaidToDate: number;
  balanceDue: number;
  paymentStatus: "UNPAID" | "DEPOSIT_PAID" | "PAID_IN_FULL";
  refundRequired: boolean;
};

function getQueryable(client?: Queryable) {
  if (client) return client;
  return { query: (text: string, params: unknown[] = []) => dbQuery(text, params) };
}

// Single source of truth for booking payment totals/status.
// Used after any payment mutation (add/delete/restore/refund).
export async function recalculateBookingPayments(
  bookingId: string,
  options: { client?: Queryable } = {},
): Promise<BookingPaymentSummary> {
  const db = getQueryable(options.client);

  const bookingResult = await db.query(
    "select b.id, b.status, b.start_date, b.end_date, b.pricing_json, v.daily_rate_cents, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [bookingId],
  );

  if (bookingResult.rowCount === 0) {
    throw new Error("Booking not found");
  }

  const booking = bookingResult.rows[0] as {
    id: string;
    status: string;
    start_date: string;
    end_date: string;
    pricing_json: Record<string, unknown> | null;
    daily_rate_cents: number;
    deposit_cents: number;
  };

  const pricing = booking.pricing_json ?? {};
  // Always compute days from booking dates so UI + payment charges stay consistent.
  const days = calcDaysInclusive(booking.start_date, booking.end_date);
  const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const depositAmount = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
  const subtotalAmount = dailyRate * days;
  const promoCode =
    typeof pricing.promo_code === "string" && pricing.promo_code.trim().length > 0
      ? String(pricing.promo_code).trim().toUpperCase()
      : null;
  const promoDiscountRaw = Number(pricing.promo_discount_cents ?? 0);
  const promoDiscount = Math.max(0, Math.min(subtotalAmount, promoDiscountRaw));
  const totalAmount = Math.max(0, subtotalAmount - promoDiscount);

  const netPaidToDate = await fetchNetPaidToDate(bookingId, options);

  const balanceDue = Math.max(0, totalAmount - netPaidToDate);
  const paymentStatus: BookingPaymentSummary["paymentStatus"] =
    balanceDue === 0 && totalAmount > 0
      ? "PAID_IN_FULL"
      : netPaidToDate > 0
        ? "DEPOSIT_PAID"
        : "UNPAID";

  const refundRequired =
    netPaidToDate > totalAmount || (String(booking.status).toUpperCase() === "CANCELLED" && netPaidToDate > 0);

  const updatedPricing = {
    ...pricing,
    days,
    daily_rate_cents: dailyRate,
    deposit_cents: depositAmount,
    subtotal_cents: subtotalAmount,
    promo_code: promoCode,
    promo_discount_cents: promoDiscount,
    paid_to_date: netPaidToDate,
    balance_due: balanceDue,
    total_amount: totalAmount,
    total_cents: totalAmount,
    paid_in_full: paymentStatus === "PAID_IN_FULL",
    payment_status: paymentStatus,
    refund_required: refundRequired,
  };

  await db.query("update bookings set pricing_json = $1, updated_at = now() where id = $2", [
    updatedPricing,
    bookingId,
  ]);

  return {
    bookingId,
    days,
    dailyRate,
    subtotalAmount,
    promoCode,
    promoDiscount,
    totalAmount,
    depositAmount,
    netPaidToDate,
    balanceDue,
    paymentStatus,
    refundRequired,
  };
}
