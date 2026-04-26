import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import {
  getInternalNotesRecipient,
  sendBookingOverriddenByPaidBookingEmail,
  sendPaymentCompleteEmail,
  sendPaymentUpdateEmail,
} from "@/lib/notifications/email";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
import { logError } from "@/lib/log";
import { maybeEntitleBookingAfterPayment } from "@/lib/availability/entitlement";

const METHOD_ALLOWLIST = new Set(["CASH", "BANK_TRANSFER", "POS_CARD", "CHEQUE", "OTHER"]);
const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Transfer",
  POS_CARD: "POS/Card on delivery",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

type AddPaymentRouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminBookingAddPaymentRouteDeps = {
  requireAdminAccess: typeof requireAdminAccess;
  requireCsrfCheck: typeof requireCsrf;
  getPool: typeof getDbPool;
  maybeEntitle: typeof maybeEntitleBookingAfterPayment;
  recalculate: typeof recalculateBookingPayments;
  writeAudit: typeof writeAuditLog;
  sendOverrideEmail: typeof sendBookingOverriddenByPaidBookingEmail;
  sendCompleteEmail: typeof sendPaymentCompleteEmail;
  sendUpdateEmail: typeof sendPaymentUpdateEmail;
  getNotesRecipient: typeof getInternalNotesRecipient;
  log: typeof logError;
};

const DEFAULT_ADD_PAYMENT_DEPS: AdminBookingAddPaymentRouteDeps = {
  requireAdminAccess: requireAdminAccess,
  requireCsrfCheck: requireCsrf,
  getPool: getDbPool,
  maybeEntitle: maybeEntitleBookingAfterPayment,
  recalculate: recalculateBookingPayments,
  writeAudit: writeAuditLog,
  sendOverrideEmail: sendBookingOverriddenByPaidBookingEmail,
  sendCompleteEmail: sendPaymentCompleteEmail,
  sendUpdateEmail: sendPaymentUpdateEmail,
  getNotesRecipient: getInternalNotesRecipient,
  log: logError,
};

