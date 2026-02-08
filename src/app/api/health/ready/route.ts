import { NextResponse } from "next/server";

import { getHealthSnapshot } from "@/lib/health";

export async function GET() {
  const snapshot = await getHealthSnapshot();

  return NextResponse.json(
    snapshot,
    { status: snapshot.ok ? 200 : 500 },
  );
}
