import { NextResponse } from "next/server";

import { requireDeveloperRole } from "@/lib/auth/adminGuards";
import { repairAllSafeClerkIdentityDrift, repairClerkIdentityDrift, generateClerkIdentitySyncReport } from "@/lib/auth/clerkIdentitySync";
import { requireCsrf } from "@/lib/security/csrf";

export async function GET() {
  const auth = await requireDeveloperRole({ forbiddenMessage: "Forbidden" });
  if (!auth.ok) return auth.response;

  const report = await generateClerkIdentitySyncReport();
  return NextResponse.json({ ok: true, report });
}

export async function POST(request: Request) {
  const auth = await requireDeveloperRole({ forbiddenMessage: "Forbidden" });
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  if (!action) {
    return NextResponse.json({ ok: false, error: "Action is required." }, { status: 400 });
  }

  if (action === "repair_all_safe") {
    const result = await repairAllSafeClerkIdentityDrift({ actorUserId: auth.actor.userId });
    return NextResponse.json({
      ok: result.ok,
      attempted: result.attempted,
      repaired: result.repaired,
      failed: result.failed,
      report: result.report,
      message:
        result.message ??
        `Attempted ${result.attempted} safe repairs. Repaired ${result.repaired}, failed ${result.failed}.`,
    });
  }

  if (action === "repair_user") {
    const localUserId = typeof body?.localUserId === "string" ? body.localUserId.trim() : "";
    const clerkUserId = typeof body?.clerkUserId === "string" ? body.clerkUserId.trim() : "";
    if (!localUserId && !clerkUserId) {
      return NextResponse.json(
        { ok: false, error: "localUserId or clerkUserId is required." },
        { status: 400 },
      );
    }

    const result = await repairClerkIdentityDrift({
      actorUserId: auth.actor.userId,
      localUserId: localUserId || undefined,
      clerkUserId: clerkUserId || undefined,
    });

    return NextResponse.json(
      {
        ok: result.ok,
        message: result.message,
        repaired: result.repaired,
        report: result.report,
      },
      { status: result.ok ? 200 : 409 },
    );
  }

  return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
}
