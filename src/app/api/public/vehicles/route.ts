import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";

export async function GET() {
  try {
    const result = await dbQuery(
      "select * from vehicles where status <> 'INACTIVE' order by created_at desc",
    );
    return NextResponse.json({ vehicles: result.rows });
  } catch (error) {
    console.error("GET /api/public/vehicles failed", error);
    return NextResponse.json({ error: "Failed to load vehicles" }, { status: 500 });
  }
}
