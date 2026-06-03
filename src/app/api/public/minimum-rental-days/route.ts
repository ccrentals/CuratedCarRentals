import { NextResponse } from "next/server";

import {
  loadAdminSettings,
  resolveMinimumRentalDays,
} from "@/lib/adminSettings";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { settings } = await loadAdminSettings();
    return NextResponse.json(
      {
        minimumDays: resolveMinimumRentalDays(settings),
        globalDefaultDays: settings.bookingMinimumRentalDays.globalDefaultDays,
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
