import type Stripe from "stripe";

import { writeAuditLog } from "@/lib/audit";
import { dbQuery, getDbPool } from "@/lib/db";
import { maybeEntitleBookingAfterPayment } from "@/lib/availability/entitlement";
import { logError } from "@/lib/log";
import {
  sendInternalPaymentCompleteNotifications,
  sendInternalPaymentUpdateNotifications,
  sendPaymentCompleteEmail,
  sendPaymentUpdateEmail,
} from "@/lib/notifications/email";
import { computeDedupeKey, markDedupeResult, retryFailedDedupe, tryAcquireDedupe } from "@/lib/notifications/dedupe";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
import { getStripePaymentMode } from "@/lib/payments/provider";
import { toStripeJmdMinorUnits } from "@/lib/payments/stripe";

type ReconcileResult = { ok: boolean; bookingId?: string; status: "paid" | "pending" | "failed" | "not_found" | "overlap" };

function intentId(value: Stripe.Checkout.Session["payment_intent"]) {
  return typeof value === "string" ? value : value?.id ?? null;
}

type ConfirmedStripePayment = {
  id: string;
  booking_id: string;
  deposit_amount_cents: number;
  metadata_json: Record<string, unknown> | null;
};

async function sendStripePaymentConfirmationEmails(input: {
  payment: ConfirmedStripePayment;
  session: Stripe.Checkout.Session;
  paymentIntentId: string | null;
  summary: Awaited<ReturnType<typeof recalculateBookingPayments>>;
}) {
  const stripeMode = getStripePaymentMode();
  const eventType = input.summary.balanceDue > 0 ? "PAYMENT_UPDATE" : "PAYMENT_COMPLETE";
  const dedupeKey = computeDedupeKey({
    entityType: "booking",
    entityId: input.payment.booking_id,
    eventType,
    extra: input.payment.id,
  });
  const dedupe = await tryAcquireDedupe({
    dedupeKey,
    entityType: "booking",
    entityId: input.payment.booking_id,
    eventType,
    provider: "resend",
  });

  const retry = dedupe.acquired ? dedupe : await retryFailedDedupe({ dedupeKey, provider: "resend" });
  if (!retry.acquired) return;

  try {
    const bookingResult = await dbQuery<{
      id: string;
      public_id: string | null;
      start_date: string;
      end_date: string;
      pickup_location: string;
      pricing_json: Record<string, unknown> | null;
      customer_name: string;
      customer_email: string;
      customer_phone: string | null;
      vehicle_make: string;
      vehicle_model: string;
      vehicle_year: number;
      daily_rate_cents: number;
      deposit_cents: number;
    }>(
      "select b.id, b.public_id, b.start_date, b.end_date, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
      [input.payment.booking_id],
    );
    if (!bookingResult.rowCount) throw new Error("Booking not found while sending Stripe payment receipt.");

    const booking = bookingResult.rows[0];
    const common = {
      bookingId: booking.id,
      customerEmail: booking.customer_email,
      customerName: booking.customer_name,
      customerPhone: booking.customer_phone ?? "",
      vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
      startDate: booking.start_date,
      endDate: booking.end_date,
      pickupLocation: booking.pickup_location,
      dailyRate: Number(booking.daily_rate_cents || 0),
      deposit: Number(booking.deposit_cents || 0),
      paidToDate: input.summary.netPaidToDate,
      paymentAmount: Number(input.payment.deposit_amount_cents || 0),
      paymentMethod: stripeMode === "test" ? "Stripe (test)" : "Stripe",
      paymentDateTime: new Date().toISOString(),
      paymentReference: input.paymentIntentId ?? input.session.id,
      dispatch: {
        triggerSource: "stripe_reconcile",
        entityType: "booking" as const,
        entityId: booking.id,
        entityPublicId: booking.public_id,
        relatedTransactionType: "payment" as const,
        relatedTransactionId: input.payment.id,
        manualResendAllowed: true,
      },
    };

    const customerResult = input.summary.balanceDue > 0
      ? await sendPaymentUpdateEmail({ ...common, total: input.summary.totalAmount, balanceDue: input.summary.balanceDue })
      : await sendPaymentCompleteEmail({ ...common, total: input.summary.totalAmount, balanceDue: input.summary.balanceDue });
    if (!customerResult.ok) throw new Error(customerResult.error ?? "Stripe payment receipt email failed.");

    if (input.summary.balanceDue > 0) {
      await sendInternalPaymentUpdateNotifications({
        ...common,
        total: input.summary.totalAmount,
        balanceDue: input.summary.balanceDue,
      });
    } else {
      await sendInternalPaymentCompleteNotifications({
        ...common,
        total: input.summary.totalAmount,
        balanceDue: input.summary.balanceDue,
      });
    }

    await markDedupeResult({ dedupeKey, status: "SENT", provider: "resend" });
    const now = new Date();
    const invoiceMetadata = customerResult.invoiceAttached
      ? {
          receipt_email_sent: true,
          invoice_delivery_status: "sent",
          invoice_email_sent: true,
          invoice_sent_at: now.toISOString(),
          invoice_retry_count: 0,
          invoice_next_retry_at: null,
          invoice_last_error: null,
          invoice_retry_exhausted: false,
        }
      : {
          receipt_email_sent: true,
          invoice_delivery_status: "pending",
          invoice_email_sent: false,
          invoice_retry_count: 0,
          invoice_next_retry_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
          invoice_last_error: "Invoice attachment was unavailable during payment acknowledgement.",
          invoice_retry_exhausted: false,
        };
    await dbQuery(
      "update payments set metadata_json = coalesce(metadata_json, '{}'::jsonb) || $2::jsonb, updated_at = now() where id = $1",
      [input.payment.id, JSON.stringify(invoiceMetadata)],
    );
  } catch (error) {
    await markDedupeResult({
      dedupeKey,
      status: "FAILED",
      provider: "resend",
      error: error instanceof Error ? error.message : String(error),
    });
    logError("stripe_payment_receipt_email_failed", error, {
      bookingId: input.payment.booking_id,
      paymentId: input.payment.id,
      sessionId: input.session.id,
    });
  }
}

