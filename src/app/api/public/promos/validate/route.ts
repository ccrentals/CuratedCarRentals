import { NextResponse } from "next/server";

import { buildQuotePricingSnapshot, QuotePricingError } from "@/lib/quotes/quotePricing";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const codeRaw = typeof body?.code === "string" ? body.code.trim() : "";
  const vehicleId = typeof body?.vehicleId === "string" ? body.vehicleId : "";
  const startAt = typeof body?.startAt === "string"
    ? body.startAt
    : typeof body?.startDate === "string"
      ? `${body.startDate}T11:00:00.000Z`
      : "";
  const endAt = typeof body?.endAt === "string"
    ? body.endAt
    : typeof body?.endDate === "string"
      ? `${body.endDate}T11:00:00.000Z`
      : "";
  const customerEmail =
    typeof body?.customerEmail === "string" ? body.customerEmail.trim().toLowerCase() : "";
  const insuranceSelected = body?.insuranceSelected === true;
  const insurancePlanId =
    typeof body?.insurancePlanId === "string" && body.insurancePlanId.trim().length > 0
      ? body.insurancePlanId.trim()
      : null;
  const deliverySelected = body?.deliverySelected === true;
  const deliveryZoneLabel =
    typeof body?.deliveryZoneLabel === "string" && body.deliveryZoneLabel.trim().length > 0
      ? body.deliveryZoneLabel.trim()
      : null;

  if (!UUID_REGEX.test(vehicleId)) {
    return NextResponse.json({ error: "Invalid vehicle" }, { status: 400 });
  }
  if (insurancePlanId && !UUID_REGEX.test(insurancePlanId)) {
    return NextResponse.json({ error: "Invalid insurance plan" }, { status: 400 });
  }
  if (!codeRaw) {
    return NextResponse.json({ error: "Promo code is required" }, { status: 400 });
  }

  try {
    const snapshot = await buildQuotePricingSnapshot({
      vehicleId,
      startAt,
      endAt,
      insuranceEnabled: insuranceSelected,
      insurancePlanId,
      promoCode: codeRaw,
      customerEmail: customerEmail || null,
      deliverySelected,
      deliveryZoneLabel,
    });

    return NextResponse.json({
      ok: true,
      code: snapshot.promoCode,
      days: Number(snapshot.pricingJson.days ?? 0),
      subtotalCents: snapshot.summary.subtotalCents,
      discountAmountCents: snapshot.summary.discountTotalCents,
      totalAfterDiscountCents: snapshot.summary.totalCents,
      depositCents: snapshot.summary.depositRequiredCents,
      insuranceSelected: snapshot.insuranceEnabled,
      insuranceTotalCents: snapshot.summary.insuranceTotalCents,
      isEstimate: false,
    });
  } catch (error) {
    if (error instanceof QuotePricingError) {
      return NextResponse.json(
        { ok: false, error: error.message, reason: error.code },
        { status: error.status },
      );
    }

    return NextResponse.json({ ok: false, error: "Unable to validate promo code." }, { status: 500 });
  }
}
