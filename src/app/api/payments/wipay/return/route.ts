import { NextResponse } from "next/server";

import { computeHash } from "@/lib/wipay";
import { dbQuery, getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

function safeRedirect(url: string) {
  return NextResponse.redirect(url);
}

function mergeMetadata(existing: Record<string, unknown> | null, incoming: Record<string, unknown>) {
  return {
    ...(existing ?? {}),
    wipay_return: incoming,
    updated_at: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.SITE_URL ?? url.origin;
  const status = url.searchParams.get("status") ?? "";
  const message = url.searchParams.get("message") ?? "";
  const transactionId = url.searchParams.get("transaction_id") ?? "";
  const orderId = url.searchParams.get("order_id") ?? "";
  const total = url.searchParams.get("total") ?? "";
  const currency = url.searchParams.get("currency") ?? "";
  const hash = url.searchParams.get("hash") ?? "";
  const statusNormalized = status.toLowerCase();

  if (!orderId) {
    return safeRedirect(`${origin}/payment/failed?reason=notfound`);
  }

  const paymentResult = await dbQuery<{
    id: string;
    booking_id: string;
    status: string;
    deposit_amount_cents: number;
    metadata_json: Record<string, unknown> | null;
  }>(
    "select id, booking_id, status, deposit_amount_cents, metadata_json from payments where provider = 'WIPAY' and provider_ref = $1 order by created_at desc limit 1",
    [orderId],
  );

  if (paymentResult.rowCount === 0) {
    return safeRedirect(
      `${origin}/payment/failed?reason=notfound&order_id=${encodeURIComponent(orderId)}`,
    );
  }

  const payment = paymentResult.rows[0];
  const metadata = payment.metadata_json ?? {};
  const totalDecimal = typeof metadata.total_decimal === "string" ? metadata.total_decimal : "";

  if (statusNormalized !== "success") {
    await dbQuery(
      "update payments set status = 'FAILED', metadata_json = $1, updated_at = now() where id = $2",
      [mergeMetadata(metadata, { status, message, transaction_id: transactionId, total, currency }), payment.id],
    );
    return safeRedirect(`${origin}/payment/failed?order_id=${encodeURIComponent(orderId)}`);
  }

  if (!transactionId || !hash || !totalDecimal) {
    await dbQuery(
      "update payments set status = 'FAILED', metadata_json = $1, updated_at = now() where id = $2",
      [mergeMetadata(metadata, { status, message, transaction_id: transactionId, total, currency }), payment.id],
    );
    return safeRedirect(
      `${origin}/payment/failed?reason=bad_hash&order_id=${encodeURIComponent(orderId)}`,
    );
  }

  const apiKey = process.env.WIPAY_API_KEY ?? "";
  const expectedHash = computeHash(transactionId, totalDecimal, apiKey);
  if (expectedHash.toLowerCase() !== hash.toLowerCase()) {
    await dbQuery(
      "update payments set status = 'FAILED', metadata_json = $1, updated_at = now() where id = $2",
      [mergeMetadata(metadata, { status, message, transaction_id: transactionId, total, currency, hash }), payment.id],
    );
    return safeRedirect(
      `${origin}/payment/failed?reason=bad_hash&order_id=${encodeURIComponent(orderId)}`,
    );
  }

  if (payment.status === "DEPOSIT_PAID") {
    return safeRedirect(
      `${origin}/payment/success?bookingId=${encodeURIComponent(payment.booking_id)}`,
    );
  }

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const paymentUpdate = await client.query(
      "update payments set status = 'DEPOSIT_PAID', provider_transaction_id = $1, metadata_json = $2, updated_at = now() where id = $3 and status <> 'DEPOSIT_PAID' returning id",
      [
        transactionId,
        mergeMetadata(metadata, { status, message, transaction_id: transactionId, total, currency, hash }),
        payment.id,
      ],
    );

    const bookingResult = await client.query(
      "select id, vehicle_id, start_date, end_date, status from bookings where id = $1",
      [payment.booking_id],
    );

    if (bookingResult.rowCount === 0) {
      await client.query("rollback");
      return safeRedirect(
        `${origin}/payment/failed?reason=notfound&order_id=${encodeURIComponent(orderId)}`,
      );
    }

    const booking = bookingResult.rows[0];

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [booking.vehicle_id]);

    const overlapResult = await client.query(
      "select id from bookings where vehicle_id = $1 and status in ('CONFIRMED','PICKED_UP') and id <> $2 and not ($4 < start_date or $3 > end_date)",
      [booking.vehicle_id, booking.id, booking.start_date, booking.end_date],
    );

    if (overlapResult.rowCount > 0) {
      await client.query("commit");
      await writeAuditLog({
        userId: "system",
        action: "PAYMENT_DEPOSIT_OVERLAP_REVIEW",
        entityType: "booking",
        entityId: booking.id,
        details: {
          paymentId: payment.id,
          orderId,
          transactionId,
        },
      });
      return safeRedirect(
        `${origin}/payment/failed?reason=overlap&bookingId=${encodeURIComponent(booking.id)}`,
      );
    }

    await client.query("update bookings set status = 'CONFIRMED', updated_at = now() where id = $1", [
      booking.id,
    ]);

    await client.query("commit");

    await writeAuditLog({
      userId: "system",
      action: "PAYMENT_DEPOSIT_CONFIRMED_WIPAY",
      entityType: "booking",
      entityId: booking.id,
      details: {
        paymentId: payment.id,
        orderId,
        transactionId,
        paymentUpdated: paymentUpdate.rowCount > 0,
      },
    });

    return safeRedirect(`${origin}/payment/success?bookingId=${encodeURIComponent(booking.id)}`);
  } catch (error) {
    await client.query("rollback");
    console.error("WiPay return failed", error);
    return safeRedirect(`${origin}/payment/failed?order_id=${encodeURIComponent(orderId)}`);
  } finally {
    client.release();
  }
}
