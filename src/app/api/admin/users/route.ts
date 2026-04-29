import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { isDeveloperRole } from "@/lib/auth/roles";
import { dbQuery, getDbPool } from "@/lib/db";
import { isEmail, isNonEmptyString } from "@/lib/validators";
import { hashPassword } from "@/lib/auth/password";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import { logError } from "@/lib/log";
import {
  generateStandardUsernameBase,
  resolveUsernameCollision,
} from "@/lib/auth/username";

function generateBootstrapPassword() {
  return `Ccr!${randomBytes(24).toString("base64url")}Aa9`;
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`\"${column}\"`) && message.includes("does not exist");
}

export type AdminUserListRow = {
  id: string;
  public_id: string | null;
  email: string;
  username: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean | null;
  deactivated_at: string | null;
  locked_at: string | null;
  created_at: string;
  last_login_at: string | null;
};

export async function fetchAdminUsers(input: { q?: string } = {}) {
  const q = (input.q ?? "").trim();
  const values = q ? [`%${q}%`] : [];

  try {
    const result = await dbQuery<AdminUserListRow>(
      "select id, public_id, email, username, full_name, role, is_active, deactivated_at, locked_at, created_at, last_login_at from users" +
        (q
          ? " where (email ilike $1 or username ilike $1 or full_name ilike $1 or public_id ilike $1)"
          : "") +
        " order by created_at desc",
      values,
    );
    return result.rows;
  } catch (error) {
    if (!isUndefinedColumn(error, "public_id")) {
      throw error;
    }

    const fallback = await dbQuery<AdminUserListRow>(
      "select id, null::text as public_id, email, username, full_name, role, is_active, deactivated_at, locked_at, created_at, last_login_at from users" +
        (q ? " where (email ilike $1 or username ilike $1 or full_name ilike $1)" : "") +
        " order by created_at desc",
      values,
    );
    return fallback.rows;
  }
}

type OnboardingSetupResult = {
  status: "local_setup_required";
  message: string;
  setupPath: string;
};

export function buildAdminUserCreateSuccessPayload(input: {
  userId: string;
  userPublicId: string | null;
  username: string;
  setupEmail: string;
  onboarding: OnboardingSetupResult;
}) {
  return {
    ok: true as const,
    userId: input.userId,
    userPublicId: input.userPublicId,
    username: input.username,
    setupEmail: input.setupEmail,
    onboarding: input.onboarding,
  };
}

async function resolveLocalUsernameForCreate({
  client,
  baseUsername,
}: {
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rowCount: number }> };
  baseUsername: string;
}) {
  return resolveUsernameCollision(baseUsername, async (candidate) => {
    try {
      const usernameDup = await client.query(
        "select id from users where username is not null and lower(username) = lower($1) limit 1",
        [candidate],
      );
      return usernameDup.rowCount > 0;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const message = String((error as { message?: unknown } | null)?.message ?? "");
      if (code === "42703" && message.includes("\"username\"") && message.includes("does not exist")) {
        throw new Error("USERNAMES_NOT_CONFIGURED");
      }
      throw error;
    }
  });
}

