import { dbQuery } from "@/lib/db";
import {
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
  type Queryable,
} from "@/lib/payments/pricing";

export type BookingPaymentSummary = {
  bookingId: string;
  days: number;
  dailyRate: number;
  subtotalAmount: number;
  promoCode: string | null;
  promoDiscount: number;
  totalAmount: number;
  depositAmount: number;
  paymentOption: "DEPOSIT" | "FULL" | "CUSTOM" | "NONE";
  netPaidToDate: number;
  balanceDue: number;
  paymentStatus: "UNPAID" | "DUE_ON_PICKUP" | "DEPOSIT_PAID" | "PAID_IN_FULL";
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

  const netPaidToDate = await fetchNetPaidToDate(bookingId, options);

  const summary = computeBookingPricingFromStoredSnapshot({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    pricing: booking.pricing_json,
    fallbackDailyRate: booking.daily_rate_cents,
    fallbackDeposit: booking.deposit_cents,
    netPaidToDate,
  });

  const updatedPricing = {
    ...(booking.pricing_json ?? {}),
    days: summary.days,
    daily_rate_cents: summary.dailyRate,
    deposit_cents: summary.deposit,
    base_total_cents: summary.baseTotal,
    extra_fees_cents: summary.extraFeesTotal,
    subtotal_cents: summary.subtotal,
    insurance_selected: summary.insuranceSelected,
    insurance_price_per_day_cents: summary.insurancePricePerDay,
    insurance_total_cents: summary.insuranceTotal,
    promo_code: summary.promoCode,
    promo_discount_cents: summary.promoDiscount,
    discount_total_cents: summary.discountTotal,
    paid_to_date: summary.netPaidToDate,
    amount_paid: summary.netPaidToDate,
    amount_due_cents: summary.amountDue,
    balance_due: summary.balanceDue,
    total_amount: summary.total,
    total_cents: summary.total,
    paid_in_full: summary.paymentStatus === "PAID_IN_FULL",
    payment_status: summary.paymentStatus,
    payment_option_selected: summary.paymentOption,
    refund_required: summary.refundRequired,
    currency: "JMD",
  };

  await db.query("update bookings set pricing_json = $1, updated_at = now() where id = $2", [
    updatedPricing,
    bookingId,
  ]);

  return {
    bookingId,
    days: summary.days,
    dailyRate: summary.dailyRate,
    subtotalAmount: summary.subtotal,
    promoCode: summary.promoCode,
    promoDiscount: summary.promoDiscount,
    totalAmount: summary.total,
    depositAmount: summary.deposit,
    paymentOption: summary.paymentOption,
    netPaidToDate: summary.netPaidToDate,
    balanceDue: summary.balanceDue,
    paymentStatus: summary.paymentStatus,
    refundRequired: summary.refundRequired,
  };
}
