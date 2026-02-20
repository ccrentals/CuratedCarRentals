import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";
import { computeBookingPricing } from "@/lib/payments/pricing";
import { normalizePromoInputCode, validatePromoForBooking } from "@/lib/promos";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const codeRaw = typeof body?.code === "string" ? body.code : "";
  const vehicleId = typeof body?.vehicleId === "string" ? body.vehicleId : "";
  const startDate = typeof body?.startDate === "string" ? body.startDate : "";
  const endDate = typeof body?.endDate === "string" ? body.endDate : "";
  const customerEmail =
    typeof body?.customerEmail === "string" ? body.customerEmail.trim().toLowerCase() : "";
  const insuranceSelected = body?.insuranceSelected === true;
  const insurancePricePerDayCentsRaw = Number(body?.insurancePricePerDayCents);
  const insurancePricePerDayCents =
    Number.isFinite(insurancePricePerDayCentsRaw) && insurancePricePerDayCentsRaw > 0
      ? Math.round(insurancePricePerDayCentsRaw)
      : 0;

  if (!UUID_REGEX.test(vehicleId)) {
    return NextResponse.json({ error: "Invalid vehicle" }, { status: 400 });
  }

  const start = dateOnlyUtc(startDate);
  const end = dateOnlyUtc(endDate);
  if (!start || !end || end < start) {
    return NextResponse.json({ error: "Invalid booking dates" }, { status: 400 });
  }

  const days = calcDaysInclusive(start, end);
  if (days <= 0) {
    return NextResponse.json({ error: "Invalid booking dates" }, { status: 400 });
  }

  const vehicleResult = await dbQuery<{
    id: string;
    status: string;
    daily_rate_cents: number;
    deposit_cents: number;
  }>(
    "select id, status, daily_rate_cents, deposit_cents from vehicles where id = $1 and status <> 'INACTIVE' limit 1",
    [vehicleId],
  );

  if (vehicleResult.rowCount === 0) {
    return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }

  const vehicle = vehicleResult.rows[0];
  const pricingPreview = computeBookingPricing({
    bookingId: "promo-preview",
    bookingStatus: "PENDING_PAYMENT",
    startDate,
    endDate,
    dailyRate: Number(vehicle.daily_rate_cents || 0),
    deposit: Number(vehicle.deposit_cents || 0),
    paymentOption: "DEPOSIT",
    netPaidToDate: 0,
    insuranceSelected,
    insurancePricePerDay: insurancePricePerDayCents,
    promoDiscount: 0,
  });
  const subtotalCents = pricingPreview.subtotal;
  const normalizedCode = normalizePromoInputCode(codeRaw);
  if (!normalizedCode) {
    return NextResponse.json({ error: "Promo code is required" }, { status: 400 });
  }

  const validation = await validatePromoForBooking({
    code: normalizedCode,
    vehicleId,
    startDate,
    endDate,
    subtotalCents,
    customerEmail: customerEmail || undefined,
  });

  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.message, reason: validation.reason }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    code: validation.code,
    days,
    subtotalCents: validation.subtotalCents,
    discountAmountCents: validation.discountAmountCents,
    totalAfterDiscountCents: validation.totalAfterDiscountCents,
    depositCents: Number(vehicle.deposit_cents || 0),
    insuranceSelected,
    insuranceTotalCents: pricingPreview.insuranceTotal,
    isEstimate: !insuranceSelected,
  });
}
