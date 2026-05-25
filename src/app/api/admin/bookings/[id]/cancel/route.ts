import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { writeAuditLog } from "@/lib/audit";
import { getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";
import { syncPromoRedemptionStateForBooking } from "@/lib/promos";
import { requireCsrf } from "@/lib/security/csrf";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await params;
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const bookingResult = await client.query(
      "select status, pricing_json from bookings where id = $1 for update",
      [id],
    );

    if (bookingResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const bookingRow = bookingResult.rows[0] as { status: string; pricing_json: Record<string, unknown> | null };
    const status = bookingRow.status;
    const pricing = bookingRow.pricing_json ?? {};
    if (status === "RETURNED") {
      await client.query("rollback");
      return NextResponse.json({ error: "Returned bookings cannot be cancelled" }, { status: 400 });
    }

    if (status === "CANCELLED") {
      await client.query("commit");
      return NextResponse.json({ ok: true, message: "Already cancelled" });
    }

    const cancelledAt = new Date().toISOString();
    await client.query("update bookings set status = 'CANCELLED', pricing_json = $2, updated_at = now() where id = $1", [
      id,
      {
        ...pricing,
        cancelled_at: cancelledAt,
      },
    ]);
    await syncPromoRedemptionStateForBooking(id, {
      client,
      source: "admin_booking_cancel",
    });

    await client.query("commit");

    await writeAuditLog({
      userId: actor.userId,
      action: "BOOKING_CANCELLED",
      entityType: "booking",
      entityId: id,
      details: { previous_status: status, cancelled_at: cancelledAt },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    logError("api.admin.bookings.cancel.POST", error, { bookingId: id, userId: actor.userId });
    return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
  } finally {
    client.release();
  }
}
