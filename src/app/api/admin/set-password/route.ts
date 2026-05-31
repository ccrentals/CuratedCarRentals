import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { hashPassword } from "@/lib/auth/password";
import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { isNonEmptyString } from "@/lib/validators";
import { requireCsrf } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import { isClerkEnabled } from "@/lib/security/clerk";
import {
  type ClerkIdentityResolutionResult,
  type ClerkPasswordSyncResult,
  type LocalUserForClerkPassword,
  resolveOrProvisionClerkIdentityForLocalUser,
  syncPasswordWithClerkAndLocal,
  updateLegacyPasswordState,
} from "@/lib/security/clerkPasswordUpdate";

type AdminSetPasswordUserRow = {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  username: string | null;
  clerk_user_id: string | null;
  must_change_password?: boolean | null;
  temp_password_expires_at?: string | null;
};

export type AdminSetPasswordDeps = {
  requireAuth: typeof requireOperationsAccess;
  requireCsrfCheck: typeof requireCsrf;
  isClerkEnabledFn: typeof isClerkEnabled;
  loadUserState: (userId: string) => Promise<AdminSetPasswordUserRow | null>;
  resolveClerkIdentity: (input: {
    localUser: LocalUserForClerkPassword;
    flow: string;
  }) => Promise<ClerkIdentityResolutionResult>;
  syncPassword: (input: {
    localUserId: string;
    clerkUserId: string;
    password: string;
  }) => Promise<ClerkPasswordSyncResult>;
  hashPasswordFn: typeof hashPassword;
  updateLocalPasswordState: typeof updateLegacyPasswordState;
  writeAudit: typeof writeAuditLog;
};

const CLERK_PASSWORD_SYNC_TIMEOUT_MS = 8000;

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`\"${column}\"`) && message.includes("does not exist");
}

async function loadUserState(userId: string): Promise<AdminSetPasswordUserRow | null> {
  try {
    const result = await dbQuery<AdminSetPasswordUserRow>(
      "select id, email, role, full_name, username, clerk_user_id, must_change_password, temp_password_expires_at from users where id = $1 limit 1",
      [userId],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (
      !isUndefinedColumn(error, "full_name") &&
      !isUndefinedColumn(error, "username") &&
      !isUndefinedColumn(error, "clerk_user_id") &&
      !isUndefinedColumn(error, "must_change_password") &&
      !isUndefinedColumn(error, "temp_password_expires_at")
    ) {
      throw error;
    }
  }

  const fallback = await dbQuery<{ id: string; email: string; role: string }>(
    "select id, email, role from users where id = $1 limit 1",
    [userId],
  );
  const row = fallback.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    email: String(row.email),
    role: String(row.role),
    full_name: null,
    username: null,
    clerk_user_id: null,
    must_change_password: false,
    temp_password_expires_at: null,
  };
}

const DEFAULT_DEPS: AdminSetPasswordDeps = {
  requireAuth: () =>
    requireOperationsAccess({
      getSession: () =>
        getSessionFromRequest({
          allowClerkBridge: true,
          clerkBridgeMode: "any-local-user",
        }),
    }),
  requireCsrfCheck: requireCsrf,
  isClerkEnabledFn: isClerkEnabled,
  loadUserState,
  resolveClerkIdentity: resolveOrProvisionClerkIdentityForLocalUser,
  syncPassword: syncPasswordWithClerkAndLocal,
  hashPasswordFn: hashPassword,
  updateLocalPasswordState: updateLegacyPasswordState,
  writeAudit: writeAuditLog,
};

