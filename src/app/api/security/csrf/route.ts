import { NextResponse } from "next/server";

import { getOrCreateCsrfToken } from "@/lib/security/csrf";

export async function GET() {
  await getOrCreateCsrfToken();
  return NextResponse.json({ ok: true });
}