export async function handleAdminBookingAddPaymentPost(
  request: Request,
  { params }: AddPaymentRouteContext,
  deps: AdminBookingAddPaymentRouteDeps = DEFAULT_ADD_PAYMENT_DEPS,
) {
  const auth = await deps.requireAdminAccess();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  if (!(await deps.requireCsrfCheck(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const amount = Number(body?.amount);
  const methodRaw = typeof body?.method === "string" ? body.method.trim().toUpperCase() : "";
  const method = METHOD_ALLOWLIST.has(methodRaw) ? methodRaw : "OTHER";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const reference = typeof body?.reference === "string" ? body.reference.trim() : "";
  const paidAtRaw = typeof body?.paidAt === "string" ? body.paidAt.trim() : "";
  const paidAtDate = paidAtRaw ? new Date(paidAtRaw) : null;
  const paidAtIso =
    paidAtDate && !Number.isNaN(paidAtDate.getTime()) ? paidAtDate.toISOString() : new Date().toISOString();

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
  }

  const pool = deps.getPool();
  const client = await pool.connect();
  let committed = false;

  async function runNonCritical(label: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      deps.log(label, error, { bookingId: id, userId: actor.userId });
    }
  }

  try {
    await client.query("begin");

    const bookingResult = await client.query(
      "select b.id, b.vehicle_id, b.status, b.start_date, b.end_date, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
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

    const providerRef = reference || `${method}_${Date.now()}`;

    // Idempotency: if a receipt/reference is provided, don't double-apply the same payment.
    if (reference) {
      const existing = await client.query(
        "select id from payments where booking_id = $1 and provider = 'MANUAL' and provider_ref = $2 limit 1",
        [booking.id, reference],
      );
      if (existing.rowCount > 0) {
        await client.query("rollback");
        return NextResponse.json({ ok: true, duplicate: true });
      }
    }

    // Idempotency guard for rapid duplicate manual submissions (same actor/method/amount/time window).
    // This prevents accidental double-adds from retries/clicks without blocking legitimate later payments.
    const duplicateWindowSeconds = 90;
    const duplicateParams = [booking.id, amount, method, paidAtIso, actor.userId, duplicateWindowSeconds];
    let duplicateRecent;
    try {
      duplicateRecent = await client.query(
        "select id from payments where booking_id = $1 and provider = 'MANUAL' and status = 'DEPOSIT_PAID' and deleted_at is null and deposit_amount_cents = $2 and coalesce(metadata_json->>'method', '') = $3 and coalesce(metadata_json->>'entered_by', '') = $5 and abs(extract(epoch from (coalesce(nullif(metadata_json->>'paid_at', '')::timestamptz, created_at) - $4::timestamptz))) <= $6 order by created_at desc limit 1",
        duplicateParams,
      );
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const message = String((error as { message?: unknown } | null)?.message ?? "");
      if (code === "42703" && message.includes("\"deleted_at\"") && message.includes("does not exist")) {
        duplicateRecent = await client.query(
          "select id from payments where booking_id = $1 and provider = 'MANUAL' and status = 'DEPOSIT_PAID' and deposit_amount_cents = $2 and coalesce(metadata_json->>'method', '') = $3 and coalesce(metadata_json->>'entered_by', '') = $5 and abs(extract(epoch from (coalesce(nullif(metadata_json->>'paid_at', '')::timestamptz, created_at) - $4::timestamptz))) <= $6 order by created_at desc limit 1",
          duplicateParams,
        );
      } else {
        throw error;
      }
    }
    if ((duplicateRecent?.rowCount ?? 0) > 0) {
      await client.query("rollback");
      return NextResponse.json({
        ok: true,
        duplicate: true,
        paymentId: duplicateRecent?.rows?.[0]?.id ?? null,
      });
    }

    await client.query(
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref, metadata_json) values ($1, 'MANUAL', $2, 'JMD', 'DEPOSIT_PAID', $3, $4)",
      [
        booking.id,
        amount,
        providerRef,
        {
          payment_type: "manual",
          method,
          method_label: METHOD_LABELS[method] ?? method,
          note,
          reference: reference || undefined,
          paid_at: paidAtIso,
          entered_by: actor.userId,
          created_at: new Date().toISOString(),
        },
      ],
    );

    const entitlementResolution = await deps.maybeEntitle(booking.id, { client });
    const summary = await deps.recalculate(booking.id, { client });

    await client.query("commit");
    committed = true;

    await runNonCritical("admin_add_payment_audit_failed", async () => {
      await deps.writeAudit({
        userId: actor.userId,
        action: "BOOKING_MANUAL_PAYMENT_ADDED",
        entityType: "booking",
        entityId: booking.id,
        details: {
          amount,
          method,
          reference: reference || undefined,
          confirmed: entitlementResolution.state === "ENTITLED",
          entitlementState: entitlementResolution.state,
          winnerBookingId: entitlementResolution.winnerBookingId,
          overriddenBookings: entitlementResolution.cancelledOverlaps.map((item) => item.id),
        },
      });
    });

    if (entitlementResolution.state === "ENTITLED") {
      await runNonCritical("admin_add_payment_entitled_audit_failed", async () => {
        await deps.writeAudit({
          userId: actor.userId,
          action: "BOOKING_ENTITLED_BY_DEPOSIT",
          entityType: "booking",
          entityId: booking.id,
          details: {
            paidToDate: summary.netPaidToDate,
            depositRequired: summary.depositAmount,
            cancelledOverlapCount: entitlementResolution.cancelledOverlaps.length,
            cancelledOverlapBookingIds: entitlementResolution.cancelledOverlaps.map((item) => item.id),
          },
        });
      });
    }

    if (entitlementResolution.state === "LOST") {
      await runNonCritical("admin_add_payment_lost_audit_failed", async () => {
        await deps.writeAudit({
          userId: actor.userId,
          action: "BOOKING_ENTITLEMENT_LOST_AFTER_PAYMENT",
          entityType: "booking",
          entityId: booking.id,
          details: {
            winnerBookingId: entitlementResolution.winnerBookingId,
            paidToDate: summary.netPaidToDate,
            depositRequired: summary.depositAmount,
            reason: "LOST_TO_FIRST_DEPOSIT",
          },
        });
      });
    }

    for (const overriddenBooking of entitlementResolution.cancelledOverlaps) {
      await runNonCritical("admin_add_payment_overridden_audit_failed", async () => {
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
      });

      await runNonCritical("admin_add_payment_customer_override_email_failed", async () => {
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
      });

      await runNonCritical("admin_add_payment_internal_override_email_failed", async () => {
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
      });
    }

    if (entitlementResolution.state === "LOST") {
      return NextResponse.json({
        ok: true,
        lost: true,
        winnerBookingId: entitlementResolution.winnerBookingId,
        paidToDate: summary.netPaidToDate,
        balanceDue: summary.balanceDue,
      });
    }

    const vehicleLabel = `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim();
    const methodLabel = METHOD_LABELS[method] ?? method;

    if (summary.balanceDue <= 0) {
      await runNonCritical("admin_add_payment_complete_email_failed", async () => {
        await deps.sendCompleteEmail({
          bookingId: booking.id,
          customerEmail: booking.customer_email,
          customerName: booking.customer_name,
          vehicleLabel,
          startDate: booking.start_date,
          endDate: booking.end_date,
          pickupLocation: booking.pickup_location,
          dailyRate: summary.dailyRate,
          deposit: summary.depositAmount,
          total: summary.totalAmount,
          paidToDate: summary.netPaidToDate,
          balanceDue: summary.balanceDue,
          paymentAmount: amount,
          paymentMethod: methodLabel,
          paymentDateTime: paidAtIso,
          paymentReference: reference || undefined,
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
      });
    } else {
      await runNonCritical("admin_add_payment_update_email_failed", async () => {
        await deps.sendUpdateEmail({
          bookingId: booking.id,
          customerEmail: booking.customer_email,
          customerName: booking.customer_name,
          vehicleLabel,
          startDate: booking.start_date,
          endDate: booking.end_date,
          pickupLocation: booking.pickup_location,
          dailyRate: summary.dailyRate,
          deposit: summary.depositAmount,
          total: summary.totalAmount,
          paidToDate: summary.netPaidToDate,
          balanceDue: summary.balanceDue,
          paymentAmount: amount,
          paymentMethod: methodLabel,
          paymentDateTime: paidAtIso,
          paymentReference: reference || undefined,
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
      });
    }

    return NextResponse.json({
      ok: true,
      paidToDate: summary.netPaidToDate,
      balanceDue: summary.balanceDue,
      paidInFull: summary.balanceDue <= 0,
    });
  } catch (error) {
    if (!committed) {
      await client.query("rollback");
    }
    deps.log("admin_add_payment_failed", error, { bookingId: id, userId: actor.userId });
    return NextResponse.json({ error: "Failed to add payment" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(request: Request, context: AddPaymentRouteContext) {
  return handleAdminBookingAddPaymentPost(request, context);
}