export async function reconcileStripeCheckoutSession(session: Stripe.Checkout.Session, source: "webhook" | "return" | "admin"): Promise<ReconcileResult> {
  const stripeMode = getStripePaymentMode();
  if (session.livemode !== (stripeMode === "live") || session.currency?.toLowerCase() !== "jmd") {
    throw new Error("Unexpected Stripe Checkout currency or mode.");
  }
  const paymentId = session.metadata?.payment_id || session.client_reference_id || "";
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      "select id, booking_id, status, deposit_amount_cents, metadata_json from payments where provider = 'STRIPE' and (provider_ref = $1 or id::text = $2) for update",
      [session.id, paymentId],
    );
    if (!result.rowCount) { await client.query("rollback"); return { ok: false, status: "not_found" }; }
    const payment = result.rows[0] as { id: string; booking_id: string; status: string; deposit_amount_cents: number; metadata_json: Record<string, unknown> | null };
    const metadata = { ...(payment.metadata_json ?? {}), checkout_session_id: session.id, payment_intent_id: intentId(session.payment_intent), stripe_payment_status: session.payment_status, stripe_session_status: session.status, stripe_livemode: session.livemode, stripe_last_source: source, updated_at: new Date().toISOString() };
    const failed = session.status === "expired" || session.payment_status === "unpaid" && session.status === "complete";
    if (failed) {
      if (payment.status !== "DEPOSIT_PAID") await client.query("update payments set status = 'FAILED', metadata_json = $1, updated_at = now() where id = $2", [metadata, payment.id]);
      await client.query("commit");
      return { ok: false, bookingId: payment.booking_id, status: "failed" };
    }
    if (session.payment_status !== "paid") {
      await client.query("update payments set metadata_json = $1, updated_at = now() where id = $2", [metadata, payment.id]);
      await client.query("commit");
      return { ok: false, bookingId: payment.booking_id, status: "pending" };
    }
    if (session.amount_total !== toStripeJmdMinorUnits(payment.deposit_amount_cents)) {
      throw new Error("Stripe Checkout amount does not match the JMD payment record.");
    }
    await client.query("update payments set status = 'DEPOSIT_PAID', provider_ref = $1, provider_transaction_id = $2, metadata_json = $3, updated_at = now() where id = $4", [session.id, intentId(session.payment_intent), metadata, payment.id]);
    const entitlement = await maybeEntitleBookingAfterPayment(payment.booking_id, { client, auditUserId: "system" });
    const summary = await recalculateBookingPayments(payment.booking_id, { client });
    await client.query("commit");
    const paymentIntentId = intentId(session.payment_intent);
    await writeAuditLog({ userId: "system", action: stripeMode === "test" ? "PAYMENT_CONFIRMED_STRIPE_TEST" : "PAYMENT_CONFIRMED_STRIPE", entityType: "booking", entityId: payment.booking_id, details: { paymentId: payment.id, sessionId: session.id, paymentIntentId, source, netPaidToDate: summary.netPaidToDate, entitlementState: entitlement.state } });
    await sendStripePaymentConfirmationEmails({ payment, session, paymentIntentId, summary });
    return entitlement.state === "LOST" ? { ok: false, bookingId: payment.booking_id, status: "overlap" } : { ok: true, bookingId: payment.booking_id, status: "paid" };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
