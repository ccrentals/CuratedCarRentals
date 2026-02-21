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
  sendPaymentCompleteEmail,
  sendPaymentUpdateEmail,
} from "@/lib/notifications/email";
import { maybeEntitleBookingAfterPayment } from "@/lib/availability/entitlement";

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
      "select b.id, b.vehicle_id, b.status, b.start_date, b.end_date, b.pickup_location, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1 for update",
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

    const entitlementResolution = await maybeEntitleBookingAfterPayment(booking.id, {
      client,
      auditUserId: session.userId,
    });
    const after = await recalculateBookingPayments(booking.id, { client });
    const confirmed = entitlementResolution.state === "ENTITLED";

    await client.query("commit");

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_MARK_FULLY_PAID",
      entityType: "booking",
      entityId: booking.id,
      details: {
        balance_cents: balanceDue,
        confirmed,
        entitlementState: entitlementResolution.state,
        winnerBookingId: entitlementResolution.winnerBookingId,
        overriddenBookings: entitlementResolution.cancelledOverlaps.map((item) => item.id),
      },
    });

    for (const overriddenBooking of entitlementResolution.cancelledOverlaps) {
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

    if (entitlementResolution.state === "LOST") {
      return NextResponse.json({
        ok: true,
        lost: true,
        winnerBookingId: entitlementResolution.winnerBookingId,
      });
    }

    const vehicleLabel =
      `${booking.vehicle_year ?? ""} ${booking.vehicle_make ?? ""} ${booking.vehicle_model ?? ""}`.trim();
    const paymentDateTime = new Date().toISOString();

    if (after.balanceDue <= 0) {
      await sendPaymentCompleteEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location ?? "",
        dailyRate: after.dailyRate,
        deposit: after.depositAmount,
        total: after.totalAmount,
        paidToDate: after.netPaidToDate,
        balanceDue: after.balanceDue,
        paymentAmount: balanceDue,
        paymentMethod: "Manual / Admin (Balance)",
        paymentDateTime,
      });
    } else {
      await sendPaymentUpdateEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location ?? "",
        dailyRate: after.dailyRate,
        deposit: after.depositAmount,
        total: after.totalAmount,
        paidToDate: after.netPaidToDate,
        balanceDue: after.balanceDue,
        paymentAmount: balanceDue,
        paymentMethod: "Manual / Admin (Balance)",
        paymentDateTime,
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
