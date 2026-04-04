import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { parsePaymentOptionInput } from "@/lib/payments/pricing";
import {
  buildQuotePricingSnapshot,
  QuotePricingError,
} from "@/lib/quotes/quotePricing";

type QuotePreviewPaymentOption = "FULL" | "DEPOSIT" | "CUSTOM" | "NONE";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

function parseInteger(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(parsed);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function buildQuotePaymentPreview(input: {
  amountDue: number;
  depositRequired: number;
  paymentOption: QuotePreviewPaymentOption;
  customAmount: number | null;
}) {
  const amountDue = Math.max(0, Math.round(input.amountDue));
  const depositRequired = Math.max(0, Math.round(input.depositRequired));
  const customAmount = input.customAmount === null ? null : Math.max(0, Math.round(input.customAmount));

  let dueNow = 0;

  if (input.paymentOption === "DEPOSIT") {
    dueNow = Math.min(amountDue, depositRequired);
  } else if (input.paymentOption === "FULL") {
    dueNow = amountDue;
  } else if (
    input.paymentOption === "CUSTOM" &&
    customAmount !== null &&
    customAmount > 0 &&
    customAmount <= amountDue
  ) {
    dueNow = customAmount;
  }

  const dueOnPickup = Math.max(0, amountDue - dueNow);
  const reserveShortfall = Math.max(0, depositRequired - dueNow);

  return {
    dueNow,
    dueOnPickup,
    reserveShortfall,
    balanceDue: dueOnPickup,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    const vehicleId = normalizeText(body?.vehicleId);
    const startAt = toDate(body?.startAt);
    const endAt = toDate(body?.endAt);
    const insuranceSelected = body?.insuranceSelected === true;
    const insurancePlanId = normalizeText(body?.insurancePlanId) || null;
    const promoCode = normalizeText(body?.promoCode) || null;
    const customerEmail = normalizeText(body?.customerEmail).toLowerCase() || null;
    const paymentOptionInput = parsePaymentOptionInput(body?.paymentOption);
    const paymentOption = paymentOptionInput ?? "DEPOSIT";
    const customAmount = parseAmount(body?.customAmount);
    const deliverySelected = body?.deliverySelected === true;
    const deliveryZoneLabel = normalizeText(body?.deliveryZoneLabel) || null;

    if (!UUID_REGEX.test(vehicleId)) {
      return NextResponse.json({ ok: false, error: "Invalid vehicle." }, { status: 400 });
    }

    if (!startAt || !endAt || endAt <= startAt) {
      return NextResponse.json(
        { ok: false, error: "Return date and time must be later than pickup date and time." },
        { status: 400 },
      );
    }

    if (body && body.paymentOption !== undefined && paymentOptionInput === null) {
      return NextResponse.json({ ok: false, error: "Invalid payment option." }, { status: 400 });
    }

    const snapshot = await buildQuotePricingSnapshot({
      vehicleId,
      startAt,
      endAt,
      insuranceEnabled: insuranceSelected,
      insurancePlanId,
      promoCode,
      customerEmail,
      deliverySelected,
      deliveryZoneLabel,
    });

    const pricing = asRecord(snapshot.pricingJson);
    const days = parseInteger(pricing.days, 0);
    const insurancePricePerDay = parseInteger(pricing.insurance_price_per_day_cents, 0);
    const preview = buildQuotePaymentPreview({
      amountDue: snapshot.summary.amountDueCents,
      depositRequired: snapshot.summary.depositRequiredCents,
      paymentOption,
      customAmount,
    });

    const customAmountWarning =
      paymentOption === "CUSTOM"
        ? customAmount === null || customAmount <= 0 || customAmount > snapshot.summary.amountDueCents
          ? "Custom payment must be greater than 0 and not exceed amount due."
          : customAmount < snapshot.summary.depositRequiredCents
            ? "Custom payment is below deposit and may not guarantee the vehicle."
            : null
        : null;

    return NextResponse.json({
      ok: true,
      summary: {
        days,
        baseTotal: snapshot.summary.baseTotalCents,
        insurancePricePerDay,
        insuranceTotal: snapshot.summary.insuranceTotalCents,
        discountTotal: snapshot.summary.discountTotalCents,
        subtotal: snapshot.summary.subtotalCents,
        total: snapshot.summary.totalCents,
        amountDue: snapshot.summary.amountDueCents,
        depositRequired: snapshot.summary.depositRequiredCents,
        paidToDate: 0,
        dueNow: preview.dueNow,
        dueOnPickup: preview.dueOnPickup,
        reserveShortfall: preview.reserveShortfall,
        balanceDue: preview.balanceDue,
        paymentOption,
        promoCode: snapshot.promoCode,
      },
      customAmountWarning,
      currency: String(pricing.currency ?? "JMD"),
    });
  } catch (error) {
    if (error instanceof QuotePricingError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    logError("api.public.pricing.quote.POST", error);
    return NextResponse.json({ ok: false, error: "Unable to generate pricing quote." }, { status: 500 });
  }
}
