import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/session";
import { buildInvoicePayload } from "@/lib/pdfmonkey";

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

  const paymentResult = await dbQuery<{ amount: number }>(
    "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and status = 'DEPOSIT_PAID'",
    [id],
  );

  const pricing = booking.pricing_json ?? {};
  const deposit = Number((pricing as Record<string, unknown>).deposit_cents ?? booking.deposit_cents);
  const days = (() => {
    const startDate = new Date(booking.start_date);
    const endDate = new Date(booking.end_date);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
    const diff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff + 1 : 0;
  })();
  const dailyRate = Number(booking.daily_rate_cents || 0);
  const total = days * dailyRate;
  const paidToDate = Number(paymentResult.rows[0]?.amount ?? 0);
  const balanceDue = Math.max(0, total - paidToDate);

  const payload = buildInvoicePayload({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    pickupLocation: booking.pickup_location,
    customerName: booking.customer_name,
    customerEmail: booking.customer_email,
    customerPhone: booking.customer_phone,
    vehicleMake: booking.vehicle_make,
    vehicleModel: booking.vehicle_model,
    vehicleYear: booking.vehicle_year,
    dailyRate,
    deposit,
    total,
    paidToDate,
    balanceDue,
    payments: [],
  });

  return NextResponse.json({ payload });
}
