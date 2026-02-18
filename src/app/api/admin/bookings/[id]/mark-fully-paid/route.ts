import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
import { logError } from "@/lib/log";
import {
  getInternalNotesRecipient,
  sendBookingOverriddenByPaidBookingEmail,
} from "@/lib/notifications/email";
import { overrideOverlappingNonBlockingBookings } from "@/lib/bookings/holds";

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

    // Use a unique provider reference per captured balance payment.
    // This allows legitimate additional balance captures if the booking is later extended.
    const providerRef = `MANUAL_BALANCE_${booking.id}_${crypto.randomUUID()}`;

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
    const overrideOutcome = await overrideOverlappingNonBlockingBookings(client, {
      paidBookingId: booking.id,
      vehicleId: booking.vehicle_id,
      startDate: booking.start_date,
      endDate: booking.end_date,
      overrideReason: "Overridden by paid booking",
    });

    if (overrideOutcome.blockingConflictIds.length > 0) {
      await client.query("rollback");
      return NextResponse.json(
        { error: "Vehicle is no longer available for these dates" },
        { status: 409 },
      );
    }

    const shouldConfirm =
      String(booking.status).toUpperCase() === "PENDING_PAYMENT" &&
      after.netPaidToDate >= after.depositAmount;

    let confirmed = false;
    if (shouldConfirm) {
      await client.query("update bookings set status = 'CONFIRMED', updated_at = now() where id = $1", [
        booking.id,
      ]);
      confirmed = true;
    }

    await client.query("commit");

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_MARK_FULLY_PAID",
      entityType: "booking",
      entityId: booking.id,
      details: {
        balance_cents: balanceDue,
        confirmed,
        overriddenBookings: overrideOutcome.overridden.map((item) => item.id),
      },
    });

    for (const overriddenBooking of overrideOutcome.overridden) {
      await writeAuditLog({
        userId: session.userId,
        action: "BOOKING_OVERRIDDEN_BY_PAID_BOOKING",
        entityType: "booking",
        entityId: overriddenBooking.id,
        details: {
          overriddenByBookingId: booking.id,
          overrideReason: "Overridden by paid booking",
        },
      });

      await sendBookingOverriddenByPaidBookingEmail({
        recipientType: "customer",
        recipientEmail: overriddenBooking.customerEmail,
        bookingId: overriddenBooking.id,
        customerName: overriddenBooking.customerName,
        customerEmail: overriddenBooking.customerEmail,
        vehicleLabel: overriddenBooking.vehicleLabel,
        startDate: overriddenBooking.startDate,
        endDate: overriddenBooking.endDate,
        pickupLocation: overriddenBooking.pickupLocation,
        overriddenByBookingId: booking.id,
      });

      await sendBookingOverriddenByPaidBookingEmail({
        recipientType: "internal",
        recipientEmail: getInternalNotesRecipient(),
        bookingId: overriddenBooking.id,
        customerName: overriddenBooking.customerName,
        customerEmail: overriddenBooking.customerEmail,
        vehicleLabel: overriddenBooking.vehicleLabel,
        startDate: overriddenBooking.startDate,
        endDate: overriddenBooking.endDate,
        pickupLocation: overriddenBooking.pickupLocation,
        overriddenByBookingId: booking.id,
      });
    }

    return NextResponse.json({ ok: true, message: "Balance payment recorded" });
  } catch (error) {
    await client.query("rollback");
    logError("admin_mark_fully_paid_failed", error, { bookingId: id });
    return NextResponse.json({ error: "Failed to mark fully paid" }, { status: 500 });
  } finally {
    client.release();
  }
}
