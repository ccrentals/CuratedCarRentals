import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";

type BookingLocationRow = {
  id: string;
  label: string;
  allow_pickup: boolean;
  allow_dropoff: boolean;
  sort_order: number;
};

export async function GET() {
  try {
    const result = await dbQuery<BookingLocationRow>(
      "select id, label, allow_pickup, allow_dropoff, sort_order from booking_locations where is_active = true order by sort_order asc, label asc",
    );
    return NextResponse.json({ locations: result.rows });
  } catch (error) {
    logError("api.public.locations.GET", error);
    return NextResponse.json({ error: "Failed to load locations." }, { status: 500 });
  }
}
