import { NextResponse } from "next/server";

import { canAccessAdmin } from "@/lib/auth/roles";
import { dbQuery } from "@/lib/db";
import { logWarn } from "@/lib/log";
import { isClerkEnabled } from "@/lib/security/clerk";
import {
  categorizeTurnstileFailure,
  extractTurnstileToken,
  getClientIpFromRequest,
  verifyTurnstileToken,
} from "@/lib/security/turnstile";
import {
  resolveOrProvisionClerkIdentityForLocalUser,
  syncPasswordWithClerkAndLocal,
} from "@/lib/security/clerkPasswordUpdate";
import { mapClerkAccountSetupError } from "@/lib/security/clerkPasswordFlow";
import { normalizeUserLifecycleState } from "@/lib/security/userLifecycle";
import { isEmail } from "@/lib/validators";

type LocalUserRow = {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  username: string | null;
  clerk_user_id: string | null;
  lifecycle_state: string | null;
};

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`\"${column}\"`) && message.includes("does not exist");
}

async function loadLocalUserByEmail(email: string) {
  try {
    const result = await dbQuery<LocalUserRow>(
      "select id, email, role, full_name, username, clerk_user_id, lifecycle_state from users where lower(email) = lower($1) limit 1",
      [email],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (
      isUndefinedColumn(error, "full_name") ||
      isUndefinedColumn(error, "username") ||
      isUndefinedColumn(error, "clerk_user_id") ||
      isUndefinedColumn(error, "lifecycle_state")
    ) {
      const fallback = await dbQuery<Pick<LocalUserRow, "id" | "email" | "role">>(
        "select id, email, role from users where lower(email) = lower($1) limit 1",
        [email],
      );
      const row = fallback.rows[0];
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        email: row.email,
        role: row.role,
        full_name: null,
        username: null,
        clerk_user_id: null,
        lifecycle_state: null,
      };
    }
    throw error;
  }
}

async function safeLifecycleErrorUpdate(userId: string, message: string) {
  try {
    await dbQuery(
      "update users set lifecycle_error = $2, lifecycle_state_updated_at = now(), updated_at = now() where id = $1",
      [userId, message],
    );
  } catch (error) {
    if (
      isUndefinedColumn(error, "lifecycle_error") ||
      isUndefinedColumn(error, "lifecycle_state_updated_at") ||
      isUndefinedColumn(error, "updated_at")
    ) {
      return;
    }
    throw error;
  }
}

async function safeActivateUser(userId: string) {
  try {
    await dbQuery(
      "update users set is_active = true, lifecycle_state = 'active', lifecycle_state_updated_at = now(), lifecycle_error = null, updated_at = now() where id = $1",
      [userId],
    );
  } catch (error) {
    if (isUndefinedColumn(error, "lifecycle_state") || isUndefinedColumn(error, "lifecycle_error")) {
      await dbQuery("update users set is_active = true, updated_at = now() where id = $1", [userId]);
      return;
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmPassword = typeof body?.confirmPassword === "string" ? body.confirmPassword : "";
  const turnstileToken = extractTurnstileToken(body, request);
  const ip = getClientIpFromRequest(request) ?? "unknown";

  const turnstileResult = await verifyTurnstileToken({
    token: turnstileToken,
    remoteIp: ip,
    expectedAction: "public_clerk_account_setup",
  });
  if (!turnstileResult.ok) {
    logWarn("api.public.auth.clerkAccountSetup.turnstile_failed", {
      route: "/api/public/auth/clerk-account-setup",
      failureCategory: categorizeTurnstileFailure(turnstileResult.errorCodes),
      status: turnstileResult.status,
      ip,
    });
    return NextResponse.json({ error: turnstileResult.userMessage }, { status: turnstileResult.status });
  }

  if (!isEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.trim().length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (password !== confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
  }

  if (!isClerkEnabled()) {
    return NextResponse.json(
      { error: "Clerk is not configured in this environment. Use legacy admin login for now." },
      { status: 503 },
    );
  }

  const localUser = await loadLocalUserByEmail(email);
  if (!localUser || !canAccessAdmin(localUser.role)) {
    return NextResponse.json(
      { error: "No eligible admin account found for this email." },
      { status: 404 },
    );
  }

  const lifecycleState = normalizeUserLifecycleState(localUser.lifecycle_state);
  if (lifecycleState === "delete_pending_external_cleanup") {
    return NextResponse.json(
      {
        error: "This account is pending external cleanup and cannot be activated yet.",
      },
      { status: 409 },
    );
  }
  if (lifecycleState === "active") {
    return NextResponse.json(
      {
        error: "This account is already active. Sign in instead.",
      },
      { status: 409 },
    );
  }
  if (lifecycleState !== null && lifecycleState !== "setup_pending") {
    return NextResponse.json(
      {
        error: "This account is not in a setup-pending state.",
      },
      { status: 409 },
    );
  }

  try {
    const resolution = await resolveOrProvisionClerkIdentityForLocalUser(
      {
        localUser: {
          id: localUser.id,
          email: localUser.email,
          role: localUser.role,
          fullName: localUser.full_name,
          username: localUser.username,
          clerkUserId: localUser.clerk_user_id,
        },
        flow: "public_clerk_account_setup",
      },
    );

    if (!resolution.ok) {
      await safeLifecycleErrorUpdate(localUser.id, resolution.message).catch(() => {});
      return NextResponse.json({ error: resolution.message }, { status: resolution.status });
    }

    const syncResult = await syncPasswordWithClerkAndLocal({
      localUserId: localUser.id,
      clerkUserId: resolution.clerkUserId,
      password,
    });
    if (!syncResult.ok) {
      await safeLifecycleErrorUpdate(localUser.id, syncResult.message).catch(() => {});
      return NextResponse.json({ error: syncResult.message }, { status: syncResult.status });
    }

    await safeActivateUser(localUser.id);

    return NextResponse.json({
      ok: true,
      message: "Account setup complete. Continue to sign in with Clerk.",
      redirectTo: "/sign-in?redirect=%2Fadmin",
      ...(resolution.localLinkWarning ? { warning: resolution.localLinkWarning } : {}),
    });
  } catch (error) {
    if (localUser?.id) {
      await safeLifecycleErrorUpdate(localUser.id, mapClerkAccountSetupError(error)).catch(() => {});
    }
    logWarn("api.public.auth.clerkAccountSetup", {
      email,
      code: (error as { errors?: Array<{ code?: string }> } | null)?.errors?.[0]?.code,
      message: (error as { message?: unknown } | null)?.message ?? null,
    });
    return NextResponse.json(
      {
        error: mapClerkAccountSetupError(error),
      },
      { status: 500 },
    );
  }
}
