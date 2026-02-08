import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery, getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";

function calcDays(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
}

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
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const bookingResult = await client.query(
      "select b.id, b.status, b.start_date, b.end_date, b.pricing_json, v.daily_rate_cents, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id where b.id = $1",
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
    const subtotal = Number(pricing.subtotal_cents ?? dailyRate * days);
    const deposit = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);

    const balanceCents = Math.max(0, subtotal - deposit);

    await client.query(
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref) values ($1, 'MANUAL', $2, 'JMD', 'DEPOSIT_PAID', $3)",
      [booking.id, balanceCents, `MANUAL_BALANCE_${Date.now()}`],
    );

    const updatedPricing = {
      ...pricing,
      daily_rate_cents: dailyRate,
      deposit_cents: deposit,
      days,
      subtotal_cents: subtotal,
      balance_paid: true,
      balance_paid_amount_cents: balanceCents,
      paid_in_full: true,
    };

    await client.query(
      "update bookings set pricing_json = $1, updated_at = now() where id = $2",
      [updatedPricing, booking.id],
    );

    await client.query("commit");

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_MARK_FULLY_PAID",
      entityType: "booking",
      entityId: booking.id,
      details: { balance_cents: balanceCents },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    console.error("mark-fully-paid failed", error);
    return NextResponse.json({ error: "Failed to mark fully paid" }, { status: 500 });
  } finally {
    client.release();
  }
}
