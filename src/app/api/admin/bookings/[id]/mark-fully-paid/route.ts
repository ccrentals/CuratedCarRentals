import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery, getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";

function calcDays(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff + 1 : 0;
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
      "select b.id, b.status, b.start_date, b.end_date, b.pricing_json, v.daily_rate_cents, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id where b.id = $1 for update",
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

    const paidResult = await client.query(
      "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and status = 'DEPOSIT_PAID'",
      [booking.id],
    );
    const paidToDate = Number(paidResult.rows[0]?.amount ?? 0);
    const balanceDue = Math.max(0, subtotal - paidToDate);

    if (balanceDue <= 0) {
      const updatedPricing = {
        ...pricing,
        daily_rate_cents: dailyRate,
        deposit_cents: deposit,
        days,
        subtotal_cents: subtotal,
        paid_to_date: paidToDate,
        balance_due: 0,
        balance_paid: true,
        balance_paid_amount_cents: Math.max(0, subtotal - deposit),
        paid_in_full: true,
      };

      await client.query(
        "update bookings set pricing_json = $1, updated_at = now() where id = $2",
        [updatedPricing, booking.id],
      );

      await client.query("commit");
      return NextResponse.json({ ok: true, message: "Already fully paid" });
    }

    const providerRef = `MANUAL_BALANCE_${booking.id}`;
    const existing = await client.query(
      "select id from payments where booking_id = $1 and provider = 'MANUAL' and provider_ref = $2 and status = 'DEPOSIT_PAID' limit 1",
      [booking.id, providerRef],
    );
    if (existing.rowCount > 0) {
      await client.query("commit");
      return NextResponse.json({ ok: true, message: "Balance payment already recorded" });
    }

    await client.query(
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref, metadata_json) values ($1, 'MANUAL', $2, 'JMD', 'DEPOSIT_PAID', $3, $4)",
      [
        booking.id,
        balanceDue,
        providerRef,
        {
          payment_type: "balance",
          method: "ADMIN",
          method_label: "Manual / Admin",
          entered_by: session.userId,
          created_at: new Date().toISOString(),
        },
      ],
    );

    const paidResultAfter = await client.query(
      "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and status = 'DEPOSIT_PAID'",
      [booking.id],
    );
    const paidToDateAfter = Number(paidResultAfter.rows[0]?.amount ?? 0);
    const balanceDueAfter = Math.max(0, subtotal - paidToDateAfter);

    const updatedPricing = {
      ...pricing,
      daily_rate_cents: dailyRate,
      deposit_cents: deposit,
      days,
      subtotal_cents: subtotal,
      paid_to_date: paidToDateAfter,
      balance_due: balanceDueAfter,
      balance_paid: true,
      balance_paid_amount_cents: balanceDue,
      paid_in_full: balanceDueAfter <= 0,
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
      details: { balance_cents: balanceDue },
    });

    return NextResponse.json({ ok: true, message: "Balance payment recorded" });
  } catch (error) {
    await client.query("rollback");
    console.error("mark-fully-paid failed", error);
    return NextResponse.json({ error: "Failed to mark fully paid" }, { status: 500 });
  } finally {
    client.release();
  }
}
