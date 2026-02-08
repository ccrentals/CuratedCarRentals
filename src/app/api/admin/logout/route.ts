import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/auth/session";
import { requireCsrf } from "@/lib/security/csrf";

export async function POST(request: Request) {
  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
