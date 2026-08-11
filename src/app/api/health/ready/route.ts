import { NextResponse } from "next/server";

import { getHealthSnapshot, type HealthSnapshot } from "@/lib/health";

export function readinessResponse(snapshot: Pick<HealthSnapshot, "ok">) {
  // This route is intentionally safe for unauthenticated uptime monitors.
  // Detailed provider and environment diagnostics are available in /admin/health.
  return NextResponse.json(
    { ok: snapshot.ok },
    {
      status: snapshot.ok ? 200 : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function GET() {
  const snapshot = await getHealthSnapshot();

  return readinessResponse(snapshot);
}
