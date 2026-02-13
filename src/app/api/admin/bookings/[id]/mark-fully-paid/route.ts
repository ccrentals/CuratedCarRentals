import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
import { logError } from "@/lib/log";

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
      "select b.id, b.vehicle_id, b.status, b.start_date, b.end_date from bookings b where b.id = $1 for update",
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

    const before = await recalculateBookingPayments(booking.id, { client });
    const balanceDue = before.balanceDue;

    if (balanceDue <= 0) {
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

    const after = await recalculateBookingPayments(booking.id, { client });
    const shouldConfirm =
      String(booking.status).toUpperCase() === "PENDING_PAYMENT" &&
      after.netPaidToDate >= after.depositAmount;

    let confirmed = false;
    if (shouldConfirm) {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [booking.vehicle_id]);
      const overlapResult = await client.query(
        "select id from bookings where vehicle_id = $1 and status in ('CONFIRMED','PICKED_UP') and id <> $2 and not ($4 < start_date or $3 > end_date)",
        [booking.vehicle_id, booking.id, booking.start_date, booking.end_date],
      );
      if (overlapResult.rowCount === 0) {
        await client.query("update bookings set status = 'CONFIRMED', updated_at = now() where id = $1", [
          booking.id,
        ]);
        confirmed = true;
      }
    }

    await client.query("commit");

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_MARK_FULLY_PAID",
      entityType: "booking",
      entityId: booking.id,
      details: { balance_cents: balanceDue, confirmed },
    });

    return NextResponse.json({ ok: true, message: "Balance payment recorded" });
  } catch (error) {
    await client.query("rollback");
    logError("admin_mark_fully_paid_failed", error, { bookingId: id });
    return NextResponse.json({ error: "Failed to mark fully paid" }, { status: 500 });
  } finally {
    client.release();
  }
}
