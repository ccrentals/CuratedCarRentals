import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/session";
import { requireCsrf } from "@/lib/security/csrf";
import {
  sendBookingCreatedEmail,
  sendDepositReceiptEmail,
} from "@/lib/notifications/email";
import { readPromoPricingFields } from "@/lib/payments/pricing";

const ALLOWED_TYPES = ["booking_created", "deposit_receipt"] as const;

type EmailType = (typeof ALLOWED_TYPES)[number];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const type = body?.type as EmailType | undefined;

  if (!type || !ALLOWED_TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid email type" }, { status: 400 });
  }

  const bookingResult = await dbQuery<{
    id: string;
    start_date: string;
    end_date: string;
    pickup_location: string;
    pricing_json: Record<string, unknown> | null;
    customer_name: string;
    customer_email: string;
    vehicle_make: string;
    vehicle_model: string;
    vehicle_year: number;
    daily_rate_cents: number;
    deposit_cents: number;
  }>(
    "select b.id, b.start_date, b.end_date, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [id],
  );

  const booking = bookingResult.rows[0];
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const pricing = booking.pricing_json ?? {};
  const { promoCode, promoDiscount } = readPromoPricingFields(pricing);
  const depositValue = Number(
    (pricing as Record<string, unknown>).deposit_cents ?? booking.deposit_cents,
  );

  if (type === "booking_created") {
    const result = await sendBookingCreatedEmail({
      bookingId: booking.id,
      customerEmail: booking.customer_email,
      customerName: booking.customer_name,
      vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
      startDate: booking.start_date,
      endDate: booking.end_date,
      pickupLocation: booking.pickup_location,
      dailyRate: Number(booking.daily_rate_cents || 0),
      deposit: depositValue,
      promoCode,
      promoDiscount,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Email failed" },
        { status: result.skipped ? 400 : 500 },
      );
    }

    return NextResponse.json({ ok: true });
  }

  const paymentResult = await dbQuery<{ amount: number }>(
    "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and status = 'DEPOSIT_PAID'",
    [booking.id],
  );

  const paidToDate = Number(paymentResult.rows[0]?.amount ?? 0);

  const receiptResult = await sendDepositReceiptEmail({
    bookingId: booking.id,
    customerEmail: booking.customer_email,
    customerName: booking.customer_name,
    vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
    startDate: booking.start_date,
    endDate: booking.end_date,
    pickupLocation: booking.pickup_location,
    dailyRate: Number(booking.daily_rate_cents || 0),
    deposit: depositValue,
    paidToDate,
    promoCode,
    promoDiscount,
  });

  if (!receiptResult.ok) {
    return NextResponse.json(
      { error: receiptResult.error ?? "Email failed" },
      { status: receiptResult.skipped ? 400 : 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
