import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/session";
import { buildInvoicePayload } from "@/lib/pdfmonkey";
import { computeBookingPricing, fetchNetPaidToDate, readPromoPricingFields } from "@/lib/payments/pricing";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const bookingResult = await dbQuery<{
    id: string;
    start_date: string;
    end_date: string;
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
  }>(
    "select b.id, b.start_date, b.end_date, b.pickup_location, b.status, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [id],
  );

  const booking = bookingResult.rows[0];
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const pricing = booking.pricing_json ?? {};
  const dailyRate = Number((pricing as Record<string, unknown>).daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const deposit = Number((pricing as Record<string, unknown>).deposit_cents ?? booking.deposit_cents ?? 0);
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

  type PaymentLine = {
    provider: string;
    status: string;
    deposit_amount_cents: number;
    created_at: string | Date;
    deleted_at?: string | null;
  };

  const paymentsRows: PaymentLine[] = await (async () => {
    try {
      const result = await dbQuery<PaymentLine>(
        "select provider, status, deposit_amount_cents, created_at, deleted_at from payments where booking_id = $1 and deleted_at is null and status in ('DEPOSIT_PAID','REFUNDED') order by created_at asc",
        [booking.id],
      );
      return result.rows;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const message = String((error as { message?: unknown } | null)?.message ?? "");
      if (code === "42703" && message.includes("\"deleted_at\"") && message.includes("does not exist")) {
        const result = await dbQuery<PaymentLine>(
          "select provider, status, deposit_amount_cents, created_at from payments where booking_id = $1 and status in ('DEPOSIT_PAID','REFUNDED') order by created_at asc",
          [booking.id],
        );
        return result.rows;
      }
      throw error;
    }
  })();

  const payments = paymentsRows.map((row: PaymentLine) => ({
    provider: row.provider,
    status: row.status,
    amount: Number(row.deposit_amount_cents ?? 0),
    date:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ""),
  }));

  const payload = buildInvoicePayload({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date instanceof Date ? booking.start_date.toISOString() : String(booking.start_date),
    endDate: booking.end_date instanceof Date ? booking.end_date.toISOString() : String(booking.end_date),
    pickupLocation: booking.pickup_location,
    customerName: booking.customer_name,
    customerEmail: booking.customer_email,
    customerPhone: booking.customer_phone,
    vehicleMake: booking.vehicle_make,
    vehicleModel: booking.vehicle_model,
    vehicleYear: booking.vehicle_year,
    dailyRate,
    deposit: summary.deposit,
    total: summary.total,
    paidToDate: summary.netPaidToDate,
    balanceDue: summary.balanceDue,
    payments,
  });

  return NextResponse.json({ payload });
}
