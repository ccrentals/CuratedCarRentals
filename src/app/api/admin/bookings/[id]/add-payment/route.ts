import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireStaffOrAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  if (!(await requireCsrf(request))) {
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

  const pool = getDbPool();
  const client = await pool.connect();

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

    const entitlementResolution = await maybeEntitleBookingAfterPayment(booking.id, {
      client,
      auditUserId: actor.userId,
    });
    const summary = await recalculateBookingPayments(booking.id, { client });

    await client.query("commit");

    await writeAuditLog({
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
        paidToDate: summary.netPaidToDate,
        balanceDue: summary.balanceDue,
      });
    }

    const vehicleLabel = `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim();
    const methodLabel = METHOD_LABELS[method] ?? method;

    if (summary.balanceDue <= 0) {
      await sendPaymentCompleteEmail({
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
      });
    } else {
      await sendPaymentUpdateEmail({
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
      });
    }

    return NextResponse.json({
      ok: true,
      paidToDate: summary.netPaidToDate,
      balanceDue: summary.balanceDue,
      paidInFull: summary.balanceDue <= 0,
    });
  } catch (error) {
    await client.query("rollback");
    logError("admin_add_payment_failed", error, { bookingId: id, userId: actor.userId });
    return NextResponse.json({ error: "Failed to add payment" }, { status: 500 });
  } finally {
    client.release();
  }
}
