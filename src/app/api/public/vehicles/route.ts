import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { getPublicVehicles } from "@/lib/publicVehicles";

export async function GET() {
  try {
    const vehicles = await getPublicVehicles();
    return NextResponse.json({ vehicles });
  } catch (error) {
    logError("api.public.vehicles.GET", error);
    return NextResponse.json({ error: "Failed to load vehicles" }, { status: 500 });
  }
}
