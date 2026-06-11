import { dbQuery } from "@/lib/db";
import { buildInvoicePayload } from "@/lib/pdfmonkey";
import {
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
} from "@/lib/payments/pricing";

type DbQueryFn = typeof dbQuery;
type FetchNetPaidToDateFn = typeof fetchNetPaidToDate;

type BookingRow = {
  id: string;
  public_id: string | null;
  start_date: string | Date;
  end_date: string | Date;
  pickup_location: string;
  status: string;
  pricing_json: Record<string, unknown> | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  daily_rate_cents: number;
  deposit_cents: number;
};

type PaymentLine = {
  provider: string;
  status: string;
  deposit_amount_cents: number;
  created_at: string | Date;
  deleted_at?: string | null;
};

function toDateString(value: string | Date) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

export async function loadAdminBookingInvoicePayload(
  bookingId: string,
  deps: {
    query?: DbQueryFn;
    fetchNetPaidToDateFn?: FetchNetPaidToDateFn;
  } = {},
) {
  const query = deps.query ?? dbQuery;
  const fetchNetPaid = deps.fetchNetPaidToDateFn ?? fetchNetPaidToDate;

  const bookingResult = await query<BookingRow>(
    "select b.id, b.public_id, b.start_date, b.end_date, b.pickup_location, b.status, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [bookingId],
  );

  const booking = bookingResult.rows[0];
  if (!booking) {
    return null;
  }

  const pricing = booking.pricing_json ?? {};
  const netPaidToDate = await fetchNetPaid(booking.id);
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

  const paymentsRows: PaymentLine[] = await (async () => {
    try {
      const result = await query<PaymentLine>(
        "select provider, status, deposit_amount_cents, created_at, deleted_at from payments where booking_id = $1 and deleted_at is null and status in ('DEPOSIT_PAID','REFUNDED') order by created_at asc",
        [booking.id],
      );
      return result.rows;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const message = String((error as { message?: unknown } | null)?.message ?? "");
      if (code === "42703" && message.includes("\"deleted_at\"") && message.includes("does not exist")) {
        const result = await query<PaymentLine>(
          "select provider, status, deposit_amount_cents, created_at from payments where booking_id = $1 and status in ('DEPOSIT_PAID','REFUNDED') order by created_at asc",
          [booking.id],
        );
        return result.rows;
      }
      throw error;
    }
  })();

  const payments = paymentsRows.map((row) => ({
    provider: row.provider,
    status: row.status,
    amount: Number(row.deposit_amount_cents ?? 0),
    date: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
  }));

  const payload = buildInvoicePayload({
    bookingId: booking.id,
    bookingPublicId: (booking.public_id ?? "").trim() || booking.id.slice(0, 8),
    bookingStatus: booking.status,
    startDate: toDateString(booking.start_date),
    endDate: toDateString(booking.end_date),
    pickupLocation: booking.pickup_location,
    customerName: booking.customer_name,
    customerEmail: booking.customer_email,
    customerPhone: booking.customer_phone,
    vehicleMake: booking.vehicle_make,
    vehicleModel: booking.vehicle_model,
    vehicleYear: booking.vehicle_year,
    dailyRate: summary.dailyRate,
    deposit: summary.deposit,
    baseTotal: summary.baseTotal,
    total: summary.subtotal,
    paidToDate: summary.netPaidToDate,
    balanceDue: summary.balanceDue,
    insuranceTotal: summary.insuranceTotal,
    promoDiscount: summary.promoDiscount,
    promoCode: summary.promoCode,
    payments,
    rentalDays: summary.days,
  });

  return {
    bookingId: booking.id,
    payload,
  };
}
