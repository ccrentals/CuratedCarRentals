import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { getAdminCreateBookingPricingPreview } from "@/lib/bookings/adminCreateBooking";
import { logError } from "@/lib/log";
import { QuotePricingError } from "@/lib/quotes/quotePricing";
import { isISODate } from "@/lib/validators";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const { searchParams } = new URL(request.url);
    const vehicleId = normalizeText(searchParams.get("vehicleId"));
    const startDate = normalizeText(searchParams.get("startDate"));
    const endDate = normalizeText(searchParams.get("endDate"));
    const promoCode = normalizeText(searchParams.get("promoCode")) || null;
    const customerId = normalizeText(searchParams.get("customerId")) || null;
    const customerEmail = normalizeText(searchParams.get("customerEmail")).toLowerCase() || null;
    const insuranceSelected = searchParams.get("insuranceSelected") === "true";
    const insurancePlanId = normalizeText(searchParams.get("insurancePlanId")) || null;

    if (!UUID_REGEX.test(vehicleId)) {
      return NextResponse.json({ error: "Valid vehicleId is required." }, { status: 400 });
    }

    if (!isISODate(startDate) || !isISODate(endDate)) {
      return NextResponse.json({ error: "Valid startDate and endDate are required." }, { status: 400 });
    }

    if (customerId && !UUID_REGEX.test(customerId)) {
      return NextResponse.json({ error: "Valid customerId is required." }, { status: 400 });
    }
    if (insurancePlanId && !UUID_REGEX.test(insurancePlanId)) {
      return NextResponse.json({ error: "Valid insurancePlanId is required." }, { status: 400 });
    }

    const preview = await getAdminCreateBookingPricingPreview(vehicleId, startDate, endDate, {
      insuranceSelected,
      insurancePlanId,
      promoCode,
      customerId,
      customerEmail,
    });
    if (!preview) {
      return NextResponse.json({ error: "Unable to preview booking total." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    if (error instanceof QuotePricingError) {
      return NextResponse.json({ error: error.message, reason: error.code }, { status: error.status });
    }
    logError("api.admin.bookings.preview.GET", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to load booking preview." }, { status: 500 });
  }
}
