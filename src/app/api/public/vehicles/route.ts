import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { getPublicVehicles, getPublicVehiclesAvailableForWindow } from "@/lib/publicVehicles";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeDate(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return DATE_ONLY_REGEX.test(trimmed) ? trimmed : null;
}

function normalizeTime(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return TIME_ONLY_REGEX.test(trimmed) ? trimmed : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pickupDate = normalizeDate(searchParams.get("pickupDate"));
    const dropoffDate = normalizeDate(searchParams.get("dropoffDate"));
    const pickupTime = normalizeTime(searchParams.get("pickupTime"));
    const dropoffTime = normalizeTime(searchParams.get("dropoffTime"));

    if ((pickupDate && !dropoffDate) || (!pickupDate && dropoffDate)) {
      return NextResponse.json(
        { error: "pickupDate and dropoffDate must be provided together" },
        { status: 400 },
      );
    }

    if ((pickupTime && !dropoffTime) || (!pickupTime && dropoffTime)) {
      return NextResponse.json(
        { error: "pickupTime and dropoffTime must be provided together" },
        { status: 400 },
      );
    }

    if (pickupDate && dropoffDate) {
      const vehicles = await getPublicVehiclesAvailableForWindow({
        pickupDate,
        dropoffDate,
        pickupTime,
        dropoffTime,
      });
      return NextResponse.json({ vehicles });
    }

    const vehicles = await getPublicVehicles();
    return NextResponse.json({ vehicles });
  } catch (error) {
    logError("api.public.vehicles.GET", error);
    return NextResponse.json({ error: "Failed to load vehicles" }, { status: 500 });
  }
}
