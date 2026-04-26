import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { resendAdminEmail } from "@/lib/notifications/adminEmails";
import { requireCsrf } from "@/lib/security/csrf";
import { logError } from "@/lib/log";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminAccess();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const result = await resendAdminEmail(id, actor.userId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("admin_email_resend_failed", error);
    return NextResponse.json({ ok: false, error: "Failed to resend email." }, { status: 500 });
  }
}
