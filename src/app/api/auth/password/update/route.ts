import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { hashPassword } from "@/lib/auth/password";
import { writeAuditLog } from "@/lib/audit";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`\"${column}\"`) && message.includes("does not exist");
}

export type PasswordUpdateDeps = {
  requireAuth: typeof requireStaffOrAdminRole;
  requireCsrfCheck: typeof requireCsrf;
  getClerk: typeof clerkClient;
  hashPasswordFn: typeof hashPassword;
  updateLocalPasswordState: (input: { userId: string; passwordHash: string }) => Promise<void>;
  writeAudit: typeof writeAuditLog;
  nowIso: () => string;
};

async function updateLegacyPasswordState(input: { userId: string; passwordHash: string }) {
  const sql =
    "update users set password_hash = $2, must_change_password = false, temp_password_expires_at = null, password_updated_at = now() where id = $1";

  try {
    await dbQuery(sql, [input.userId, input.passwordHash]);
    return;
  } catch (error) {
    if (
      !isUndefinedColumn(error, "must_change_password") &&
      !isUndefinedColumn(error, "temp_password_expires_at")
    ) {
      throw error;
    }
  }

  await dbQuery("update users set password_hash = $2, password_updated_at = now() where id = $1", [
    input.userId,
    input.passwordHash,
  ]);
}

const defaultDeps: PasswordUpdateDeps = {
  requireAuth: requireStaffOrAdminRole,
  requireCsrfCheck: requireCsrf,
  getClerk: clerkClient,
  hashPasswordFn: hashPassword,
  updateLocalPasswordState: updateLegacyPasswordState,
  writeAudit: writeAuditLog,
  nowIso: () => new Date().toISOString(),
};

function readPasswordPayload(body: unknown) {
  if (!body || typeof body !== "object") {
    return { password: "", confirmPassword: "", csrfToken: null as string | null };
  }

  const payload = body as { password?: unknown; confirmPassword?: unknown; csrfToken?: unknown };
  const password = typeof payload.password === "string" ? payload.password : "";
  const confirmPassword = typeof payload.confirmPassword === "string" ? payload.confirmPassword : "";
  const csrfToken = typeof payload.csrfToken === "string" ? payload.csrfToken : null;
  return { password, confirmPassword, csrfToken };
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

  try {
    const clerk = await deps.getClerk();
    const clerkUser = await clerk.users.getUser(session.clerkUserId);
    const currentMetadata =
      clerkUser.publicMetadata && typeof clerkUser.publicMetadata === "object"
        ? (clerkUser.publicMetadata as Record<string, unknown>)
        : {};

    await clerk.users.updateUser(session.clerkUserId, {
      password: payload.password,
      publicMetadata: {
        ...currentMetadata,
        forcePasswordChange: false,
        tempPasswordExpiresAt: null,
        passwordChangedAt: deps.nowIso(),
      },
    });

    const passwordHash = await deps.hashPasswordFn(payload.password);
    await deps.updateLocalPasswordState({ userId: session.userId, passwordHash });

    await deps.writeAudit({
      userId: actor.userId,
      action: "USER_PASSWORD_SET",
      entityType: "user",
      entityId: actor.userId,
      details: { flow: "admin_clerk_force_change_dialog" },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("api.auth.password.update.POST", error, {
      userId: actor.userId,
      clerkUserId: session.clerkUserId,
    });
    return NextResponse.json({ error: "Failed to update password." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handlePasswordUpdate(request);
}
