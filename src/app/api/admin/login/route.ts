import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";

import { dbQuery } from "@/lib/db";
import { isEmail, isNonEmptyString } from "@/lib/validators";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { requireCsrf } from "@/lib/security/csrf";
import {
  buildClerkUsernameCandidates,
  isClerkPasswordPolicyError,
  isClerkUsernameError,
} from "@/lib/security/clerkUsernames";
import { writeAuditLog } from "@/lib/audit";
import { logWarn } from "@/lib/log";
import { isClerkEnabled } from "@/lib/security/clerk";
import { isAppTheme, type AppTheme, THEME_COOKIE_NAME } from "@/lib/theme";

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`\"${column}\"`) && message.includes("does not exist");
}

const PROFILE_KEY_PREFIX = "user_profile:";

function profileKey(userId: string) {
  return `${PROFILE_KEY_PREFIX}${userId}`;
}

function parseThemePreference(content: unknown): AppTheme | null {
  if (typeof content !== "string" || !content.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as { theme?: unknown };
    return isAppTheme(parsed.theme) ? parsed.theme : null;
  } catch {
    return null;
  }
}

type LegacyLoginClerkLinkContext = {
  userId: string;
  email: string;
  localUsername: string | null;
  role: string;
  fullName: string | null;
  clerkUserId: string | null;
  password: string;
};

function splitName(fullName: string | null, email: string) {
  const clean = fullName?.trim() ?? "";
  if (clean) {
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return { firstName: parts[0], lastName: "Admin" };
    }
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  }

  const localPart = email.split("@")[0]?.trim() ?? "Admin";
  return { firstName: localPart.slice(0, 64), lastName: "Admin" };
}

function generateClerkBootstrapPassword() {
  return `Ccr!${randomBytes(24).toString("base64url")}Aa9`;
}

async function linkLocalUserToClerkId(localUserId: string, clerkUserId: string) {
  try {
    await dbQuery(
      "update users set clerk_user_id = $2 where id = $1 and (clerk_user_id is null or clerk_user_id = $2)",
      [localUserId, clerkUserId],
    );
  } catch (error) {
    if (!isUndefinedColumn(error, "clerk_user_id")) {
      throw error;
    }
  }
}

async function ensureClerkBridgeForLegacyLogin(context: LegacyLoginClerkLinkContext) {
  if (!isClerkEnabled()) {
    return;
  }

  const existingClerkId = context.clerkUserId?.trim();
  if (existingClerkId) {
    return;
  }

  try {
    const clerk = await clerkClient();
    const usernameCandidates = buildClerkUsernameCandidates({
      localUsername: context.localUsername,
      email: context.email,
      localUserId: context.userId,
    });
    const existing = await clerk.users.getUserList({
      emailAddress: [context.email],
      limit: 1,
    });

    const existingUser = existing.data[0] ?? null;
    let clerkUserId = existingUser?.id ?? "";

    if (existingUser && !existingUser.username) {
      for (const candidate of usernameCandidates) {
        try {
          await clerk.users.updateUser(existingUser.id, { username: candidate });
          break;
        } catch (error) {
          if (isClerkUsernameError(error)) {
            continue;
          }
          throw error;
        }
      }
    }

    if (!clerkUserId) {
      const { firstName, lastName } = splitName(context.fullName, context.email);
      const createWithPassword = async (password: string, forceResetAfterCreate: boolean) => {
        let lastError: unknown = null;
        const attempts = [...usernameCandidates, ""];
        for (const candidate of attempts) {
          try {
            const created = await clerk.users.createUser({
              emailAddress: [context.email],
              password,
              firstName,
              lastName,
              skipLegalChecks: true,
              ...(candidate ? { username: candidate } : {}),
              privateMetadata: {
                localUserId: context.userId,
                localRole: context.role,
                authProvisionedBy: "legacy-admin-login",
              },
            });

            if (forceResetAfterCreate) {
              await clerk.users.setPasswordCompromised(created.id, {
                revokeAllSessions: true,
              });
            }
            return created.id;
          } catch (error) {
            lastError = error;
            if (candidate && isClerkUsernameError(error)) {
              continue;
            }
            throw error;
          }
        }
        throw lastError ?? new Error("Unable to create Clerk user");
      };

      try {
        clerkUserId = await createWithPassword(context.password, false);
      } catch (error) {
        if (!isClerkPasswordPolicyError(error)) {
          throw error;
        }
        clerkUserId = await createWithPassword(generateClerkBootstrapPassword(), true);
        logWarn("api.admin.login.clerkBridgePasswordPolicyFallback", {
          userId: context.userId,
          email: context.email,
        });
      }
    }

    if (!clerkUserId) {
      return;
    }

    await linkLocalUserToClerkId(context.userId, clerkUserId);
  } catch (error) {
    logWarn("api.admin.login.clerkBridgeSyncFailed", {
      userId: context.userId,
      email: context.email,
      code: (error as { errors?: Array<{ code?: string }>; code?: string } | null)?.errors?.[0]
        ?.code,
    });
  }
}

