import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";

function isAdminRole(role: string | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase() === "ADMIN";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const { paymentId } = await params;
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

    if (original.provider !== "WIPAY") {
      await client.query("rollback");
      return NextResponse.json({ error: "Only WIPAY payments can be refunded here" }, { status: 400 });
    }

    if (original.status !== "DEPOSIT_PAID" || !Number.isFinite(original.deposit_amount_cents) || original.deposit_amount_cents <= 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Only successful payments can be refunded" }, { status: 400 });
    }

    const refundRef = `REFUND_${original.id}`;
    const existingRefund = await client.query(
      "select id from payments where provider = 'WIPAY' and provider_ref = $1 limit 1",
      [refundRef],
    );
    if (existingRefund.rowCount > 0) {
      const summary = await recalculateBookingPayments(original.booking_id, { client });
      await client.query("commit");
      return NextResponse.json({ ok: true, message: "Refund already recorded", summary });
    }

    const refundAmount = -Math.abs(Number(original.deposit_amount_cents));
    const refundInsert = await client.query(
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref, metadata_json) values ($1, 'WIPAY', $2, 'JMD', 'REFUNDED', $3, $4) returning id",
      [
        original.booking_id,
        refundAmount,
        refundRef,
        {
          payment_type: "refund",
          original_payment_id: original.id,
          original_transaction_id: original.provider_transaction_id,
          reason,
          created_by: session.userId,
          created_at: new Date().toISOString(),
        },
      ],
    );

    const summary = await recalculateBookingPayments(original.booking_id, { client });

    await client.query("commit");

    await writeAuditLog({
      userId: session.userId,
      action: "WIPAY_REFUND_CREATED",
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

    return NextResponse.json({ ok: true, message: "Refund recorded", summary });
  } catch (error) {
    await client.query("rollback");
    console.error("refund payment failed", error);
    return NextResponse.json({ error: "Failed to record refund" }, { status: 500 });
  } finally {
    client.release();
  }
}

