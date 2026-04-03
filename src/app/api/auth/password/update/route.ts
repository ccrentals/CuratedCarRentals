import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { syncPasswordWithClerkAndLocal } from "@/lib/security/clerkPasswordUpdate";

export type PasswordUpdateDeps = {
  requireAuth: typeof requireAdminAccess;
  requireCsrfCheck: typeof requireCsrf;
  syncPassword: typeof syncPasswordWithClerkAndLocal;
  writeAudit: typeof writeAuditLog;
};

const defaultDeps: PasswordUpdateDeps = {
  requireAuth: requireAdminAccess,
  requireCsrfCheck: requireCsrf,
  syncPassword: syncPasswordWithClerkAndLocal,
  writeAudit: writeAuditLog,
};

function readPasswordPayload(body: unknown) {
  if (!body || typeof body !== "object") {
    return {
      password: "",
      confirmPassword: "",
      csrfToken: null as string | null,
      flow: "admin_clerk_force_change_dialog",
    };
  }

  const payload = body as {
    password?: unknown;
    confirmPassword?: unknown;
    csrfToken?: unknown;
    flow?: unknown;
  };
  const password = typeof payload.password === "string" ? payload.password : "";
  const confirmPassword = typeof payload.confirmPassword === "string" ? payload.confirmPassword : "";
  const csrfToken = typeof payload.csrfToken === "string" ? payload.csrfToken : null;
  const flow =
    payload.flow === "clerk_task_reset_password"
      ? "clerk_task_reset_password"
      : "admin_clerk_force_change_dialog";
  return { password, confirmPassword, csrfToken, flow };
}

export async function handlePasswordUpdate(request: Request, deps: PasswordUpdateDeps = defaultDeps) {
  const auth = await deps.requireAuth();
  if (!auth.ok) {
    return auth.response;
  }

  const { session, actor } = auth;
  if (session.source !== "clerk" || !session.clerkUserId) {
    return NextResponse.json({ error: "Clerk session required." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const payload = readPasswordPayload(body);
  if (!(await deps.requireCsrfCheck(request, payload.csrfToken))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  if (payload.password.trim().length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (payload.password !== payload.confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
  }

  let syncResult;
  try {
    syncResult = await deps.syncPassword({
      localUserId: session.userId,
      clerkUserId: session.clerkUserId,
      password: payload.password,
    });
  } catch (error) {
    logError("api.auth.password.update.POST", error, {
      userId: actor.userId,
      clerkUserId: session.clerkUserId,
      stage: "unexpected",
    });
    return NextResponse.json({ error: "Failed to update password." }, { status: 500 });
  }

  if (!syncResult.ok) {
    logError("api.auth.password.update.POST", new Error(syncResult.message), {
      userId: actor.userId,
      clerkUserId: session.clerkUserId,
      stage: syncResult.stage,
    });
    return NextResponse.json({ error: syncResult.message, stage: syncResult.stage }, { status: syncResult.status });
  }

  try {
    await deps.writeAudit({
      userId: actor.userId,
      action: "USER_PASSWORD_SET",
      entityType: "user",
      entityId: actor.userId,
      details: {
        flow: payload.flow,
        clerkUserId: syncResult.clerkUserId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("api.auth.password.update.POST", error, {
      userId: actor.userId,
      clerkUserId: session.clerkUserId,
    });
    return NextResponse.json({
      ok: true,
      warning: "Password updated, but the audit log could not be written.",
    });
  }
}

export async function POST(request: Request) {
  return handlePasswordUpdate(request);
}
