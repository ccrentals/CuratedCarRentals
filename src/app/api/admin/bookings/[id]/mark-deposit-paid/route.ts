import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery, getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const bookingResult = await client.query(
      "select id, vehicle_id, start_date, end_date, status, pricing_json from bookings where id = $1",
      [id],
    );

    if (bookingResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const booking = bookingResult.rows[0];
    if (["CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED"].includes(booking.status)) {
      await client.query("rollback");
      return NextResponse.json({ error: "Booking cannot be confirmed" }, { status: 400 });
    }

    const overlapResult = await client.query(
      "select id from bookings where vehicle_id = $1 and status in ('CONFIRMED','PICKED_UP') and id <> $2 and not ($4 < start_date or $3 > end_date)",
      [booking.vehicle_id, booking.id, booking.start_date, booking.end_date],
    );

    if (overlapResult.rowCount > 0) {
      await client.query("rollback");
      return NextResponse.json(
        { error: "Vehicle is no longer available for these dates" },
        { status: 409 },
      );
    }

    const depositCents = Number(booking.pricing_json?.deposit_cents ?? 0);

    const paymentInsert = await client.query(
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref) values ($1, 'MANUAL', $2, 'JMD', 'DEPOSIT_PAID', $3) returning id",
      [booking.id, depositCents, `MANUAL-${Date.now()}`],
    );

    await client.query("update bookings set status = 'CONFIRMED', updated_at = now() where id = $1", [
      booking.id,
    ]);

    await client.query("commit");

    await writeAuditLog({
      userId: session.userId,
      action: "MARK_DEPOSIT_PAID",
      entityType: "booking",
      entityId: booking.id,
      details: {
        paymentId: paymentInsert.rows[0]?.id,
        amount_cents: depositCents,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    console.error("mark-deposit-paid failed", error);
    return NextResponse.json({ error: "Failed to mark deposit paid" }, { status: 500 });
  } finally {
    client.release();
  }
}
