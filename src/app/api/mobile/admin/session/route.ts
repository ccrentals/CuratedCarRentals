import { NextResponse } from "next/server";

import { canAccessAdmin, parseAppRole } from "@/lib/auth/roles";
import {
  createSessionToken,
  getSessionFromClerkBridge,
  type AdminSession,
} from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { logError, logWarn } from "@/lib/log";

type NativeAdminUserRow = {
  id: string;
  public_id: string | null;
  email: string;
  role: string;
  full_name: string | null;
  username: string | null;
  is_active: boolean | null;
  deactivated_at: string | null;
  locked_at: string | null;
};

type NativeAdminSessionDeps = {
  getClerkSession: () => Promise<AdminSession | null>;
  loadUser: (userId: string) => Promise<NativeAdminUserRow | null>;
};

const defaultDeps: NativeAdminSessionDeps = {
  getClerkSession: () => getSessionFromClerkBridge({
    clerkBridgeMode: "any-local-user",
    allowClerkWhenAdminProtectionDisabled: true,
  }),
  loadUser: async (userId) => {
    const result = await dbQuery<NativeAdminUserRow>(
      "select id, public_id, email, role, full_name, username, is_active, deactivated_at, locked_at from users where id = $1 limit 1",
      [userId],
    );
    return result.rows[0] ?? null;
  },
};

function json(body: Record<string, unknown>, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function exchangeNativeAdminSession(
  deps: NativeAdminSessionDeps = defaultDeps,
) {
  try {
    // This deliberately resolves Clerk directly. An existing CCR native token
    // cannot refresh itself; a currently active Clerk session is always required.
    const clerkSession = await deps.getClerkSession();
    if (!clerkSession?.clerkUserId) {
      return json({ ok: false, error: "Sign in is required." }, 401);
    }

    const user = await deps.loadUser(clerkSession.userId);
    if (!user) {
      return json({ ok: false, error: "Your staff account is not configured." }, 403);
    }

    const role = parseAppRole(user.role);
    const isUnavailable = user.is_active === false || Boolean(user.deactivated_at) || Boolean(user.locked_at);
    if (!role || !canAccessAdmin(role) || isUnavailable) {
      logWarn("api.mobile.admin.session.denied", {
        userId: user.id,
        role: user.role,
        isActive: user.is_active,
        isDeactivated: Boolean(user.deactivated_at),
        isLocked: Boolean(user.locked_at),
      });
      return json({ ok: false, error: "This account does not have active staff access." }, 403);
    }

    const accessToken = createSessionToken(user.id, role, "native-admin");
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 20;

    return json({
      ok: true,
      accessToken,
      expiresAt,
      user: {
        id: user.id,
        publicId: user.public_id,
        email: user.email,
        role,
        fullName: user.full_name,
        username: user.username,
      },
      auth: {
        provider: "clerk",
        clerkUserId: clerkSession.clerkUserId,
      },
    });
  } catch (error) {
    logError("api.mobile.admin.session.POST", error);
    return json({ ok: false, error: "Unable to start the secure admin session." }, 500);
  }
}

export async function POST() {
  return exchangeNativeAdminSession();
}
