import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery, getDbPool } from "@/lib/db";
import { isEmail, isNonEmptyString } from "@/lib/validators";
import { hashPassword } from "@/lib/auth/password";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import { logError } from "@/lib/log";

function isAdminRole(role: string | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase() === "ADMIN";
}

function normalizeUsername(value: string) {
  const lower = value.trim().toLowerCase();
  // Allow dots for the requested `firstname.lastname` format.
  const replaced = lower.replace(/[^a-z0-9._-]+/g, "-");
  const collapsed = replaced
    .replace(/-+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return collapsed.slice(0, 32);
}

function normalizeNamePart(value: string) {
  // Keep it predictable for usernames: lowercase, alnum, dash/underscore only.
  // We intentionally do not allow dots in name parts; we add exactly one dot between first/last.
  return normalizeUsername(value).replace(/\./g, "-");
}

function generateTempPassword() {
  // Short, copy-friendly, URL-safe, and strong enough as a temporary secret.
  return randomBytes(9).toString("base64url"); // ~12 chars
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (!q) {
    const result = await dbQuery(
      "select id, email, username, full_name, role, is_active, deactivated_at, locked_at, created_at, last_login_at from users order by created_at desc",
    );
    return NextResponse.json({ users: result.rows });
  }

  const result = await dbQuery(
    "select id, email, username, full_name, role, is_active, deactivated_at, locked_at, created_at, last_login_at from users where (email ilike $1 or username ilike $1 or full_name ilike $1) order by created_at desc",
    [`%${q}%`],
  );
  return NextResponse.json({ users: result.rows });
}

export async function POST(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  let firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
  let lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
  let fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const roleRaw = typeof body?.role === "string" ? body.role.trim().toUpperCase() : "USER";
  const role = roleRaw === "ADMIN" ? "ADMIN" : "USER";

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
  const baseUsername = normalizeUsername(
    `${normalizeNamePart(firstName)}.${normalizeNamePart(lastName)}`,
  );
  if (!isNonEmptyString(baseUsername, 3)) {
    return NextResponse.json(
      { error: "Invalid username. Use 3+ characters: letters, numbers, dot, underscore, or dash." },
      { status: 400 },
    );
  }

  // Temporary password is displayed once to the admin.
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h

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

    let usernameFinal = baseUsername;
    try {
      // Auto-generate a unique username from the requested `firstname.lastname` format.
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const usernameDup = await client.query(
          "select id from users where username is not null and lower(username) = lower($1) limit 1",
          [usernameFinal],
        );
        if (usernameDup.rowCount === 0) break;

        const suffix = String(attempt + 2);
        const maxBaseLength = Math.max(0, 32 - (suffix.length + 1));
        usernameFinal = `${baseUsername.slice(0, maxBaseLength)}-${suffix}`;
      }

      const usernameDupFinal = await client.query(
        "select id from users where username is not null and lower(username) = lower($1) limit 1",
        [usernameFinal],
      );
      if (usernameDupFinal.rowCount > 0) {
        await client.query("rollback");
        return NextResponse.json(
          { error: "Unable to generate a unique username. Try a different one." },
          { status: 409 },
        );
      }
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const message = String((error as { message?: unknown } | null)?.message ?? "");
      if (!(code === "42703" && message.includes("\"username\"") && message.includes("does not exist"))) {
        throw error;
      }
    }

    const insert = await (async () => {
      try {
        return await client.query(
          "insert into users (email, username, full_name, password_hash, role, is_active, must_change_password, temp_password_expires_at, password_updated_at) values ($1, $2, $3, $4, $5, true, true, $6, now()) returning id",
          [emailLower, usernameFinal, fullNameFinal, passwordHash, role, expiresAt.toISOString()],
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

    await client.query("commit");

    await writeAuditLog({
      userId: session.userId,
      action: "USER_CREATED",
      entityType: "user",
      entityId: newUserId,
      details: { role, email: emailLower, username: usernameFinal },
    });

    return NextResponse.json({
      ok: true,
      userId: newUserId,
      username: usernameFinal,
      tempPassword,
      tempPasswordExpiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    await client.query("rollback");
    logError("api.admin.users.POST", error, { actorUserId: session.userId, email: emailLower, role });
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  } finally {
    client.release();
  }
}
