import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { buildRequestParams, requestHostedPageUrl } from "@/lib/wipay";

function amountToDecimal(amount: number) {
  return Number(amount).toFixed(2);
}

function buildOrderId() {
  const timePart = Date.now().toString(36).slice(-6);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `BK${timePart}${randomPart}`.slice(0, 16);
}

export async function POST(request: Request) {
  if (!(await requireCsrf(request))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const requiredEnv = [
    "WIPAY_ACCOUNT_NUMBER",
    "WIPAY_API_KEY",
    "WIPAY_ENV",
    "WIPAY_FEE_STRUCTURE",
  ];
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      console.error(`WiPay start failed: Missing ${key}`);
      return NextResponse.json({ ok: false, error: `Missing ${key}` }, { status: 400 });
    }
  }

  const accountNumber = (process.env.WIPAY_ACCOUNT_NUMBER ?? "").trim();
  if (!/^\d+$/.test(accountNumber)) {
    console.error("WiPay start failed: Invalid WIPAY_ACCOUNT_NUMBER");
    return NextResponse.json(
      { ok: false, error: "Invalid WIPAY_ACCOUNT_NUMBER: must be digits only" },
      { status: 400 },
    );
  }

  if (!["sandbox", "live"].includes(process.env.WIPAY_ENV ?? "")) {
    console.error("WiPay start failed: Invalid WIPAY_ENV");
    return NextResponse.json({ ok: false, error: "Invalid WIPAY_ENV" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const bookingId = body?.bookingId as string | undefined;

  if (!bookingId) {
    return NextResponse.json({ error: "bookingId is required" }, { status: 400 });
  }

  const bookingResult = await dbQuery<{
    id: string;
    status: string;
    pricing_json: Record<string, unknown> | null;
    vehicle_id: string;
    start_date: string;
    end_date: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    deposit_cents: number;
  }>(
    "select b.id, b.status, b.pricing_json, b.vehicle_id, b.start_date, b.end_date, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id join customers c on c.id = b.customer_id where b.id = $1",
    [bookingId],
  );

  if (bookingResult.rowCount === 0) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const booking = bookingResult.rows[0];
  if (["CANCELLED", "RETURNED"].includes(booking.status)) {
    return NextResponse.json({ error: "Booking cannot be paid" }, { status: 400 });
  }

  const depositCents = Number(
    (booking.pricing_json as Record<string, unknown> | null)?.deposit_cents ?? booking.deposit_cents,
  );

  if (!Number.isFinite(depositCents) || depositCents <= 0) {
    return NextResponse.json({ error: "Invalid deposit amount" }, { status: 400 });
  }

  const existingPayment = await dbQuery<{ id: string }>(
    "select id from payments where booking_id = $1 and provider = 'WIPAY' and status = 'DEPOSIT_PAID' limit 1",
    [booking.id],
  );
  if (existingPayment.rowCount > 0) {
    return NextResponse.json({ error: "Deposit already paid" }, { status: 409 });
  }

  const orderId = buildOrderId();
  const totalDecimal = amountToDecimal(depositCents);

  const origin = process.env.SITE_URL ?? new URL(request.url).origin;
  const responseUrl = `${origin}/api/payments/wipay/return`;
  const params = buildRequestParams({
    orderId,
    amountDecimal: totalDecimal,
    responseUrl,
    name: booking.customer_name,
    email: booking.customer_email,
    phone: booking.customer_phone,
  });

  let paymentId: string | null = null;

  try {
    const insertResult = await dbQuery(
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref, metadata_json) values ($1, 'WIPAY', $2, 'JMD', 'INITIATED', $3, $4) returning id",
      [
        booking.id,
        depositCents,
        orderId,
        {
          bookingId: booking.id,
          deposit_cents: depositCents,
          total_decimal: totalDecimal,
          payment_type: "deposit",
          env: process.env.WIPAY_ENV ?? "sandbox",
          created_at: new Date().toISOString(),
        },
      ],
    );
    paymentId = insertResult.rows[0]?.id ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Insert failed";
    console.error(`WiPay start failed: DB error: ${message}`);
    return NextResponse.json({ ok: false, error: `DB error: ${message}` }, { status: 500 });
  }

  try {
    const wipayResponse = await requestHostedPageUrl(params);

    return NextResponse.json({
      ok: true,
      redirectUrl: wipayResponse.url,
      paymentId,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    try {
      await dbQuery(
        "update payments set status = 'FAILED', metadata_json = jsonb_set(metadata_json, '{error}', $1::jsonb), updated_at = now() where provider = 'WIPAY' and provider_ref = $2",
        [JSON.stringify({ message: reason }), orderId],
      );
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : "Update failed";
      console.error(`WiPay start failed: DB error: ${msg}`);
      return NextResponse.json({ ok: false, error: `DB error: ${msg}` }, { status: 500 });
    }

    console.error(`WiPay start failed: ${reason}`);
    return NextResponse.json(
      {
        ok: false,
        error: `WiPay request failed: ${reason}`,
        debug: {
          bookingId: booking.id,
          orderId,
          amountDecimal: totalDecimal,
          env: process.env.WIPAY_ENV ?? "sandbox",
        },
      },
      { status: 502 },
    );
  }
}
