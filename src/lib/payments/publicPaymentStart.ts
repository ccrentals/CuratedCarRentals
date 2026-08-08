import { NextResponse } from "next/server";

import {
  addBookingCalendarDays,
  bookingDateTimeToUtcIso,
} from "@/lib/bookings/bookingDateTime";
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
import { buildCanonicalSiteUrl, buildRequestParams, getCanonicalSiteUrl, requestHostedPageUrl } from "@/lib/wipay";
import {
  assertWiPayAvailable,
  getPublicPaymentProvider,
  getStripePaymentMode,
  type PaymentProvider,
} from "@/lib/payments/provider";
import { getStripeClient, stripeCheckoutUrls, toStripeJmdMinorUnits } from "@/lib/payments/stripe";

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
  vehicle_year: number | null;
  vehicle_make: string;
  vehicle_model: string;
};

type ExistingPaymentAttemptRow = {
  id: string;
  deposit_amount_cents: number;
  created_at: string | null;
  provider_ref?: string | null;
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
    "SITE_URL",
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

  try {
    getCanonicalSiteUrl();
  } catch (error) {
    logWarn("public_wipay_start_invalid_site_url", {
      message: error instanceof Error ? error.message : "Invalid SITE_URL",
    });
    return jsonError(400, "env_invalid", "Invalid SITE_URL");
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
    "select b.id, b.status, b.vehicle_id, b.start_date, b.end_date, b.start_at, b.end_at, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.daily_rate_cents, v.deposit_cents, v.year as vehicle_year, v.make as vehicle_make, v.model as vehicle_model from bookings b join vehicles v on v.id = b.vehicle_id join customers c on c.id = b.customer_id where b.id = $1 for update",
    [bookingId],
  );
  return result.rows[0] ?? null;
}

async function findExistingAttempt(
  client: Queryable,
  bookingId: string,
  paymentType: "deposit" | "full" | "custom" | "balance",
  amountCents: number,
  provider: PaymentProvider,
) {
  const result = await client.query<ExistingPaymentAttemptRow>(
    "select id, deposit_amount_cents, created_at, provider_ref, metadata_json from payments where booking_id = $1 and provider = $4 and status = 'INITIATED' and deposit_amount_cents = $2 and coalesce(metadata_json->>'payment_type', 'deposit') = $3 order by created_at desc limit 1",
    [bookingId, amountCents, paymentType, provider],
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
  forceProvider,
}: {
  request: Request;
  bookingId: string;
  mode: PublicPaymentStartMode;
  customAmountCents?: number | null;
  /** Existing WiPay/mobile callers pass WIPAY; the website-neutral route omits this. */
  forceProvider?: PaymentProvider;
}) {
  const provider = forceProvider ?? getPublicPaymentProvider(request.url);
  if (provider === "WIPAY") {
    try {
      assertWiPayAvailable(request.url);
    } catch (error) {
      return jsonError(
        409,
        "provider_unavailable",
        error instanceof Error ? error.message : "WiPay is unavailable for this deployment.",
      );
    }
  }
  const envError = provider === "WIPAY" ? validateEnvironment() : null;
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

    const netPaidToDate = await fetchNetPaidToDate(booking.id, { client });
    if (!(mode === "balance" || netPaidToDate > 0)) {
      const fallbackEndDate = addBookingCalendarDays(booking.end_date, 1);
      const startAt =
        booking.start_at ?? bookingDateTimeToUtcIso(booking.start_date, "00:00");
      const endAt =
        booking.end_at ??
        (fallbackEndDate ? bookingDateTimeToUtcIso(fallbackEndDate, "00:00") : null);
      if (!startAt || !endAt) {
        await client.query("rollback");
        return jsonError(400, "invalid_booking_window", "Booking dates are invalid");
      }
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
    }

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
      provider,
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

    if (provider === "STRIPE" && existingAttempt) {
      const staleSessionId =
        typeof existingAttempt.metadata_json?.checkout_session_id === "string"
          ? existingAttempt.metadata_json.checkout_session_id
          : existingAttempt.provider_ref;

      if (staleSessionId) {
        try {
          await getStripeClient(request.url).checkout.sessions.expire(staleSessionId);
        } catch {
          await client.query("rollback");
          return jsonError(
            409,
            "payment_in_progress",
            "Your previous Stripe checkout is still being confirmed. Please wait a moment before trying again.",
          );
        }
      }

      await client.query(
        "update payments set status = 'FAILED', metadata_json = metadata_json || $1::jsonb, updated_at = now() where id = $2",
        [JSON.stringify({ stripe_retry_replaced_at: new Date().toISOString() }), existingAttempt.id],
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
      "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref, metadata_json) values ($1, $2, $3, 'JMD', 'INITIATED', $4, $5) returning id",
      [
        booking.id,
        provider,
        startDetails.amountCents,
        orderId,
        {
          bookingId: booking.id,
          payment_type: startDetails.paymentType,
          custom_amount_cents: startDetails.customAmountCents ?? null,
          total_amount: mode === "deposit" ? startDetails.amountCents : undefined,
          total_decimal: startDetails.totalDecimal,
          env: provider === "STRIPE" ? `stripe_${getStripePaymentMode(request.url)}` : process.env.WIPAY_ENV ?? "sandbox",
          provider: provider,
          created_at: new Date().toISOString(),
        },
      ],
    )) as { rows: Array<{ id: string }> };
    paymentId = insertResult.rows[0]?.id ?? null;

    await client.query("commit");

    let redirectUrl = "";
    if (provider === "STRIPE") {
      const stripe = getStripeClient(request.url);
      const urls = stripeCheckoutUrls();
      const paymentLabel = startDetails.paymentType === "deposit" ? "Deposit" : startDetails.paymentType === "full" ? "Full payment" : startDetails.paymentType === "balance" ? "Balance payment" : "Custom payment";
      const vehicleLabel = `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim();
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        success_url: urls.successUrl,
        cancel_url: urls.cancelUrl,
        customer_email: booking.customer_email || undefined,
        client_reference_id: paymentId ?? undefined,
        metadata: { payment_id: paymentId ?? "", booking_id: booking.id, payment_type: startDetails.paymentType },
        payment_intent_data: { metadata: { payment_id: paymentId ?? "", booking_id: booking.id, payment_type: startDetails.paymentType } },
        line_items: [{
          price_data: {
            currency: "jmd",
            product_data: {
              name: `${paymentLabel} — ${vehicleLabel}`,
            },
            unit_amount: toStripeJmdMinorUnits(startDetails.amountCents),
          },
          quantity: 1,
        }],
      });
      if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
      redirectUrl = session.url;
      await getDbPool().query(
        "update payments set provider_ref = $1, metadata_json = metadata_json || $2::jsonb, updated_at = now() where id = $3",
        [session.id, JSON.stringify({ checkout_session_id: session.id, payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null, hosted_page_url: session.url, hosted_page_created_at: new Date().toISOString(), stripe_livemode: session.livemode }), paymentId],
      );
    } else {
      const responseUrl = buildCanonicalSiteUrl("/api/payments/wipay/return");
      const params = buildRequestParams({ orderId, amountDecimal: startDetails.totalDecimal, responseUrl, name: booking.customer_name, email: booking.customer_email, phone: booking.customer_phone });
      const wipayResponse = await requestHostedPageUrl(params);
      redirectUrl = wipayResponse.url;
    }
    if (paymentId) {
      try {
        await updatePaymentHostedPageUrl(paymentId, redirectUrl);
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
      redirectUrl,
      paymentId,
      provider,
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
