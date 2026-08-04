import type Stripe from "stripe";

import { writeAuditLog } from "@/lib/audit";
import { getDbPool } from "@/lib/db";
import { maybeEntitleBookingAfterPayment } from "@/lib/availability/entitlement";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";

type ReconcileResult = { ok: boolean; bookingId?: string; status: "paid" | "pending" | "failed" | "not_found" | "overlap" };

function intentId(value: Stripe.Checkout.Session["payment_intent"]) {
  return typeof value === "string" ? value : value?.id ?? null;
}

export async function reconcileStripeCheckoutSession(session: Stripe.Checkout.Session, source: "webhook" | "return" | "admin"): Promise<ReconcileResult> {
  if (session.livemode || session.currency?.toLowerCase() !== "jmd") throw new Error("Unexpected Stripe Checkout currency or live mode.");
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
    if (session.amount_total !== payment.deposit_amount_cents) throw new Error("Stripe Checkout amount does not match the JMD payment record.");
    await client.query("update payments set status = 'DEPOSIT_PAID', provider_ref = $1, provider_transaction_id = $2, metadata_json = $3, updated_at = now() where id = $4", [session.id, intentId(session.payment_intent), metadata, payment.id]);
    const entitlement = await maybeEntitleBookingAfterPayment(payment.booking_id, { client, auditUserId: "system" });
    const summary = await recalculateBookingPayments(payment.booking_id, { client });
    await client.query("commit");
    await writeAuditLog({ userId: "system", action: "PAYMENT_CONFIRMED_STRIPE_TEST", entityType: "booking", entityId: payment.booking_id, details: { paymentId: payment.id, sessionId: session.id, paymentIntentId: intentId(session.payment_intent), source, netPaidToDate: summary.netPaidToDate, entitlementState: entitlement.state } });
    return entitlement.state === "LOST" ? { ok: false, bookingId: payment.booking_id, status: "overlap" } : { ok: true, bookingId: payment.booking_id, status: "paid" };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