export async function GET(request: Request) {
  const auth = await requireAdminRole({ forbiddenMessage: "Forbidden" });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const users = await fetchAdminUsers({ q: searchParams.get("q") ?? "" });
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireAdminRole({ forbiddenMessage: "Forbidden" });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  let firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
  let lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
  let fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const roleRaw = typeof body?.role === "string" ? body.role.trim().toUpperCase() : "";
  const role =
    roleRaw === "DEVELOPER"
      ? "DEVELOPER"
      : roleRaw === "ADMIN"
        ? "ADMIN"
        : "";
  if (!role) {
    return NextResponse.json({ error: "Invalid role. Only ADMIN or DEVELOPER can be created here." }, { status: 400 });
  }
  if (role === "DEVELOPER" && !isDeveloperRole(actor.role)) {
    return NextResponse.json({ error: "Only developers can assign DEVELOPER role." }, { status: 403 });
  }

  if (!firstName || !lastName) {
    // Backwards-compatible parsing if older clients still send a single fullName field.
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      firstName = firstName || parts[0];
      lastName = lastName || parts[parts.length - 1];
      fullName = fullName || parts.join(" ");
    }
  }

  if (!isNonEmptyString(firstName, 1)) {
    return NextResponse.json({ error: "firstName is required" }, { status: 400 });
  }
  if (!isNonEmptyString(lastName, 1)) {
    return NextResponse.json({ error: "lastName is required" }, { status: 400 });
  }
  if (!isEmail(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const emailLower = email.toLowerCase();
  const fullNameFinal = `${firstName} ${lastName}`.trim();
  const baseUsername = generateStandardUsernameBase({
    firstName,
    lastName,
    fullName: fullNameFinal,
    email: emailLower,
  });
  if (!isNonEmptyString(baseUsername, 3)) {
    return NextResponse.json(
      { error: "Invalid username. Use 3+ characters: letters, numbers, underscore, or dash." },
      { status: 400 },
    );
  }

  const bootstrapPassword = generateBootstrapPassword();
  const passwordHash = await hashPassword(bootstrapPassword);
  const setupPath = "/sign-up?redirect=%2Fadmin";

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const dup = await client.query("select id from users where lower(email) = lower($1) limit 1", [
      emailLower,
    ]);
    if (dup.rowCount > 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }

    const usernameFinal = await (async () => {
      try {
        return await resolveLocalUsernameForCreate({
          client,
          baseUsername,
        });
      } catch (error) {
        if ((error as Error).message === "USERNAMES_NOT_CONFIGURED") {
          await client.query("rollback");
          return null;
        }
        throw error;
      }
    })();

    if (!usernameFinal) {
      return NextResponse.json(
        {
          error: "USERNAMES_NOT_CONFIGURED",
          message: "users.username column is missing. Apply schema.sql changes and redeploy.",
        },
        { status: 500 },
      );
    }

    const insert = await (async () => {
      try {
        return await client.query(
          "insert into users (email, username, full_name, password_hash, role, is_active, must_change_password, temp_password_expires_at, password_updated_at) values ($1, $2, $3, $4, $5, true, false, null, now()) returning id, public_id",
          [emailLower, usernameFinal, fullNameFinal, passwordHash, role],
        );
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        const message = String((error as { message?: unknown } | null)?.message ?? "");
        if (code === "42703" && message.includes("\"username\"") && message.includes("does not exist")) {
          await client.query("rollback");
          return null;
        }
        throw error;
      }
    })();
    if (!insert) {
      return NextResponse.json(
        {
          error: "USERNAMES_NOT_CONFIGURED",
          message: "users.username column is missing. Apply schema.sql changes and redeploy.",
        },
        { status: 500 },
      );
    }
    const newUserId = String(insert.rows[0]?.id);
    const newUserPublicId = String(insert.rows[0]?.public_id ?? "").trim() || null;

    await client.query("commit");

    await writeAuditLog({
      userId: actor.userId,
      action: "USER_CREATED",
      entityType: "user",
      entityId: newUserId,
      details: {
        role,
        email: emailLower,
        username: usernameFinal,
        onboardingStatus: "local_setup_required",
        setupPath,
      },
    });

    return NextResponse.json(
      buildAdminUserCreateSuccessPayload({
        userId: newUserId,
        userPublicId: newUserPublicId,
        username: usernameFinal,
        setupEmail: emailLower,
        onboarding: {
          status: "local_setup_required",
          message:
            "Local user created. Complete account setup from the dedicated setup page before signing in with Clerk.",
          setupPath,
        },
      }),
    );
  } catch (error) {
    await client.query("rollback").catch(() => {});
    logError("api.admin.users.POST", error, { actorUserId: actor.userId, email: emailLower, role });
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  } finally {
    client.release();
  }
}
