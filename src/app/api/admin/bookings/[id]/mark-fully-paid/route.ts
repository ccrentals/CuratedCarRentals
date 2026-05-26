import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import { consumeRouteRateLimit, withRateLimitHeaders } from "@/lib/security/rate-limit";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
import { logError } from "@/lib/log";
import {
  getInternalNotesRecipient,
  sendBookingOverriddenByPaidBookingEmail,
  sendInternalPaymentCompleteNotifications,
  sendInternalPaymentUpdateNotifications,
  sendPaymentCompleteEmail,
  sendPaymentUpdateEmail,
} from "@/lib/notifications/email";
import { maybeEntitleBookingAfterPayment } from "@/lib/availability/entitlement";

const ADMIN_BOOKING_FULLY_PAID_LIMIT = 10;
const ADMIN_BOOKING_FULLY_PAID_WINDOW_SECONDS = 10 * 60;

type AdminBookingMarkFullyPaidRouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminBookingMarkFullyPaidRouteDeps = {
  requireAdminAccess: typeof requireOperationsAccess;
  requireCsrfCheck: typeof requireCsrf;
  consumeRateLimitCheck: typeof consumeRouteRateLimit;
  getPool: typeof getDbPool;
  maybeEntitle: typeof maybeEntitleBookingAfterPayment;
  recalculate: typeof recalculateBookingPayments;
  writeAudit: typeof writeAuditLog;
  sendOverrideEmail: typeof sendBookingOverriddenByPaidBookingEmail;
  sendCompleteEmail: typeof sendPaymentCompleteEmail;
  sendUpdateEmail: typeof sendPaymentUpdateEmail;
  sendInternalComplete: typeof sendInternalPaymentCompleteNotifications;
  sendInternalUpdate: typeof sendInternalPaymentUpdateNotifications;
  getNotesRecipient: typeof getInternalNotesRecipient;
  log: typeof logError;
};

const DEFAULT_DEPS: AdminBookingMarkFullyPaidRouteDeps = {
  requireAdminAccess: requireOperationsAccess,
  requireCsrfCheck: requireCsrf,
  consumeRateLimitCheck: consumeRouteRateLimit,
  getPool: getDbPool,
  maybeEntitle: maybeEntitleBookingAfterPayment,
  recalculate: recalculateBookingPayments,
  writeAudit: writeAuditLog,
  sendOverrideEmail: sendBookingOverriddenByPaidBookingEmail,
  sendCompleteEmail: sendPaymentCompleteEmail,
  sendUpdateEmail: sendPaymentUpdateEmail,
  sendInternalComplete: sendInternalPaymentCompleteNotifications,
  sendInternalUpdate: sendInternalPaymentUpdateNotifications,
  getNotesRecipient: getInternalNotesRecipient,
  log: logError,
};

export async function handleAdminBookingMarkFullyPaidPost(
  request: Request,
  { params }: AdminBookingMarkFullyPaidRouteContext,
  deps: AdminBookingMarkFullyPaidRouteDeps = DEFAULT_DEPS,
) {
  const auth = await deps.requireAdminAccess();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  if (!(await deps.requireCsrfCheck(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await params;
  const rateLimit = await deps.consumeRateLimitCheck({
    scope: "ADMIN_BOOKING_MUTATION_USER",
    route: "/api/admin/bookings/[id]/mark-fully-paid",
    limit: ADMIN_BOOKING_FULLY_PAID_LIMIT,
    windowSeconds: ADMIN_BOOKING_FULLY_PAID_WINDOW_SECONDS,
    keyParts: [actor.userId, id],
  });
  if (!rateLimit.allowed) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "Too many full payment actions. Please try again later." }, { status: 429 }),
      rateLimit,
    );
  }

  const pool = deps.getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const bookingResult = await client.query(
      "select b.id, b.vehicle_id, b.status, b.start_date, b.end_date, b.pickup_location, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1 for update",
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

    const before = await deps.recalculate(booking.id, { client });
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
          entered_by: actor.userId,
          created_at: new Date().toISOString(),
        },
      ],
    );

    const entitlementResolution = await deps.maybeEntitle(booking.id, {
      client,
      auditUserId: actor.userId,
    });
    const after = await deps.recalculate(booking.id, { client });
    const confirmed = entitlementResolution.state === "ENTITLED";

    await client.query("commit");

    await deps.writeAudit({
      userId: actor.userId,
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
      await deps.writeAudit({
        userId: actor.userId,
        action: "BOOKING_OVERRIDDEN_BY_PAID_BOOKING",
        entityType: "booking",
        entityId: overriddenBooking.id,
        details: {
          overriddenByBookingId: booking.id,
          overrideReason: "Overridden by paid booking",
        },
      });

      await deps.sendOverrideEmail({
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

      await deps.sendOverrideEmail({
        recipientType: "internal",
        recipientEmail: deps.getNotesRecipient(),
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

    if (after.balanceDue <= 0) {
      await deps.sendCompleteEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone ?? "",
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
      await deps.sendInternalComplete({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone ?? "",
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
      await deps.sendUpdateEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone ?? "",
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
      await deps.sendInternalUpdate({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone ?? "",
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

    return NextResponse.json({ ok: true, message: "Balance payment recorded" });
  } catch (error) {
    await client.query("rollback");
    deps.log("admin_mark_fully_paid_failed", error, { bookingId: id, userId: actor.userId });
    return NextResponse.json({ error: "Failed to mark fully paid" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(request: Request, context: AdminBookingMarkFullyPaidRouteContext) {
  return handleAdminBookingMarkFullyPaidPost(request, context, DEFAULT_DEPS);
}
