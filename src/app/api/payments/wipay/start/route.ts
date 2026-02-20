import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { logError, logWarn } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { buildRequestParams, requestHostedPageUrl } from "@/lib/wipay";
import {
  computeBookingPricing,
  fetchNetPaidToDate,
  readInsurancePricingFields,
  readPromoPricingFields,
} from "@/lib/payments/pricing";
import { formatJmdDecimal } from "@/lib/money";
import { isVehicleUnavailableEntitlementBased } from "@/lib/availability/entitlement";

function buildOrderId() {
  const timePart = Date.now().toString(36).slice(-6);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `BK${timePart}${randomPart}`.slice(0, 16);
}

function jsonError(
  status: number,
  code: string,
  error: string,
  debug?: Record<string, unknown>,
) {
  const isProd = process.env.NODE_ENV === "production";
  return NextResponse.json(
    {
      ok: false,
      code,
      error,
      ...(isProd ? {} : debug ? { debug } : {}),
    },
    { status },
  );
}

export async function POST(request: Request) {
  if (!(await requireCsrf(request))) {
    return jsonError(403, "invalid_csrf", "Invalid CSRF token");
  }

  const requiredEnv = [
    "WIPAY_ACCOUNT_NUMBER",
    "WIPAY_API_KEY",
    "WIPAY_ENV",
    "WIPAY_FEE_STRUCTURE",
  ];
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      logWarn("wipay_start_missing_env", { missing: key });
      return jsonError(400, "env_missing", `Missing ${key}`);
    }
  }

  const accountNumber = (process.env.WIPAY_ACCOUNT_NUMBER ?? "").trim();
  if (!/^\d+$/.test(accountNumber)) {
    logWarn("wipay_start_invalid_account_number");
    return jsonError(400, "env_invalid", "Invalid WIPAY_ACCOUNT_NUMBER: must be digits only");
  }

  if (!["sandbox", "live"].includes(process.env.WIPAY_ENV ?? "")) {
    logWarn("wipay_start_invalid_env", { env: process.env.WIPAY_ENV });
    return jsonError(400, "env_invalid", "Invalid WIPAY_ENV", { env: process.env.WIPAY_ENV });
  }

  const body = await request.json().catch(() => null);
  const bookingId = body?.bookingId as string | undefined;

  if (!bookingId) {
    return jsonError(400, "invalid_request", "bookingId is required");
  }

  const bookingResult = await dbQuery<{
    id: string;
    status: string;
    pricing_json: Record<string, unknown> | null;
    vehicle_id: string;
    start_date: string;
    end_date: string;
    start_at: string | null;
    end_at: string | null;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    daily_rate_cents: number;
    deposit_cents: number;
  }>(
    "select b.id, b.status, b.pricing_json, b.vehicle_id, b.start_date, b.end_date, b.start_at, b.end_at, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.daily_rate_cents, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id join customers c on c.id = b.customer_id where b.id = $1",
    [bookingId],
  );

  if (bookingResult.rowCount === 0) {
    return jsonError(404, "not_found", "Booking not found");
  }

  const booking = bookingResult.rows[0];
  if (["CANCELLED", "RETURNED"].includes(booking.status)) {
    return jsonError(400, "invalid_booking_state", "Booking cannot be paid", { status: booking.status });
  }

  const startAt = booking.start_at ?? `${booking.start_date}T00:00:00.000Z`;
  const fallbackEndAt = new Date(`${booking.end_date}T00:00:00.000Z`);
  fallbackEndAt.setUTCDate(fallbackEndAt.getUTCDate() + 1);
  const endAt = booking.end_at ?? fallbackEndAt.toISOString();
  const unavailable = await isVehicleUnavailableEntitlementBased(
    booking.vehicle_id,
    { startAt, endAt },
    { excludeBookingId: booking.id, includeBlockouts: true },
  );
  if (unavailable) {
    return jsonError(
      409,
      "vehicle_unavailable",
      "This vehicle has been secured by another customer for the selected dates.",
    );
  }

  const pricing = booking.pricing_json ?? {};
  const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const deposit = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
  const { promoCode, promoDiscount } = readPromoPricingFields(pricing);
  const { insuranceSelected, insurancePricePerDay, insuranceTotal } = readInsurancePricingFields(pricing);
  const netPaidToDate = await fetchNetPaidToDate(booking.id);
  const summary = computeBookingPricing({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    dailyRate,
    deposit,
    paymentOption: "DEPOSIT",
    netPaidToDate,
    promoCode,
    promoDiscount,
    insuranceSelected,
    insurancePricePerDay,
    insuranceTotal,
  });

  if (!Number.isFinite(summary.deposit) || summary.deposit <= 0) {
    return jsonError(400, "invalid_amount", "Invalid deposit amount");
  }

  const depositDue = Math.max(0, summary.deposit - summary.netPaidToDate);
  if (depositDue <= 0) {
    return jsonError(409, "already_paid", "Deposit already paid");
  }

  const orderId = buildOrderId();
  const totalDecimal = formatJmdDecimal(depositDue);

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
    await dbQuery("update bookings set pricing_json = $2, updated_at = now() where id = $1", [
      booking.id,
      {
        ...pricing,
        payment_option_selected: "DEPOSIT",
        payment_status: summary.paymentStatus,
        amount_paid: summary.netPaidToDate,
        paid_to_date: summary.netPaidToDate,
        balance_due: summary.balanceDue,
        total_amount: summary.total,
        total_cents: summary.total,
      },
    ]);

    const insertResult = await dbQuery(
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref, metadata_json) values ($1, 'WIPAY', $2, 'JMD', 'INITIATED', $3, $4) returning id",
      [
        booking.id,
        depositDue,
        orderId,
        {
          bookingId: booking.id,
          deposit_cents: summary.deposit,
          deposit_due: depositDue,
          paid_to_date: summary.netPaidToDate,
          days: summary.days,
          daily_rate_cents: summary.dailyRate,
          promo_code: summary.promoCode,
          promo_discount_cents: summary.promoDiscount,
          total_amount: summary.total,
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
    logError("wipay_start_db_insert_failed", error, { bookingId: booking.id, orderId });
    const safe = process.env.NODE_ENV === "production" ? "Could not start payment. Please try again." : `DB error: ${message}`;
    return jsonError(500, "db_error", safe, { bookingId: booking.id, orderId });
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
      logError("wipay_start_db_update_failed", dbError, { bookingId: booking.id, orderId, paymentId });
      const safe = process.env.NODE_ENV === "production" ? "Could not start payment. Please try again." : `DB error: ${msg}`;
      return jsonError(500, "db_error", safe, { bookingId: booking.id, orderId, paymentId });
    }

    logError("wipay_start_request_failed", error, {
      bookingId: booking.id,
      orderId,
      amountDecimal: totalDecimal,
      env: process.env.WIPAY_ENV ?? "sandbox",
      paymentId,
    });
    const safe =
      process.env.NODE_ENV === "production"
        ? "Payment provider is temporarily unavailable. Please try again."
        : `WiPay request failed: ${reason}`;
    return jsonError(502, "provider_error", safe, {
      bookingId: booking.id,
      orderId,
      amountDecimal: totalDecimal,
      env: process.env.WIPAY_ENV ?? "sandbox",
    });
  }
}