function readPasswordPayload(body: unknown) {
  if (!body || typeof body !== "object") {
    return { password: "", confirmPassword: "", csrfToken: null as string | null };
  }

  const payload = body as {
    password?: unknown;
    confirmPassword?: unknown;
    csrfToken?: unknown;
  };
  return {
    password: typeof payload.password === "string" ? payload.password : "",
    confirmPassword: typeof payload.confirmPassword === "string" ? payload.confirmPassword : "",
    csrfToken: typeof payload.csrfToken === "string" ? payload.csrfToken : null,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function handleAdminSetPasswordPost(
  request: Request,
  deps: AdminSetPasswordDeps = DEFAULT_DEPS,
) {
  // Legacy first-login password reset flow for cookie-auth admins.
  // Retire after full Clerk admin cutover and verified inactivity.
  const auth = await deps.requireAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const body = await request.json().catch(() => null);
  const payload = readPasswordPayload(body);
  if (!(await deps.requireCsrfCheck(request, payload.csrfToken))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  if (!isNonEmptyString(payload.password, 8)) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (payload.confirmPassword && payload.confirmPassword !== payload.password) {
    return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
  }

  const user = await deps.loadUserState(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (!user.must_change_password) {
    return NextResponse.json({ error: "Password change is not required." }, { status: 400 });
  }

  if (user.temp_password_expires_at) {
    const expiresAtMs = new Date(user.temp_password_expires_at).getTime();
    if (!Number.isNaN(expiresAtMs) && expiresAtMs < Date.now()) {
      return NextResponse.json(
        { error: "Temporary password expired. Contact an administrator." },
        { status: 403 },
      );
    }
  }

  const flow = "legacy_admin_set_password";

  let passwordHash: string;
  try {
    passwordHash = await deps.hashPasswordFn(payload.password);
    await deps.updateLocalPasswordState({
      userId: session.userId,
      passwordHash,
    });
  } catch (error) {
    logError("api.admin.set-password.POST.updateLocalPasswordState", error, {
      userId: session.userId,
    });
    return NextResponse.json({ error: "Failed to update password." }, { status: 500 });
  }

  let clerkWarning: string | null = null;
  let clerkAuditDetails: Record<string, unknown> = { flow };

  if (deps.isClerkEnabledFn()) {
    let resolution: ClerkIdentityResolutionResult | null = null;
    try {
      resolution = await withTimeout(
        deps.resolveClerkIdentity({
          localUser: {
            id: user.id,
            email: user.email,
            role: user.role,
            fullName: user.full_name,
            username: user.username,
            clerkUserId: user.clerk_user_id,
          },
          flow,
        }),
        CLERK_PASSWORD_SYNC_TIMEOUT_MS,
        "Clerk identity resolution",
      );
    } catch (error) {
      logError("api.admin.set-password.POST.resolveClerkIdentity", error, {
        userId: session.userId,
      });
      clerkWarning =
        "Password updated locally, but Clerk account setup did not finish. Use the legacy admin login for now.";
    }

    if (resolution && !resolution.ok) {
      logError("api.admin.set-password.POST.resolveClerkIdentity", new Error(resolution.message), {
        userId: session.userId,
      });
      clerkWarning = `Password updated locally, but Clerk account setup needs attention: ${resolution.message}`;
    }

    if (resolution && resolution.ok) {
      let syncResult: ClerkPasswordSyncResult | null = null;
      try {
        syncResult = await withTimeout(
          deps.syncPassword({
            localUserId: session.userId,
            clerkUserId: resolution.clerkUserId,
            password: payload.password,
          }),
          CLERK_PASSWORD_SYNC_TIMEOUT_MS,
          "Clerk password sync",
        );
      } catch (error) {
        logError("api.admin.set-password.POST.syncPassword", error, {
          userId: session.userId,
          clerkUserId: resolution.clerkUserId,
          stage: "unexpected",
        });
        clerkWarning =
          "Password updated locally, but Clerk password sync did not finish. Use the legacy admin login for now.";
      }

      if (syncResult && !syncResult.ok) {
        logError("api.admin.set-password.POST.syncPassword", new Error(syncResult.message), {
          userId: session.userId,
          clerkUserId: resolution.clerkUserId,
          stage: syncResult.stage,
        });
        clerkWarning = `Password updated locally, but Clerk password sync needs attention: ${syncResult.message}`;
      }

      if (syncResult && syncResult.ok) {
        clerkAuditDetails = {
          flow,
          clerkUserId: resolution.clerkUserId,
          clerkResolution: resolution.resolution,
          ...(resolution.localLinkWarning ? { localLinkWarning: resolution.localLinkWarning } : {}),
        };
      }
    }
  }

  try {
    await deps.writeAudit({
      userId: session.userId,
      action: "USER_PASSWORD_SET",
      entityType: "user",
      entityId: session.userId,
      details: {
        ...clerkAuditDetails,
        ...(clerkWarning ? { clerkWarning } : {}),
      },
    });
  } catch (error) {
    logError("api.admin.set-password.POST.writeAudit", error, {
      userId: session.userId,
    });
    return NextResponse.json({
      ok: true,
      warning: clerkWarning ?? "Password updated, but the audit log could not be written.",
    });
  }

  return NextResponse.json({
    ok: true,
    ...(clerkWarning ? { warning: clerkWarning } : {}),
  });
}

export async function POST(request: Request) {
  return handleAdminSetPasswordPost(request);
}
