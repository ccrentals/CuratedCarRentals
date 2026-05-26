import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { consumeRouteRateLimit, withRateLimitHeaders } from "@/lib/security/rate-limit";
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

const ADMIN_BOOKING_DEPOSIT_LIMIT = 10;
const ADMIN_BOOKING_DEPOSIT_WINDOW_SECONDS = 10 * 60;

type AdminBookingMarkDepositPaidRouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminBookingMarkDepositPaidRouteDeps = {
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

const DEFAULT_DEPS: AdminBookingMarkDepositPaidRouteDeps = {
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

export async function handleAdminBookingMarkDepositPaidPost(
  request: Request,
  { params }: AdminBookingMarkDepositPaidRouteContext,
  deps: AdminBookingMarkDepositPaidRouteDeps = DEFAULT_DEPS,
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
    route: "/api/admin/bookings/[id]/mark-deposit-paid",
    limit: ADMIN_BOOKING_DEPOSIT_LIMIT,
    windowSeconds: ADMIN_BOOKING_DEPOSIT_WINDOW_SECONDS,
    keyParts: [actor.userId, id],
  });
  if (!rateLimit.allowed) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "Too many deposit payment actions. Please try again later." }, { status: 429 }),
      rateLimit,
    );
  }

  const pool = deps.getPool();
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

    const entitlementResolution = await deps.maybeEntitle(booking.id, {
      client,
      auditUserId: actor.userId,
    });
    const recalculated = await deps.recalculate(booking.id, { client });

    await client.query("commit");

    await deps.writeAudit({
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

    if (recalculated.balanceDue <= 0) {
      await deps.sendCompleteEmail({
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
      await deps.sendInternalComplete({
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
      await deps.sendUpdateEmail({
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
      await deps.sendInternalUpdate({
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
    deps.log("api.admin.bookings.markDepositPaid.POST", error, {
      bookingId: id,
      userId: actor.userId,
    });
    return NextResponse.json({ error: "Failed to mark deposit paid" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(request: Request, context: AdminBookingMarkDepositPaidRouteContext) {
  return handleAdminBookingMarkDepositPaidPost(request, context, DEFAULT_DEPS);
}
