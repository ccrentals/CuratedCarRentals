import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { requireCsrf } from "@/lib/security/csrf";

export async function POST(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;

  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const origin = process.env.SITE_URL ?? new URL(request.url).origin;
  const secret = process.env.CRON_SECRET ?? "";

  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  }

  const response = await fetch(`${origin}/api/cron/pickup-reminders`, {
    method: "POST",
    headers: { "x-cron-secret": secret },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json({ error: data?.error ?? "Cron failed" }, { status: response.status });
  }

  return NextResponse.json(data);
}
