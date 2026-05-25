import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
import {
  getInternalNotesRecipient,
  sendBookingOverriddenByPaidBookingEmail,
  sendInternalPaymentCompleteNotifications,
  sendInternalPaymentUpdateNotifications,
  sendPaymentCompleteEmail,
  sendPaymentUpdateEmail,
} from "@/lib/notifications/email";
import { maybeEntitleBookingAfterPayment } from "@/lib/availability/entitlement";

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
      "select b.id, b.vehicle_id, b.start_date, b.end_date, b.status, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
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
          entered_by: actor.userId,
          created_at: new Date().toISOString(),
        },
      ],
    );

    const entitlementResolution = await maybeEntitleBookingAfterPayment(booking.id, {
      client,
      auditUserId: actor.userId,
    });
    const recalculated = await recalculateBookingPayments(booking.id, { client });

    await client.query("commit");

    await writeAuditLog({
      userId: actor.userId,
      action: "MARK_DEPOSIT_PAID",
      entityType: "booking",
      entityId: booking.id,
      details: {
        paymentId: paymentInsert.rows[0]?.id,
        amount_cents: depositCents,
        netPaidToDate: recalculated.netPaidToDate,
        balanceDue: recalculated.balanceDue,
        entitlementState: entitlementResolution.state,
        winnerBookingId: entitlementResolution.winnerBookingId,
        overriddenBookings: entitlementResolution.cancelledOverlaps.map((item) => item.id),
      },
    });

    for (const overriddenBooking of entitlementResolution.cancelledOverlaps) {
      await writeAuditLog({
        userId: actor.userId,
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
        dispatch: {
          triggerSource: "admin_payment",
          triggeredByUserId: actor.userId,
          entityType: "booking",
          entityId: overriddenBooking.id,
          relatedTransactionType: "booking",
          relatedTransactionId: booking.id,
          manualResendAllowed: true,
        },
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
        dispatch: {
          triggerSource: "admin_payment",
          triggeredByUserId: actor.userId,
          entityType: "booking",
          entityId: overriddenBooking.id,
          relatedTransactionType: "booking",
          relatedTransactionId: booking.id,
          manualResendAllowed: true,
        },
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

    if (recalculated.balanceDue <= 0) {
      await sendPaymentCompleteEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone ?? "",
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location ?? "",
        dailyRate: recalculated.dailyRate,
        deposit: recalculated.depositAmount,
        total: recalculated.totalAmount,
        paidToDate: recalculated.netPaidToDate,
        balanceDue: recalculated.balanceDue,
        paymentAmount: depositCents,
        paymentMethod: "Manual / Admin (Deposit)",
        paymentDateTime,
        dispatch: {
          triggerSource: "admin_payment",
          triggeredByUserId: actor.userId,
          entityType: "booking",
          entityId: booking.id,
          entityPublicId: booking.public_id ?? null,
          relatedTransactionType: "booking",
          relatedTransactionId: booking.id,
          manualResendAllowed: true,
        },
      });
      await sendInternalPaymentCompleteNotifications({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone ?? "",
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location ?? "",
        dailyRate: recalculated.dailyRate,
        deposit: recalculated.depositAmount,
        total: recalculated.totalAmount,
        paidToDate: recalculated.netPaidToDate,
        balanceDue: recalculated.balanceDue,
        paymentAmount: depositCents,
        paymentMethod: "Manual / Admin (Deposit)",
        paymentDateTime,
        dispatch: {
          triggerSource: "admin_payment",
          triggeredByUserId: actor.userId,
          entityType: "booking",
          entityId: booking.id,
          entityPublicId: booking.public_id ?? null,
          relatedTransactionType: "booking",
          relatedTransactionId: booking.id,
          manualResendAllowed: true,
        },
      });
    } else {
      await sendPaymentUpdateEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone ?? "",
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location ?? "",
        dailyRate: recalculated.dailyRate,
        deposit: recalculated.depositAmount,
        total: recalculated.totalAmount,
        paidToDate: recalculated.netPaidToDate,
        balanceDue: recalculated.balanceDue,
        paymentAmount: depositCents,
        paymentMethod: "Manual / Admin (Deposit)",
        paymentDateTime,
        dispatch: {
          triggerSource: "admin_payment",
          triggeredByUserId: actor.userId,
          entityType: "booking",
          entityId: booking.id,
          entityPublicId: booking.public_id ?? null,
          relatedTransactionType: "booking",
          relatedTransactionId: booking.id,
          manualResendAllowed: true,
        },
      });
      await sendInternalPaymentUpdateNotifications({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone ?? "",
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location ?? "",
        dailyRate: recalculated.dailyRate,
        deposit: recalculated.depositAmount,
        total: recalculated.totalAmount,
        paidToDate: recalculated.netPaidToDate,
        balanceDue: recalculated.balanceDue,
        paymentAmount: depositCents,
        paymentMethod: "Manual / Admin (Deposit)",
        paymentDateTime,
        dispatch: {
          triggerSource: "admin_payment",
          triggeredByUserId: actor.userId,
          entityType: "booking",
          entityId: booking.id,
          entityPublicId: booking.public_id ?? null,
          relatedTransactionType: "booking",
          relatedTransactionId: booking.id,
          manualResendAllowed: true,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    logError("api.admin.bookings.markDepositPaid.POST", error, {
      bookingId: id,
      userId: actor.userId,
    });
    return NextResponse.json({ error: "Failed to mark deposit paid" }, { status: 500 });
  } finally {
    client.release();
  }
}
