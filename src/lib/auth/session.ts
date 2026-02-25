import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { auth, currentUser } from "@clerk/nextjs/server";

import { isStaffRole } from "@/lib/auth/roles";
import { dbQuery } from "@/lib/db";
import { logWarn } from "@/lib/log";
import { isClerkEnabled, shouldEnforceClerkOnAdminRoutes } from "@/lib/security/clerk";

const COOKIE_NAME = "ccr_admin_session";
const IDLE_TIMEOUT_SECONDS = 60 * 20; // 20 minutes
const COOKIE_MAX_AGE_SECONDS = IDLE_TIMEOUT_SECONDS;
// Refresh on every authenticated request (when mutation is allowed) to enforce idle timeout semantics.
const SESSION_ROTATION_WINDOW_SECONDS = IDLE_TIMEOUT_SECONDS;

export type AdminSession = {
  userId: string;
  role: string;
  expiresAt: number;
  issuedAt: number;
  source?: "legacy" | "clerk";
  clerkUserId?: string;
};

export type ClerkBridgeMode = "staff-only" | "any-local-user";

export type GetSessionFromRequestOptions = {
  /**
   * `staff-only` keeps pre-cutover semantics and only returns bridge sessions for staff roles.
   * `any-local-user` allows non-staff bridge sessions to propagate so admin guards can return 403.
   */
  clerkBridgeMode?: ClerkBridgeMode;
};

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not set");
  }
  return secret;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string) {
  const secret = getSessionSecret();
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(userId: string, role: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + COOKIE_MAX_AGE_SECONDS;
  const payload = JSON.stringify({ sub: userId, role, exp: expiresAt, iat: issuedAt });
  const encoded = base64UrlEncode(payload);
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/",
  });
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  const needle = `"${column.toLowerCase()}"`;
  return code === "42703" && message.includes(needle) && message.includes("does not exist");
}

function isClerkAdminBridgeEnabled() {
  return isClerkEnabled() && shouldEnforceClerkOnAdminRoutes();
}

function readEmailFromSessionClaims(sessionClaims: unknown) {
  if (!sessionClaims || typeof sessionClaims !== "object") {
    return null;
  }

  const claims = sessionClaims as Record<string, unknown>;
  const rawValue = claims.email ?? claims.email_address ?? claims.primary_email_address;
  return typeof rawValue === "string" && rawValue.trim() ? rawValue.trim().toLowerCase() : null;
}

type AdminUserRow = {
  id: string;
  role: string;
  email: string;
  clerk_user_id?: string | null;
};

type ClerkIdentityLookupResult =
  | { status: "not_found" }
  | { status: "clerk_id_conflict"; user: AdminUserRow }
  | { status: "matched"; user: AdminUserRow };

async function findLocalUserForClerkIdentity({
  clerkUserId,
  email,
}: {
  clerkUserId: string;
  email: string | null;
}): Promise<ClerkIdentityLookupResult> {
  let user: AdminUserRow | null = null;
  let hasClerkUserIdColumn = true;

  try {
    const byClerkId = await dbQuery<AdminUserRow>(
      "select id, role, email, clerk_user_id from users where clerk_user_id = $1 limit 1",
      [clerkUserId],
    );
    user = byClerkId.rows[0] ?? null;
  } catch (error) {
    if (!isUndefinedColumn(error, "clerk_user_id")) {
      throw error;
    }
    hasClerkUserIdColumn = false;
  }

  if (!user && email) {
    const selectColumns = hasClerkUserIdColumn ? "id, role, email, clerk_user_id" : "id, role, email";
    const byEmail = await dbQuery<AdminUserRow>(
      `select ${selectColumns} from users where lower(email) = lower($1) limit 1`,
      [email],
    );
    user = byEmail.rows[0] ?? null;

    if (user && hasClerkUserIdColumn) {
      const existingClerkId = user.clerk_user_id?.trim();
      if (existingClerkId && existingClerkId !== clerkUserId) {
        return { status: "clerk_id_conflict", user };
      }

      try {
        const linked = await dbQuery<{ clerk_user_id: string }>(
          "update users set clerk_user_id = $2 where id = $1 and clerk_user_id is null returning clerk_user_id",
          [user.id, clerkUserId],
        );

        if (!existingClerkId && linked.rowCount === 0) {
          return { status: "clerk_id_conflict", user };
        }
      } catch (error) {
        if (!isUndefinedColumn(error, "clerk_user_id")) {
          throw error;
        }
      }
    }
  }

  if (!user) {
    return { status: "not_found" };
  }

  return { status: "matched", user };
}

