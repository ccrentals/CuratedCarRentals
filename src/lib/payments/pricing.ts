import { dbQuery } from "@/lib/db";
import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";

export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
};

export type PaymentStatus = "UNPAID" | "DEPOSIT_PAID" | "PAID_IN_FULL";

export type BookingPricingSummary = {
  bookingId: string;
  bookingStatus: string;
  startDate: string;
  endDate: string;
  days: number;
  dailyRate: number;
  total: number;
  deposit: number;
  netPaidToDate: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
  refundRequired: boolean;
};
export { calcDaysInclusive, dateOnlyUtc };

export function computeBookingPricing(input: {
  bookingId: string;
  bookingStatus: string;
  startDate: unknown;
  endDate: unknown;
  dailyRate: number;
  deposit: number;
  netPaidToDate: number;
}): Omit<BookingPricingSummary, "startDate" | "endDate"> & { startDate: string; endDate: string } {
  const days = calcDaysInclusive(input.startDate, input.endDate);
  const dailyRate = Number.isFinite(input.dailyRate) ? Number(input.dailyRate) : 0;
  const deposit = Number.isFinite(input.deposit) ? Number(input.deposit) : 0;
  const netPaidToDate = Number.isFinite(input.netPaidToDate) ? Number(input.netPaidToDate) : 0;
  const total = dailyRate * days;

  const balanceDue = Math.max(0, total - netPaidToDate);
  const paymentStatus: PaymentStatus =
    balanceDue === 0 && total > 0 ? "PAID_IN_FULL" : netPaidToDate > 0 ? "DEPOSIT_PAID" : "UNPAID";

  const statusUpper = String(input.bookingStatus || "").toUpperCase();
  const refundRequired = netPaidToDate > total || (statusUpper === "CANCELLED" && netPaidToDate > 0);

  const startDate = typeof input.startDate === "string" ? input.startDate : String(input.startDate ?? "");
  const endDate = typeof input.endDate === "string" ? input.endDate : String(input.endDate ?? "");

  return {
    bookingId: input.bookingId,
    bookingStatus: String(input.bookingStatus || ""),
    startDate,
    endDate,
    days,
    dailyRate,
    total,
    deposit,
    netPaidToDate,
    balanceDue,
    paymentStatus,
    refundRequired,
  };
}

function getQueryable(client?: Queryable) {
  if (client) return client;
  return { query: (text: string, params: unknown[] = []) => dbQuery(text, params) };
}

export async function fetchNetPaidToDate(
  bookingId: string,
  options: { client?: Queryable } = {},
): Promise<number> {
  const db = getQueryable(options.client);

  // Successful money movements:
  // - DEPOSIT_PAID: captured payments (deposit/balance/manual)
  // - REFUNDED: refund rows (stored as negative amounts)
  try {
    const result = await db.query(
      "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and deleted_at is null and status in ('DEPOSIT_PAID','REFUNDED')",
      [bookingId],
    );
    return Number(result.rows[0]?.amount ?? 0);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const message = String((error as { message?: unknown } | null)?.message ?? "");
    // Graceful fallback if DB hasn't been migrated yet.
    if (code === "42703" && message.includes("\"deleted_at\"") && message.includes("does not exist")) {
      const result = await db.query(
        "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and status in ('DEPOSIT_PAID','REFUNDED')",
        [bookingId],
      );
      return Number(result.rows[0]?.amount ?? 0);
    }
    throw error;
  }
}

export async function getBookingPricingSummary(
  bookingId: string,
  options: { client?: Queryable } = {},
): Promise<BookingPricingSummary> {
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
  const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const deposit = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
  const netPaidToDate = await fetchNetPaidToDate(bookingId, options);

  return computeBookingPricing({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    dailyRate,
    deposit,
    netPaidToDate,
  });
}
