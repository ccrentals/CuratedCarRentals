import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";

export async function GET() {
  try {
    const result = await dbQuery(
      "select * from vehicles where status <> 'INACTIVE' order by created_at desc",
    );
    return NextResponse.json({ vehicles: result.rows });
  } catch (error) {
    logError("api.public.vehicles.GET", error);
    return NextResponse.json({ error: "Failed to load vehicles" }, { status: 500 });
  }
}