async function getSessionFromClerkBridge(
  options: GetSessionFromRequestOptions = {},
): Promise<AdminSession | null> {
  if (!isClerkAdminBridgeEnabled()) {
    return null;
  }
  const bridgeMode = options.clerkBridgeMode ?? "staff-only";

  const authState = await auth().catch(() => null);
  if (!authState?.userId || authState.sessionStatus !== "active") {
    return null;
  }

  const clerkUserId = authState.userId;
  let email = readEmailFromSessionClaims(authState.sessionClaims);

  if (!email) {
    const clerkUser = await currentUser().catch(() => null);
    const primaryEmail = clerkUser?.emailAddresses.find(
      (item) => item.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress;
    if (primaryEmail?.trim()) {
      email = primaryEmail.trim().toLowerCase();
    }
  }

  try {
    const mappedUserResult = await findLocalUserForClerkIdentity({ clerkUserId, email });
    if (mappedUserResult.status === "not_found") {
      logWarn("auth.session.clerkBridgeNoLocalUser", {
        clerkUserId,
        hasEmailCandidate: Boolean(email),
        remediation: "Map users.clerk_user_id or align local users.email before enforcing admin cutover.",
      });
      return null;
    }

    if (mappedUserResult.status === "clerk_id_conflict") {
      logWarn("auth.session.clerkBridgeMappingConflict", {
        clerkUserId,
        localUserId: mappedUserResult.user.id,
        localRole: mappedUserResult.user.role,
      });
      return null;
    }

    const mappedUser = mappedUserResult.user;
    if (!isStaffRole(mappedUser.role)) {
      logWarn("auth.session.clerkBridgeRoleDenied", {
        clerkUserId,
        localUserId: mappedUser.id,
        localRole: mappedUser.role,
      });

      if (bridgeMode !== "any-local-user") {
        return null;
      }
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    return {
      userId: mappedUser.id,
      role: mappedUser.role,
      issuedAt,
      expiresAt: issuedAt + COOKIE_MAX_AGE_SECONDS,
      source: "clerk",
      clerkUserId,
    };
  } catch (error) {
    logWarn("auth.session.clerkBridgeFailed", {
      code: (error as { code?: string } | null)?.code,
      clerkUserId,
    });
    return null;
  }
}

async function getSessionFromLegacyCookie(token: string): Promise<AdminSession | null> {

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  let expected = "";
  try {
    expected = sign(encoded);
  } catch {
    return null;
  }
  let signatureOk = false;
  try {
    signatureOk = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as {
      sub: string;
      role: string;
      exp: number;
      iat?: number;
    };

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSeconds) {
      return null;
    }
    const issuedAtSeconds = payload.iat ?? payload.exp - COOKIE_MAX_AGE_SECONDS;
    // Invalidate legacy long-lived tokens so all active sessions honor the 20-minute idle policy.
    if (payload.exp - issuedAtSeconds > COOKIE_MAX_AGE_SECONDS + 30) {
      return null;
    }

    if (payload.exp - nowSeconds <= SESSION_ROTATION_WINDOW_SECONDS) {
      const refreshed = createSessionToken(payload.sub, payload.role);
      try {
        await setSessionCookie(refreshed);
      } catch {
        // Ignore rotation errors in read-only rendering contexts.
      }
    }

    return {
      userId: payload.sub,
      role: payload.role,
      expiresAt: payload.exp,
      issuedAt: issuedAtSeconds,
      source: "legacy",
    };
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(
  options: GetSessionFromRequestOptions = {},
): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  // Deprecated fallback: keep legacy cookie auth until admin Clerk cutover completes in production.
  // Removal preconditions are documented in docs/security/CLERK_ADMIN_CUTOVER_RUNBOOK.md.
  // Keep legacy cookie auth as the primary source during migration.
  if (token) {
    const legacySession = await getSessionFromLegacyCookie(token);
    if (legacySession) {
      return legacySession;
    }
  }

  // Clerk admin bridge is opt-in via CLERK_PROTECT_ADMIN_ROUTES.
  return getSessionFromClerkBridge(options);
}
