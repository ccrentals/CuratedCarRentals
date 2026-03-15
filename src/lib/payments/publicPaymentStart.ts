import { NextResponse } from "next/server";

import { hasPublicBookingAccessForRequest } from "@/lib/bookings/publicAccess";
import { getDbPool } from "@/lib/db";
import { logError, logWarn } from "@/lib/log";
import { formatJmdDecimal } from "@/lib/money";
import {
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
  readPaymentOption,
} from "@/lib/payments/pricing";
import { isVehicleUnavailableEntitlementBased } from "@/lib/availability/entitlement";
import { buildRequestParams, requestHostedPageUrl } from "@/lib/wipay";

const ACTIVE_PAYMENT_WINDOW_MS = 30 * 60 * 1000;
const PENDING_PAYMENT_WINDOW_MS = 2 * 60 * 1000;

type PublicPaymentStartMode = "deposit" | "full" | "custom" | "balance";

type PublicPaymentStartBookingRow = {
  id: string;
  status: string;
  vehicle_id: string;
  start_date: string;
  end_date: string;
  start_at: string | null;
  end_at: string | null;
  pricing_json: Record<string, unknown> | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  daily_rate_cents: number;
  deposit_cents: number;
};

type ExistingPaymentAttemptRow = {
  id: string;
  deposit_amount_cents: number;
  created_at: string | null;
  metadata_json: Record<string, unknown> | null;
};

type Queryable = {
  query: <T>(text: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number }>;
};

export function classifyExistingPaymentAttempt(
  attempt: ExistingPaymentAttemptRow | null,
  now = Date.now(),
) {
  if (!attempt) return { type: "none" } as const;

  const createdAt = attempt.created_at ? new Date(attempt.created_at).getTime() : Number.NaN;
  if (!Number.isFinite(createdAt)) return { type: "none" } as const;

  const ageMs = now - createdAt;
  if (ageMs > ACTIVE_PAYMENT_WINDOW_MS) return { type: "none" } as const;

  const redirectUrl =
    typeof attempt.metadata_json?.hosted_page_url === "string"
      ? attempt.metadata_json.hosted_page_url
      : "";
  if (redirectUrl) {
    return {
      type: "reuse",
      paymentId: attempt.id,
      redirectUrl,
    } as const;
  }

  if (ageMs <= PENDING_PAYMENT_WINDOW_MS) {
    return {
      type: "pending",
      paymentId: attempt.id,
    } as const;
  }

  return { type: "none" } as const;
}

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

function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

function validateEnvironment() {
  const requiredEnv = [
    "WIPAY_ACCOUNT_NUMBER",
    "WIPAY_API_KEY",
    "WIPAY_ENV",
    "WIPAY_FEE_STRUCTURE",
  ];
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      logWarn("public_wipay_start_missing_env", { missing: key });
      return jsonError(400, "env_missing", `Missing ${key}`);
    }
  }

  const accountNumber = (process.env.WIPAY_ACCOUNT_NUMBER ?? "").trim();
  if (!/^\d+$/.test(accountNumber)) {
    logWarn("public_wipay_start_invalid_account_number");
    return jsonError(400, "env_invalid", "Invalid WIPAY_ACCOUNT_NUMBER: must be digits only");
  }

  if (!["sandbox", "live"].includes(process.env.WIPAY_ENV ?? "")) {
    logWarn("public_wipay_start_invalid_env", { env: process.env.WIPAY_ENV });
    return jsonError(400, "env_invalid", "Invalid WIPAY_ENV", { env: process.env.WIPAY_ENV });
  }

  return null;
}

function buildPricingUpdate(
  pricing: Record<string, unknown> | null,
  paymentOptionSelected: "DEPOSIT" | "FULL" | "CUSTOM" | "NONE",
  summary: ReturnType<typeof computeBookingPricingFromStoredSnapshot>,
  customAmountCents?: number | null,
) {
  return {
    ...(pricing ?? {}),
    payment_option_selected: paymentOptionSelected,
    payment_status: summary.paymentStatus,
    amount_paid: summary.netPaidToDate,
    paid_to_date: summary.netPaidToDate,
    balance_due: summary.balanceDue,
    total_amount: summary.total,
    total_cents: summary.total,
    ...(paymentOptionSelected === "CUSTOM"
      ? { custom_payment_amount_cents: customAmountCents ?? null }
      : {}),
  };
}

