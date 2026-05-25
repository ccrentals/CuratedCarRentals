import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { logError } from "@/lib/log";
import { listAdminCreateBookingAvailableVehicles } from "@/lib/bookings/adminCreateBooking";
import { isISODate } from "@/lib/validators";

function normalizeText(value: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const { searchParams } = new URL(request.url);
    const startDate = normalizeText(searchParams.get("startDate"));
    const endDate = normalizeText(searchParams.get("endDate"));

    if (!isISODate(startDate) || !isISODate(endDate)) {
      return NextResponse.json({ error: "Valid startDate and endDate are required." }, { status: 400 });
    }

    const vehicles = await listAdminCreateBookingAvailableVehicles(startDate, endDate);
    return NextResponse.json({ vehicles });
  } catch (error) {
    logError("api.admin.bookings.available-vehicles.GET", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to load available vehicles." }, { status: 500 });
  }
}
