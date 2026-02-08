import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery, getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import {
  sendPaymentCompleteEmail,
  sendPaymentUpdateEmail,
} from "@/lib/notifications/email";

function calcDays(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff + 1 : 0;
}

const METHOD_ALLOWLIST = new Set(["CASH", "CARD", "BANK_TRANSFER", "OTHER"]);

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
  const amount = Number(body?.amount);
  const methodRaw = typeof body?.method === "string" ? body.method.trim().toUpperCase() : "";
  const method = METHOD_ALLOWLIST.has(methodRaw) ? methodRaw : "OTHER";
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
  }

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const bookingResult = await client.query(
      "select b.id, b.status, b.start_date, b.end_date, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
      [id],
    );

    if (bookingResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const booking = bookingResult.rows[0];
    if (booking.status === "CANCELLED") {
      await client.query("rollback");
      return NextResponse.json({ error: "Cancelled booking cannot be paid" }, { status: 400 });
    }

    const pricing = booking.pricing_json ?? {};
    const days = Number(pricing.days ?? calcDays(booking.start_date, booking.end_date));
    const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
    const deposit = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
    const total = Number(pricing.subtotal_cents ?? dailyRate * days);

    const providerRef = `${method}_${Date.now()}`;
    await client.query(
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref, metadata_json) values ($1, $2, $3, 'JMD', 'DEPOSIT_PAID', $4, $5)",
      [
        booking.id,
        method,
        amount,
        providerRef,
        {
          payment_type: "manual",
          method,
          note,
          entered_by: session.userId,
          created_at: new Date().toISOString(),
        },
      ],
    );

    const paidResult = await client.query(
      "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and status = 'DEPOSIT_PAID'",
      [booking.id],
    );

    const paidToDate = Number(paidResult.rows[0]?.amount ?? 0);
    const balanceDue = Math.max(0, total - paidToDate);
    const paidInFull = balanceDue <= 0;

    const shouldConfirm = booking.status === "PENDING_PAYMENT" && paidToDate >= deposit;
    const updatedPricing = {
      ...pricing,
      daily_rate_cents: dailyRate,
      deposit_cents: deposit,
      days,
      subtotal_cents: total,
      paid_to_date: paidToDate,
      balance_due: balanceDue,
      paid_in_full: paidInFull,
      balance_paid: paidInFull,
      balance_paid_amount_cents: paidInFull ? Math.max(0, total - deposit) : 0,
    };

    await client.query(
      "update bookings set pricing_json = $1, status = $2, updated_at = now() where id = $3",
      [updatedPricing, shouldConfirm ? "CONFIRMED" : booking.status, booking.id],
    );

    await client.query("commit");

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_MANUAL_PAYMENT_ADDED",
      entityType: "booking",
      entityId: booking.id,
      details: { amount, method, confirmed: shouldConfirm },
    });

    const vehicleLabel = `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim();

    if (paidInFull) {
      await sendPaymentCompleteEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        dailyRate,
        deposit,
        total,
        paidToDate,
        balanceDue,
      });
    } else {
      await sendPaymentUpdateEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        dailyRate,
        deposit,
        total,
        paidToDate,
        balanceDue,
      });
    }

    return NextResponse.json({ ok: true, paidToDate, balanceDue, paidInFull });
  } catch (error) {
    await client.query("rollback");
    console.error("add-payment failed", error);
    return NextResponse.json({ error: "Failed to add payment" }, { status: 500 });
  } finally {
    client.release();
  }
}