async function loadLockedBooking(client: Queryable, bookingId: string) {
  const result = await client.query<PublicPaymentStartBookingRow>(
    "select b.id, b.status, b.vehicle_id, b.start_date, b.end_date, b.start_at, b.end_at, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.daily_rate_cents, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id join customers c on c.id = b.customer_id where b.id = $1 for update",
    [bookingId],
  );
  return result.rows[0] ?? null;
}

async function findExistingAttempt(
  client: Queryable,
  bookingId: string,
  paymentType: "deposit" | "full" | "custom" | "balance",
  amountCents: number,
) {
  const result = await client.query<ExistingPaymentAttemptRow>(
    "select id, deposit_amount_cents, created_at, metadata_json from payments where booking_id = $1 and provider = 'WIPAY' and status = 'INITIATED' and deposit_amount_cents = $2 and coalesce(metadata_json->>'payment_type', 'deposit') = $3 order by created_at desc limit 1",
    [bookingId, amountCents, paymentType],
  );
  return result.rows[0] ?? null;
}

function buildStartDetails(
  mode: PublicPaymentStartMode,
  booking: PublicPaymentStartBookingRow,
  requestedCustomAmount: number | null,
  netPaidToDate: number,
) {
  const pricing = booking.pricing_json ?? {};

  if (mode === "deposit") {
    const summary = computeBookingPricingFromStoredSnapshot({
      bookingId: booking.id,
      bookingStatus: booking.status,
      startDate: booking.start_date,
      endDate: booking.end_date,
      pricing,
      fallbackDailyRate: booking.daily_rate_cents,
      fallbackDeposit: booking.deposit_cents,
      paymentOption: "DEPOSIT",
      netPaidToDate,
    });
    const depositDue = Math.max(0, summary.deposit - summary.netPaidToDate);
    if (!Number.isFinite(summary.deposit) || summary.deposit <= 0) {
      return { ok: false, response: jsonError(400, "invalid_amount", "Invalid deposit amount") } as const;
    }
    if (depositDue <= 0) {
      return { ok: false, response: jsonError(409, "already_paid", "Deposit already paid") } as const;
    }
    return {
      ok: true,
      amountCents: depositDue,
      paymentType: "deposit",
      totalDecimal: formatJmdDecimal(depositDue),
      nextPricing: buildPricingUpdate(pricing, "DEPOSIT", summary),
    } as const;
  }

  if (mode === "full") {
    const summary = computeBookingPricingFromStoredSnapshot({
      bookingId: booking.id,
      bookingStatus: booking.status,
      startDate: booking.start_date,
      endDate: booking.end_date,
      pricing,
      fallbackDailyRate: booking.daily_rate_cents,
      fallbackDeposit: booking.deposit_cents,
      paymentOption: "FULL",
      netPaidToDate,
    });
    if (summary.netPaidToDate > 0) {
      return { ok: false, response: jsonError(409, "already_paid", "Booking already has payments; use Pay Balance") } as const;
    }
    if (summary.balanceDue <= 0) {
      return { ok: false, response: jsonError(409, "already_paid", "Already fully paid") } as const;
    }
    return {
      ok: true,
      amountCents: summary.total,
      paymentType: "full",
      totalDecimal: formatJmdDecimal(summary.total),
      nextPricing: buildPricingUpdate(pricing, "FULL", summary),
    } as const;
  }

  if (mode === "custom") {
    const summary = computeBookingPricingFromStoredSnapshot({
      bookingId: booking.id,
      bookingStatus: booking.status,
      startDate: booking.start_date,
      endDate: booking.end_date,
      pricing,
      fallbackDailyRate: booking.daily_rate_cents,
      fallbackDeposit: booking.deposit_cents,
      paymentOption: "CUSTOM",
      netPaidToDate,
    });
    if (summary.balanceDue <= 0) {
      return { ok: false, response: jsonError(409, "already_paid", "Already fully paid") } as const;
    }

    const fallbackAmount = parseAmount(pricing.custom_payment_amount_cents);
    const amountToCharge = requestedCustomAmount ?? fallbackAmount;
    if (!amountToCharge || amountToCharge <= 0 || amountToCharge > summary.balanceDue) {
      return {
        ok: false,
        response: jsonError(
          400,
          "invalid_amount",
          "Custom payment must be greater than 0 and not exceed balance due.",
          { requestedAmount: requestedCustomAmount, fallbackAmount, balanceDue: summary.balanceDue },
        ),
      } as const;
    }

    return {
      ok: true,
      amountCents: amountToCharge,
      paymentType: "custom",
      totalDecimal: formatJmdDecimal(amountToCharge),
      nextPricing: buildPricingUpdate(pricing, "CUSTOM", summary, amountToCharge),
      customAmountCents: amountToCharge,
    } as const;
  }

  const summary = computeBookingPricingFromStoredSnapshot({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    pricing,
    fallbackDailyRate: booking.daily_rate_cents,
    fallbackDeposit: booking.deposit_cents,
    paymentOption: readPaymentOption(pricing),
    netPaidToDate,
  });
  if (summary.balanceDue <= 0) {
    return { ok: false, response: jsonError(409, "already_paid", "Balance already paid") } as const;
  }
  return {
    ok: true,
    amountCents: summary.balanceDue,
    paymentType: "balance",
    totalDecimal: formatJmdDecimal(summary.balanceDue),
    nextPricing: pricing,
  } as const;
}

