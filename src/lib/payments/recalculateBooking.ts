import { dbQuery } from "@/lib/db";

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
};

export type BookingPaymentSummary = {
  bookingId: string;
  totalAmount: number;
  depositAmount: number;
  netPaidToDate: number;
  balanceDue: number;
  paymentStatus: "UNPAID" | "DEPOSIT_PAID" | "PAID_IN_FULL";
  refundRequired: boolean;
};

function calcDays(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff + 1 : 0;
}

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
  const days = Number(pricing.days ?? calcDays(booking.start_date, booking.end_date));
  const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const depositAmount = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
  const totalAmount = Number(pricing.subtotal_cents ?? dailyRate * days);

  // "Successful" money movements:
  // - DEPOSIT_PAID: any captured payment (deposit/balance/manual)
  // - REFUNDED: refund rows (should be stored as negative amounts)
  const paidResult = await db.query(
    "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and deleted_at is null and status in ('DEPOSIT_PAID','REFUNDED')",
    [bookingId],
  );
  const netPaidToDate = Number(paidResult.rows[0]?.amount ?? 0);

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
    subtotal_cents: totalAmount,
    paid_to_date: netPaidToDate,
    balance_due: balanceDue,
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
    totalAmount,
    depositAmount,
    netPaidToDate,
    balanceDue,
    paymentStatus,
    refundRequired,
  };
}

