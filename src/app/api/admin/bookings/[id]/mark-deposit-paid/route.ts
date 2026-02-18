import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
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
      "select b.id, b.vehicle_id, b.start_date, b.end_date, b.status, b.pricing_json, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id where b.id = $1",
      [id],
    );

    if (bookingResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const booking = bookingResult.rows[0];
    if (booking.status === "CANCELLED") {
      await client.query("rollback");
      return NextResponse.json(
        { error: "Cancelled bookings cannot accept deposit payments" },
        { status: 400 },
      );
    }

    if (booking.status === "RETURNED") {
      await client.query("rollback");
      return NextResponse.json(
        { error: "Returned bookings cannot accept deposit payments" },
        { status: 400 },
      );
    }

    if (booking.status === "PICKED_UP") {
      await client.query("rollback");
      return NextResponse.json(
        { error: "Deposit cannot be recorded for this booking status" },
        { status: 400 },
      );
    }

    const depositCents = Number(booking.pricing_json?.deposit_cents ?? booking.deposit_cents ?? 0);
    if (!Number.isFinite(depositCents) || depositCents <= 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Invalid deposit amount" }, { status: 400 });
    }

    const providerRef = `MANUAL_DEPOSIT_${booking.id}`;
    const existing = await client.query(
      "select id from payments where booking_id = $1 and provider = 'MANUAL' and provider_ref = $2 and status = 'DEPOSIT_PAID' and deleted_at is null limit 1",
      [booking.id, providerRef],
    );
    if (existing.rowCount > 0) {
      await client.query("commit");
      return NextResponse.json({ ok: true, message: "Deposit payment already recorded" });
    }

    const paymentInsert = await client.query(
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref, metadata_json) values ($1, 'MANUAL', $2, 'JMD', 'DEPOSIT_PAID', $3, $4) returning id",
      [
        booking.id,
        depositCents,
        providerRef,
        {
          payment_type: "deposit",
          method: "ADMIN",
          method_label: "Manual / Admin",
          entered_by: session.userId,
          created_at: new Date().toISOString(),
        },
      ],
    );

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

    await client.query("update bookings set status = 'CONFIRMED', updated_at = now() where id = $1", [
      booking.id,
    ]);

    const recalculated = await recalculateBookingPayments(booking.id, { client });

    await client.query("commit");

    await writeAuditLog({
      userId: session.userId,
      action: "MARK_DEPOSIT_PAID",
      entityType: "booking",
      entityId: booking.id,
      details: {
        paymentId: paymentInsert.rows[0]?.id,
        amount_cents: depositCents,
        netPaidToDate: recalculated.netPaidToDate,
        balanceDue: recalculated.balanceDue,
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

    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    logError("api.admin.bookings.markDepositPaid.POST", error, { bookingId: id, userId: session.userId });
    return NextResponse.json({ error: "Failed to mark deposit paid" }, { status: 500 });
  } finally {
    client.release();
  }
}
