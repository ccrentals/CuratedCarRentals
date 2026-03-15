import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { getAdminCreateBookingPricingPreview } from "@/lib/bookings/adminCreateBooking";
import { logError } from "@/lib/log";
import { isISODate } from "@/lib/validators";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const { searchParams } = new URL(request.url);
    const vehicleId = normalizeText(searchParams.get("vehicleId"));
    const startDate = normalizeText(searchParams.get("startDate"));
    const endDate = normalizeText(searchParams.get("endDate"));

    if (!UUID_REGEX.test(vehicleId)) {
      return NextResponse.json({ error: "Valid vehicleId is required." }, { status: 400 });
    }

    if (!isISODate(startDate) || !isISODate(endDate)) {
      return NextResponse.json({ error: "Valid startDate and endDate are required." }, { status: 400 });
    }

    const preview = await getAdminCreateBookingPricingPreview(vehicleId, startDate, endDate);
    if (!preview) {
      return NextResponse.json({ error: "Unable to preview booking total." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    logError("api.admin.bookings.preview.GET", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to load booking preview." }, { status: 500 });
  }
}