async function updatePaymentHostedPageUrl(paymentId: string, redirectUrl: string) {
  await getDbPool().query(
    "update payments set metadata_json = jsonb_set(jsonb_set(coalesce(metadata_json, '{}'::jsonb), '{hosted_page_url}', to_jsonb($1::text), true), '{hosted_page_created_at}', to_jsonb($2::text), true), updated_at = now() where id = $3",
    [redirectUrl, new Date().toISOString(), paymentId],
  );
}

async function markPaymentFailed(paymentId: string, reason: string) {
  await getDbPool().query(
    "update payments set status = 'FAILED', metadata_json = jsonb_set(coalesce(metadata_json, '{}'::jsonb), '{error}', $1::jsonb, true), updated_at = now() where id = $2",
    [JSON.stringify({ message: reason }), paymentId],
  );
}

export async function startPublicWipayPayment({
  request,
  bookingId,
  mode,
  customAmountCents = null,
}: {
  request: Request;
  bookingId: string;
  mode: PublicPaymentStartMode;
  customAmountCents?: number | null;
}) {
  const envError = validateEnvironment();
  if (envError) return envError;

  const pool = getDbPool();
  const client = await pool.connect();

  let paymentId: string | null = null;
  let orderId: string | null = null;
  let totalDecimal = "";
  let bookingForLog: PublicPaymentStartBookingRow | null = null;

  try {
    await client.query("begin");

    const booking = await loadLockedBooking(client, bookingId);
    if (!booking) {
      await client.query("rollback");
      return jsonError(404, "not_found", "Booking not found");
    }
    bookingForLog = booking;

    const isAuthorized = await hasPublicBookingAccessForRequest(
      request,
      booking.id,
      booking.pricing_json,
    );
    if (!isAuthorized) {
      await client.query("rollback");
      return jsonError(403, "forbidden", "Forbidden");
    }

    if (["CANCELLED", "RETURNED"].includes(booking.status)) {
      await client.query("rollback");
      return jsonError(400, "invalid_booking_state", "Booking cannot be paid", {
        status: booking.status,
      });
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
      await client.query("rollback");
      return jsonError(
        409,
        "vehicle_unavailable",
        "This vehicle has been secured by another customer for the selected dates.",
      );
    }

    const netPaidToDate = await fetchNetPaidToDate(booking.id, { client });
    const startDetails = buildStartDetails(mode, booking, customAmountCents, netPaidToDate);
    if (!startDetails.ok) {
      await client.query("rollback");
      return startDetails.response;
    }
    totalDecimal = startDetails.totalDecimal;

    const existingAttempt = await findExistingAttempt(
      client,
      booking.id,
      startDetails.paymentType,
      startDetails.amountCents,
    );
    const classifiedAttempt = classifyExistingPaymentAttempt(existingAttempt);
    if (classifiedAttempt.type === "reuse") {
      await client.query("rollback");
      return NextResponse.json({
        ok: true,
        duplicate: true,
        paymentId: classifiedAttempt.paymentId,
        redirectUrl: classifiedAttempt.redirectUrl,
      });
    }
    if (classifiedAttempt.type === "pending") {
      await client.query("rollback");
      return jsonError(
        409,
        "payment_in_progress",
        "A payment attempt is already starting. Please wait a moment and try again.",
      );
    }

    if (mode === "deposit" || mode === "full" || mode === "custom") {
      const updateValues =
        mode === "custom"
          ? [
              booking.id,
              startDetails.customAmountCents ?? null,
              startDetails.nextPricing,
            ]
          : [booking.id, startDetails.nextPricing];

      await client.query(
        mode === "custom"
          ? "update bookings set payment_option = 'CUSTOM', custom_payment_amount_cents = $2, pricing_json = $3, updated_at = now() where id = $1"
          : "update bookings set pricing_json = $2, updated_at = now() where id = $1",
        updateValues,
      );
    }

    orderId = buildOrderId();
    const insertResult = (await client.query(
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref, metadata_json) values ($1, 'WIPAY', $2, 'JMD', 'INITIATED', $3, $4) returning id",
      [
        booking.id,
        startDetails.amountCents,
        orderId,
        {
          bookingId: booking.id,
          payment_type: startDetails.paymentType,
          custom_amount_cents: startDetails.customAmountCents ?? null,
          total_amount: mode === "deposit" ? startDetails.amountCents : undefined,
          total_decimal: startDetails.totalDecimal,
          env: process.env.WIPAY_ENV ?? "sandbox",
          created_at: new Date().toISOString(),
        },
      ],
    )) as { rows: Array<{ id: string }> };
    paymentId = insertResult.rows[0]?.id ?? null;

    await client.query("commit");

    const origin = process.env.SITE_URL ?? new URL(request.url).origin;
    const responseUrl = `${origin}/api/payments/wipay/return`;
    const params = buildRequestParams({
      orderId,
      amountDecimal: startDetails.totalDecimal,
      responseUrl,
      name: booking.customer_name,
      email: booking.customer_email,
      phone: booking.customer_phone,
    });

    const wipayResponse = await requestHostedPageUrl(params);
    if (paymentId) {
      try {
        await updatePaymentHostedPageUrl(paymentId, wipayResponse.url);
      } catch (metadataError) {
        logError("public_wipay_start_metadata_update_failed", metadataError, {
          bookingId,
          paymentId,
          orderId,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      redirectUrl: wipayResponse.url,
      paymentId,
    });
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {}

    const reason = error instanceof Error ? error.message : "Unknown error";
    if (paymentId) {
      try {
        await markPaymentFailed(paymentId, reason);
      } catch (dbError) {
        logError("public_wipay_start_db_update_failed", dbError, {
          bookingId,
          orderId,
          paymentId,
        });
      }
    }

    logError("public_wipay_start_failed", error, {
      bookingId,
      orderId,
      paymentId,
      amountDecimal: totalDecimal,
      env: process.env.WIPAY_ENV ?? "sandbox",
      bookingStatus: bookingForLog?.status ?? null,
    });

    return jsonError(
      paymentId ? 502 : 500,
      paymentId ? "provider_error" : "db_error",
      paymentId
        ? "Payment provider is temporarily unavailable. Please try again."
        : "Could not start payment. Please try again.",
      { bookingId, orderId, paymentId },
    );
  } finally {
    client.release();
  }
}
