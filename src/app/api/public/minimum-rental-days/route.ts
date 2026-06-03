import { NextResponse } from "next/server";

import {
  loadAdminSettings,
  resolveMinimumRentalDaysForVehicle,
} from "@/lib/adminSettings";
import { logError } from "@/lib/log";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const vehicleId = searchParams.get("vehicleId");
    if (vehicleId && !UUID_REGEX.test(vehicleId)) {
      return NextResponse.json({ error: "Invalid vehicleId." }, { status: 400 });
    }

    const { settings } = await loadAdminSettings();
    return NextResponse.json(
      {
        minimumDays: resolveMinimumRentalDaysForVehicle(settings, vehicleId),
        globalDefaultDays: settings.bookingMinimumRentalDays.globalDefaultDays,
        vehicleOverrides: settings.bookingMinimumRentalDays.vehicleOverrides,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    logError("api.public.minimum-rental-days.GET", error);
    return NextResponse.json(
      { error: "Failed to load minimum rental days." },
      { status: 500 },
    );
  }
}