export async function POST(request: Request) {
  // Deprecated during Clerk admin migration:
  // keep this endpoint for break-glass access until at least one stable release cycle passes
  // with CLERK_PROTECT_ADMIN_ROUTES=1 and no fallback usage.
  const body = await request.json().catch(() => null);
  const identifierRaw = body?.identifier ?? body?.email;
  const identifier = typeof identifierRaw === "string" ? identifierRaw.trim() : "";
  const password = body?.password;

  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  if (!isNonEmptyString(identifier, 3) || !isNonEmptyString(password, 4)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const identifierLower = identifier.toLowerCase();
  const lookupByEmail = isEmail(identifier);
  const ip = getClientIp(request);

  const windowMinutes = 15;
  const maxAttempts = 5;

  // Always rate-limit by IP before any account lookup to reduce brute-force risk.
  const ipRateResult = await dbQuery<{ count: string }>(
    "select count(*) from admin_login_attempts where created_at > now() - ($2 || ' minutes')::interval and success = false and ip = $1",
    [ip, String(windowMinutes)],
  );
  const recentIpFailures = Number(ipRateResult.rows[0]?.count ?? 0);
  if (recentIpFailures >= maxAttempts * 4) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  type UserRow = {
    id: string;
    email: string;
    password_hash: string;
    role: string;
    locked_at: string | null;
    is_active?: boolean | null;
    deactivated_at?: string | null;
    must_change_password?: boolean | null;
    temp_password_expires_at?: string | null;
  };

  const userResult: { rows: UserRow[] } = await (async () => {
    const whereClause = lookupByEmail ? "lower(email) = lower($1)" : "lower(username) = lower($1)";
    try {
      return await dbQuery<UserRow>(
        `select id, email, password_hash, role, locked_at, is_active, deactivated_at, must_change_password, temp_password_expires_at from users where ${whereClause} and role in ('ADMIN','DEVELOPER','admin','developer') limit 1`,
        [identifierLower],
      );
    } catch (error) {
      if (!lookupByEmail && isUndefinedColumn(error, "username")) {
        return { rows: [] };
      }
      // Graceful fallback if lifecycle columns aren't installed yet.
      if (
        isUndefinedColumn(error, "is_active") ||
        isUndefinedColumn(error, "deactivated_at") ||
        isUndefinedColumn(error, "must_change_password") ||
        isUndefinedColumn(error, "temp_password_expires_at")
      ) {
        return await dbQuery<UserRow>(
          `select id, email, password_hash, role, locked_at from users where ${whereClause} and role in ('ADMIN','DEVELOPER','admin','developer') limit 1`,
          [identifierLower],
        );
      }
      throw error;
    }
  })();

  const user = userResult.rows[0];
  if (!user) {
    await dbQuery(
      "insert into admin_login_attempts (email, ip, success) values ($1, $2, false)",
      [identifierLower, ip],
    );
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const attemptsKey = String(user.email ?? "").toLowerCase() || identifierLower;
  const rateResult = await dbQuery<{ count: string }>(
    "select count(*) from admin_login_attempts where created_at > now() - ($3 || ' minutes')::interval and success = false and (email = $1 or ip = $2)",
    [attemptsKey, ip, String(windowMinutes)],
  );
  const recentFailures = Number(rateResult.rows[0]?.count ?? 0);

  if (user.locked_at) {
    await dbQuery(
      "insert into admin_login_attempts (email, ip, success) values ($1, $2, false)",
      [attemptsKey, ip],
    );
    return NextResponse.json({ error: "You are locked out." }, { status: 429 });
  }

  if (user.is_active === false || user.deactivated_at) {
    await dbQuery(
      "insert into admin_login_attempts (email, ip, success) values ($1, $2, false)",
      [attemptsKey, ip],
    );
    return NextResponse.json({ error: "Account is deactivated." }, { status: 403 });
  }

  if (recentFailures >= maxAttempts) {
    const locked = await dbQuery<{ locked_at: string }>(
      "update users set locked_at = now() where id = $1 and locked_at is null returning locked_at",
      [user.id],
    );
    if (locked.rowCount > 0) {
      try {
        await writeAuditLog({
          userId: null,
          action: "AUTO_LOCK_TRIGGERED",
          entityType: "user",
          entityId: user.id,
          details: {
            actor: "system",
            targetEmail: user.email,
            ip,
            windowMinutes,
            maxAttempts,
            recentFailures,
          },
        });
      } catch (error) {
        logWarn("audit.auto_lock_failed", {
          code: (error as { code?: string } | null)?.code,
        });
      }
    }
    await dbQuery(
      "insert into admin_login_attempts (email, ip, success) values ($1, $2, false)",
      [attemptsKey, ip],
    );
    return NextResponse.json({ error: "You are locked out." }, { status: 429 });
  }

  if (!user.password_hash.startsWith("$2")) {
    await dbQuery(
      "insert into admin_login_attempts (email, ip, success) values ($1, $2, false)",
      [attemptsKey, ip],
    );
    return NextResponse.json(
      { error: "Password hash must be upgraded. Reset admin credentials." },
      { status: 401 },
    );
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    await dbQuery(
      "insert into admin_login_attempts (email, ip, success) values ($1, $2, false)",
      [attemptsKey, ip],
    );
    if (recentFailures + 1 >= maxAttempts) {
      const locked = await dbQuery<{ locked_at: string }>(
        "update users set locked_at = now() where id = $1 and locked_at is null returning locked_at",
        [user.id],
      );
      if (locked.rowCount > 0) {
        try {
          await writeAuditLog({
            userId: null,
            action: "AUTO_LOCK_TRIGGERED",
            entityType: "user",
            entityId: user.id,
            details: {
              actor: "system",
              targetEmail: user.email,
              ip,
              windowMinutes,
              maxAttempts,
              recentFailures: recentFailures + 1,
            },
          });
        } catch (error) {
          logWarn("audit.auto_lock_failed", {
            code: (error as { code?: string } | null)?.code,
          });
        }
      }
      return NextResponse.json({ error: "You are locked out." }, { status: 429 });
    }
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (user.must_change_password && user.temp_password_expires_at) {
    const expiresAtMs = new Date(user.temp_password_expires_at).getTime();
    if (!Number.isNaN(expiresAtMs) && expiresAtMs < Date.now()) {
      await dbQuery(
        "insert into admin_login_attempts (email, ip, success) values ($1, $2, false)",
        [attemptsKey, ip],
      );
      return NextResponse.json(
        { error: "Temporary password expired. Contact an administrator." },
        { status: 403 },
      );
    }
  }

  const token = createSessionToken(user.id, user.role);
  await setSessionCookie(token);
  await dbQuery(
    "insert into admin_login_attempts (email, ip, success) values ($1, $2, true)",
    [attemptsKey, ip],
  );
  try {
    await dbQuery("update users set last_login_at = now(), last_login_ip = $2 where id = $1", [
      user.id,
      ip,
    ]);
  } catch (error) {
    // Allow login even if the DB hasn't been migrated with last_login_* columns.
    if (!isUndefinedColumn(error, "last_login_at") && !isUndefinedColumn(error, "last_login_ip")) {
      logWarn("api.admin.login.lastLoginMetadata", {
        code: (error as { code?: string } | null)?.code,
      });
    }
  }

  const clerkLinkResult = await (async () => {
    try {
      const mapping = await dbQuery<{
        clerk_user_id: string | null;
        full_name: string | null;
        username: string | null;
      }>(
        "select clerk_user_id, full_name, username from users where id = $1 limit 1",
        [user.id],
      );
      return {
        clerkUserId: mapping.rows[0]?.clerk_user_id ?? null,
        fullName: mapping.rows[0]?.full_name ?? null,
        localUsername: mapping.rows[0]?.username ?? null,
      };
    } catch (error) {
      if (
        isUndefinedColumn(error, "clerk_user_id") ||
        isUndefinedColumn(error, "full_name") ||
        isUndefinedColumn(error, "username")
      ) {
        return { clerkUserId: null, fullName: null, localUsername: null };
      }
      throw error;
    }
  })();

  // Best-effort compatibility bridge: keep legacy login functional even if Clerk provisioning fails.
  await ensureClerkBridgeForLegacyLogin({
    userId: user.id,
    email: user.email,
    localUsername: clerkLinkResult.localUsername,
    role: user.role,
    fullName: clerkLinkResult.fullName,
    clerkUserId: clerkLinkResult.clerkUserId,
    password,
  });

  let theme: AppTheme = "light";
  try {
    const profileResult = await dbQuery<{ content: string | null }>(
      "select content from admin_documents where key = $1 limit 1",
      [profileKey(user.id)],
    );
    theme = parseThemePreference(profileResult.rows[0]?.content ?? null) ?? "light";
  } catch (error) {
    // Allow login if settings storage isn't configured yet.
    const code = (error as { code?: string } | null)?.code;
    if (code !== "42P01") {
      logWarn("api.admin.login.theme", { code });
    }
  }

  const response = NextResponse.json({
    ok: true,
    mustChangePassword: Boolean(user.must_change_password),
    theme,
  });
  response.cookies.set(THEME_COOKIE_NAME, theme, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return response;
}
