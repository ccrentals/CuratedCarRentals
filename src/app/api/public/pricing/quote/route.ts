import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { computeBookingPricing, parsePaymentOptionInput } from "@/lib/payments/pricing";
import { normalizePromoInputCode, validatePromoForBooking } from "@/lib/promos";

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

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

type VehicleRow = {
  id: string;
  daily_rate_cents: number;
  deposit_cents: number;
  status: string;
};

type InsurancePlanRow = {
  id: string;
  vehicle_id: string | null;
  is_enabled: boolean;
  price_per_day_cents: number;
  is_global_default: boolean;
};

async function resolveInsuranceForVehicle(vehicleId: string) {
  const vehiclePlan = await dbQuery<InsurancePlanRow>(
    "select id, vehicle_id, is_enabled, price_per_day_cents, is_global_default from insurance_plans where vehicle_id = $1 limit 1",
    [vehicleId],
  );

  if (vehiclePlan.rowCount > 0) return vehiclePlan.rows[0];

  const globalPlan = await dbQuery<InsurancePlanRow>(
    "select id, vehicle_id, is_enabled, price_per_day_cents, is_global_default from insurance_plans where is_global_default = true limit 1",
  );

  return globalPlan.rows[0] ?? null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    const vehicleId = normalizeText(body?.vehicleId);
    const startAt = toDate(body?.startAt);
    const endAt = toDate(body?.endAt);
    const insuranceSelected = body?.insuranceSelected === true;
    const promoCodeInput = normalizePromoInputCode(normalizeText(body?.promoCode));
    const customerEmail = normalizeText(body?.customerEmail).toLowerCase() || null;
    const paymentOptionInput = parsePaymentOptionInput(body?.paymentOption);
    const paymentOption = paymentOptionInput ?? "DEPOSIT";
    const customAmount = parseAmount(body?.customAmount);

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

    const startDate = toDateKey(startAt);
    const endDate = toDateKey(endAt);

    const vehicleResult = await dbQuery<VehicleRow>(
      "select id, status, daily_rate_cents, deposit_cents from vehicles where id = $1 and status <> 'INACTIVE' limit 1",
      [vehicleId],
    );

    if (vehicleResult.rowCount === 0) {
      return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
    }

    const vehicle = vehicleResult.rows[0];
    const insurancePlan = await resolveInsuranceForVehicle(vehicleId);

    if (insuranceSelected && (!insurancePlan || !insurancePlan.is_enabled)) {
      return NextResponse.json(
        { ok: false, error: "Full Coverage Insurance Plan is unavailable for this vehicle." },
        { status: 400 },
      );
    }

    const insurancePricePerDay =
      insuranceSelected && insurancePlan && insurancePlan.is_enabled
        ? Math.max(0, Number(insurancePlan.price_per_day_cents ?? 0))
        : 0;

    const baseSummary = computeBookingPricing({
      bookingId: "public-quote",
      bookingStatus: "PENDING_PAYMENT",
      startAt,
      endAt,
      dailyRate: Math.max(0, Number(vehicle.daily_rate_cents ?? 0)),
      deposit: Math.max(0, Number(vehicle.deposit_cents ?? 0)),
      paymentOption,
      netPaidToDate: 0,
      insuranceSelected,
      insurancePricePerDay,
      promoCode: null,
      promoDiscount: 0,
    });

    let promoCode: string | null = null;
    let promoDiscount = 0;

    if (promoCodeInput) {
      const promoValidation = await validatePromoForBooking({
        code: promoCodeInput,
        vehicleId,
        startDate,
        endDate,
        subtotalCents: baseSummary.subtotal,
        customerEmail,
      });

      if (!promoValidation.ok) {
        return NextResponse.json({ ok: false, error: promoValidation.message }, { status: 400 });
      }

      promoCode = promoValidation.code;
      promoDiscount = promoValidation.discountAmountCents;
    }

    const summary = computeBookingPricing({
      bookingId: "public-quote",
      bookingStatus: "PENDING_PAYMENT",
      startAt,
      endAt,
      dailyRate: Math.max(0, Number(vehicle.daily_rate_cents ?? 0)),
      deposit: Math.max(0, Number(vehicle.deposit_cents ?? 0)),
      paymentOption,
      netPaidToDate: 0,
      insuranceSelected,
      insurancePricePerDay,
      promoCode,
      promoDiscount,
    });

    const customAmountWarning =
      paymentOption === "CUSTOM"
        ? customAmount === null || customAmount <= 0 || customAmount > summary.amountDue
          ? "Custom payment must be greater than 0 and not exceed amount due."
          : customAmount < summary.depositRequired
            ? "Custom payment is below deposit and may not guarantee the vehicle."
            : null
        : null;

    return NextResponse.json({
      ok: true,
      summary: {
        days: summary.days,
        baseTotal: summary.baseTotal,
        insurancePricePerDay: summary.insurancePricePerDay,
        insuranceTotal: summary.insuranceTotal,
        discountTotal: summary.discountTotal,
        subtotal: summary.subtotal,
        total: summary.total,
        amountDue: summary.amountDue,
        depositRequired: summary.depositRequired,
        paidToDate: summary.netPaidToDate,
        balanceDue: summary.balanceDue,
        paymentOption: summary.paymentOption,
        promoCode: summary.promoCode,
      },
      customAmountWarning,
      currency: "JMD",
    });
  } catch (error) {
    logError("api.public.pricing.quote.POST", error);
    return NextResponse.json({ ok: false, error: "Unable to generate pricing quote." }, { status: 500 });
  }
}
