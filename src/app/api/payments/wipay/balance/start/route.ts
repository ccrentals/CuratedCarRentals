import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { logError, logWarn } from "@/lib/log";
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

function daysInclusive(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff + 1 : 0;
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
      logWarn("wipay_balance_start_missing_env", { missing: key });
      return NextResponse.json({ ok: false, error: `Missing ${key}` }, { status: 400 });
    }
  }

  const accountNumber = (process.env.WIPAY_ACCOUNT_NUMBER ?? "").trim();
  if (!/^\d+$/.test(accountNumber)) {
    logWarn("wipay_balance_start_invalid_account_number");
    return NextResponse.json(
      { ok: false, error: "Invalid WIPAY_ACCOUNT_NUMBER: must be digits only" },
      { status: 400 },
    );
  }

  if (!["sandbox", "live"].includes(process.env.WIPAY_ENV ?? "")) {
    logWarn("wipay_balance_start_invalid_env", { env: process.env.WIPAY_ENV });
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
    start_date: string;
    end_date: string;
    pricing_json: Record<string, unknown> | null;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    daily_rate_cents: number;
    deposit_cents: number;
    paid_to_date: number;
  }>(
    "select b.id, b.status, b.start_date, b.end_date, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.daily_rate_cents, v.deposit_cents, coalesce(sum(p.deposit_amount_cents), 0) as paid_to_date from bookings b join vehicles v on v.id = b.vehicle_id join customers c on c.id = b.customer_id left join payments p on p.booking_id = b.id and p.status = 'DEPOSIT_PAID' where b.id = $1 group by b.id, c.full_name, c.email, c.phone, v.daily_rate_cents, v.deposit_cents",
    [bookingId],
  );

  if (bookingResult.rowCount === 0) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const booking = bookingResult.rows[0];
  if (["CANCELLED", "RETURNED"].includes(booking.status)) {
    return NextResponse.json({ error: "Booking cannot be paid" }, { status: 400 });
  }

  const pricing = booking.pricing_json ?? {};
  const days = Number(pricing.days ?? daysInclusive(booking.start_date, booking.end_date));
  const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const total = Number(pricing.subtotal_cents ?? dailyRate * days);
  const paidToDate = Number(booking.paid_to_date ?? 0);
  const balanceDue = Math.max(0, total - paidToDate);

  if (balanceDue <= 0) {
    return NextResponse.json({ error: "Balance already paid" }, { status: 409 });
  }

  const existingPayment = await dbQuery<{ id: string }>(
    "select id from payments where booking_id = $1 and provider = 'WIPAY' and status = 'DEPOSIT_PAID' and metadata_json ->> 'payment_type' = 'balance' limit 1",
    [booking.id],
  );
  if (existingPayment.rowCount > 0) {
    return NextResponse.json({ error: "Balance already paid" }, { status: 409 });
  }

  const orderId = buildOrderId();
  const totalDecimal = amountToDecimal(balanceDue);

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
        balanceDue,
        orderId,
        {
          bookingId: booking.id,
          total_decimal: totalDecimal,
          payment_type: "balance",
          balance_due: balanceDue,
          paid_to_date: paidToDate,
          env: process.env.WIPAY_ENV ?? "sandbox",
          created_at: new Date().toISOString(),
        },
      ],
    );
    paymentId = insertResult.rows[0]?.id ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Insert failed";
    logError("wipay_balance_start_db_insert_failed", error, { bookingId: booking.id, orderId });
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
      logError("wipay_balance_start_db_update_failed", dbError, { bookingId: booking.id, orderId, paymentId });
      return NextResponse.json({ ok: false, error: `DB error: ${msg}` }, { status: 500 });
    }

    logError("wipay_balance_start_request_failed", error, {
      bookingId: booking.id,
      orderId,
      amountDecimal: totalDecimal,
      env: process.env.WIPAY_ENV ?? "sandbox",
      paymentId,
    });
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
