import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
import { getPublicPaymentRequestUrl, getStripePaymentMode } from "@/lib/payments/provider";
import { getStripeClient } from "@/lib/payments/stripe";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const auth = await requireAdminRole({ forbiddenMessage: "Forbidden" });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const { paymentId } = await params;
  const paymentRequestUrl = getPublicPaymentRequestUrl(request);
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!paymentId) {
    return NextResponse.json({ error: "paymentId is required" }, { status: 400 });
  }

  if (!reason) {
    return NextResponse.json({ error: "Reason is required" }, { status: 400 });
  }

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const originalResult = await client.query(
      "select id, booking_id, provider, status, deposit_amount_cents, provider_transaction_id from payments where id = $1 for update",
      [paymentId],
    );

    if (originalResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    const original = originalResult.rows[0] as {
      id: string;
      booking_id: string;
      provider: string;
      status: string;
      deposit_amount_cents: number;
      provider_transaction_id: string | null;
    };

    if (original.provider !== "WIPAY" && original.provider !== "STRIPE") {
      await client.query("rollback");
      return NextResponse.json(
        { error: "Only eligible online payments can be refunded here" },
        { status: 400 },
      );
    }

    if (original.status !== "DEPOSIT_PAID" || !Number.isFinite(original.deposit_amount_cents) || original.deposit_amount_cents <= 0) {
      await client.query("rollback");
      return NextResponse.json(
        { error: "Only successful payments can be manually adjusted here" },
        { status: 400 },
      );
    }

    const existingByOriginal = await client.query(
      "select id from payments where provider = $1 and metadata_json->>'original_payment_id' = $2 limit 1",
      [original.provider, original.id],
    );
    if (existingByOriginal.rowCount > 0) {
      const summary = await recalculateBookingPayments(original.booking_id, { client });
      await client.query("commit");
      return NextResponse.json({ ok: true, message: "Refund already recorded", summary });
    }

    let refundRef = `REFUND_${original.id}`;
    let stripeRefundId: string | null = null;
    if (original.provider === "STRIPE") {
      if (!original.provider_transaction_id) {
        await client.query("rollback");
        return NextResponse.json({ error: "Stripe Payment Intent is missing" }, { status: 409 });
      }
      const refund = await getStripeClient(paymentRequestUrl).refunds.create(
        {
          payment_intent: original.provider_transaction_id,
          metadata: {
            original_payment_id: original.id,
            reason,
            refund_environment: getStripePaymentMode(paymentRequestUrl),
          },
        },
        { idempotencyKey: `stripe-refund-${original.id}` },
      );
      if (refund.status !== "succeeded") {
        await client.query("rollback");
        return NextResponse.json({ error: `Stripe refund is ${refund.status ?? "pending"}; no accounting record was created.` }, { status: 409 });
      }
      refundRef = refund.id;
      stripeRefundId = refund.id;
    }
    const existingRefund = await client.query(
      "select id from payments where provider = $2 and provider_ref = $1 limit 1",
      [refundRef, original.provider],
    );
    if (existingRefund.rowCount > 0) {
      const summary = await recalculateBookingPayments(original.booking_id, { client });
      await client.query("commit");
      return NextResponse.json({
        ok: true,
        message: "Manual refund adjustment already recorded",
        summary,
      });
    }

    const refundAmount = -Math.abs(Number(original.deposit_amount_cents));
    const refundInsert = await client.query(
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref, metadata_json) values ($1, $2, $3, 'JMD', 'REFUNDED', $4, $5) returning id",
      [
        original.booking_id,
        original.provider,
        refundAmount,
        refundRef,
        {
          payment_type: "refund",
          original_payment_id: original.id,
          original_transaction_id: original.provider_transaction_id,
          reason,
          created_by: actor.userId,
          created_at: new Date().toISOString(),
          stripe_refund_id: stripeRefundId,
        },
      ],
    );

    const summary = await recalculateBookingPayments(original.booking_id, { client });

    await client.query("commit");

    await writeAuditLog({
      userId: actor.userId,
      action: "PAYMENT_MANUAL_REFUND_RECORDED",
      entityType: "payment",
      entityId: refundInsert.rows[0]?.id,
      details: {
        bookingId: original.booking_id,
        originalPaymentId: original.id,
        refundPaymentId: refundInsert.rows[0]?.id,
        amount: refundAmount,
        reason,
      },
    });

    return NextResponse.json({ ok: true, message: "Manual refund adjustment recorded", summary });
  } catch (error) {
    await client.query("rollback");
    logError("api.admin.payments.refund.POST", error, { userId: actor.userId, paymentId });
    return NextResponse.json({ error: "Failed to process the payment refund" }, { status: 500 });
  } finally {
    client.release();
  }
}
