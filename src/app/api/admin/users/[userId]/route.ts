import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { isDeveloperRole } from "@/lib/auth/roles";
import { getDbPool } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { logError } from "@/lib/log";
import { isEmail, isNonEmptyString } from "@/lib/validators";
import {
  buildClerkUsernameCandidates,
  isClerkSafeUsernameInput,
  isClerkUsernameError,
  normalizeUsernameForClerk,
} from "@/lib/security/clerkUsernames";
import { isClerkEnabled } from "@/lib/security/clerk";
import { revokePendingClerkInvitationsByEmail } from "@/lib/security/clerkInvitations";

type QueryResultRow = Record<string, unknown>;
type QueryResult = { rowCount: number; rows: QueryResultRow[] };
type QueryClient = {
  query: (sql: string, values?: unknown[]) => Promise<QueryResult>;
};

type ManagedUserRow = {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  username: string | null;
  clerk_user_id: string | null;
  is_active?: boolean | null;
  deactivated_at?: string | null;
  locked_at?: string | null;
};

function isPrivilegedRole(role: string | null | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

function normalizeUserId(value?: string | null) {
  if (!value) return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(value)) return null;
  return value;
}

function isLifecycleActiveUser(user: Pick<ManagedUserRow, "is_active" | "deactivated_at">) {
  return user.is_active !== false && !user.deactivated_at;
}

type ClerkPasswordResetSyncResult = {
  status: "synced" | "skipped";
  clerkUserId: string | null;
  message: string;
  localLinkWarning?: string;
};

function generateTempPassword() {
  // Short, copy-friendly, URL-safe, and strong enough as a temporary secret.
  return randomBytes(9).toString("base64url"); // ~12 chars
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`"${column}"`) && message.includes("does not exist");
}

function isClerkNotFoundError(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  const details = (error as { errors?: Array<{ code?: string }> } | null)?.errors ?? [];
  return (
    status === 404 ||
    message.includes("not found") ||
    details.some((issue) => String(issue?.code ?? "").toLowerCase().includes("not_found"))
  );
}

async function insertAuditLogWithClient(
  client: QueryClient,
  {
    userId,
    action,
    entityType,
    entityId,
    details = {},
  }: {
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    details?: Record<string, unknown>;
  },
) {
  await client.query(
    "insert into audit_logs (user_id, action, entity_type, entity_id, details_json) values ($1, $2, $3, $4, $5)",
    [normalizeUserId(userId), action, entityType, entityId ?? null, details],
  );
}

async function queryUserUpdate(
  client: QueryClient,
  sqlWithUpdatedAt: string,
  values: unknown[],
): Promise<QueryResult> {
  const fallbackSql = sqlWithUpdatedAt.replace(", updated_at = now()", "");
  const savepointName = "users_updated_at_fallback";

  await client.query(`savepoint ${savepointName}`);
  try {
    const result = await client.query(sqlWithUpdatedAt, values);
    await client.query(`release savepoint ${savepointName}`);
    return result;
  } catch (error) {
    if (!isUndefinedColumn(error, "updated_at")) {
      await client.query(`rollback to savepoint ${savepointName}`);
      await client.query(`release savepoint ${savepointName}`);
      throw error;
    }

    await client.query(`rollback to savepoint ${savepointName}`);
    const result = await client.query(fallbackSql, values);
    await client.query(`release savepoint ${savepointName}`);
    return result;
  }
}

async function loadUserForUpdate(client: QueryClient, userId: string): Promise<ManagedUserRow | null> {
  try {
    const result = await client.query(
      "select id, email, role, full_name, username, clerk_user_id, is_active, deactivated_at, locked_at from users where id = $1 for update",
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      id: String(row.id),
      email: String(row.email),
      role: String(row.role),
      full_name: typeof row.full_name === "string" ? row.full_name : null,
      username: typeof row.username === "string" ? row.username : null,
      clerk_user_id: typeof row.clerk_user_id === "string" ? row.clerk_user_id : null,
      is_active: typeof row.is_active === "boolean" ? row.is_active : null,
      deactivated_at: typeof row.deactivated_at === "string" ? row.deactivated_at : null,
      locked_at: typeof row.locked_at === "string" ? row.locked_at : null,
    };
  } catch (error) {
    if (
      !isUndefinedColumn(error, "full_name") &&
      !isUndefinedColumn(error, "username") &&
      !isUndefinedColumn(error, "clerk_user_id")
    ) {
      throw error;
    }
  }

  const fallback = await client.query(
    "select id, email, role, is_active, deactivated_at, locked_at from users where id = $1 for update",
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
    is_active: typeof row.is_active === "boolean" ? row.is_active : null,
    deactivated_at: typeof row.deactivated_at === "string" ? row.deactivated_at : null,
    locked_at: typeof row.locked_at === "string" ? row.locked_at : null,
  };
}

async function countActivePrivilegedUsers(
  client: QueryClient,
  options: { excludeUserId?: string } = {},
) {
  const values: unknown[] = [];
  const excludeSql = options.excludeUserId
    ? (() => {
        values.push(options.excludeUserId);
        return ` and id <> $${values.length}`;
      })()
    : "";

  try {
    const result = await client.query(
      `select count(*)::int as total
       from users
       where role in ('ADMIN', 'DEVELOPER')
         and coalesce(is_active, true) = true
         and deactivated_at is null${excludeSql}`,
      values,
    );
    return Number((result.rows[0]?.total as number | string | undefined) ?? 0);
  } catch (error) {
    if (!isUndefinedColumn(error, "is_active") && !isUndefinedColumn(error, "deactivated_at")) {
      throw error;
    }

    const fallback = await client.query(
      `select count(*)::int as total
       from users
       where role in ('ADMIN', 'DEVELOPER')${excludeSql}`,
      values,
    );
    return Number((fallback.rows[0]?.total as number | string | undefined) ?? 0);
  }
}

async function linkLocalUserToClerkId({
  client,
  localUserId,
  clerkUserId,
}: {
  client: QueryClient;
  localUserId: string;
  clerkUserId: string;
}) {
  try {
    const result = await queryUserUpdate(
      client,
      "update users set clerk_user_id = $2, updated_at = now() where id = $1 and (clerk_user_id is null or clerk_user_id = $2)",
      [localUserId, clerkUserId],
    );
    if (result.rowCount > 0) {
      return null;
    }
    return "users.clerk_user_id is already linked to a different Clerk user. Resolve mapping manually.";
  } catch (error) {
    if (isUndefinedColumn(error, "clerk_user_id")) {
      return "users.clerk_user_id column is missing. Apply migration 020_clerk_user_mapping.sql.";
    }
    throw error;
  }
}

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

async function syncClerkPasswordReset({
  client,
  localUser,
  tempPassword,
}: {
  client: QueryClient;
  localUser: ManagedUserRow;
  tempPassword: string;
}): Promise<ClerkPasswordResetSyncResult> {
  if (!isClerkEnabled()) {
    return {
      status: "skipped",
      clerkUserId: null,
      message: "Clerk is not configured in this environment. Applied legacy reset only.",
    };
  }

  const email = localUser.email.trim().toLowerCase();
  const clerk = await clerkClient();
  const usernameCandidates = buildClerkUsernameCandidates({
    localUsername: localUser.username,
    email,
    localUserId: localUser.id,
  });

  let clerkUser =
    localUser.clerk_user_id?.trim() && localUser.clerk_user_id
      ? await clerk.users.getUser(localUser.clerk_user_id).catch(() => null)
      : null;

  if (!clerkUser) {
    const existingByEmail = await clerk.users.getUserList({
      emailAddress: [email],
      limit: 1,
    });
    clerkUser = existingByEmail.data[0] ?? null;
  }

  if (!clerkUser) {
    const { firstName, lastName } = splitName(localUser.full_name, email);
    let created:
      | Awaited<ReturnType<Awaited<ReturnType<typeof clerkClient>>["users"]["createUser"]>>
      | null = null;
    let createError: unknown = null;

    for (const candidate of [...usernameCandidates, ""]) {
      try {
        created = await clerk.users.createUser({
          emailAddress: [email],
          firstName,
          lastName,
          password: tempPassword,
          skipLegalChecks: true,
          ...(candidate ? { username: candidate } : {}),
          privateMetadata: {
            localUserId: localUser.id,
            localRole: localUser.role,
            authProvisionedBy: "admin-password-reset-bootstrap",
          },
        });
        break;
      } catch (error) {
        createError = error;
        if (candidate && isClerkUsernameError(error)) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      throw createError ?? new Error("Unable to create Clerk user for password reset");
    }
    clerkUser = created;
  } else {
    const metadata = (clerkUser.privateMetadata ?? {}) as Record<string, unknown>;
    const updateBase: {
      password: string;
      privateMetadata: Record<string, unknown>;
      username?: string;
    } = {
      password: tempPassword,
      privateMetadata: {
        ...metadata,
        localUserId: localUser.id,
        localRole: localUser.role,
        authProvisionedBy: "admin-password-reset",
      },
    };

    if (clerkUser.username) {
      await clerk.users.updateUser(clerkUser.id, updateBase);
    } else {
      let updated = false;
      for (const candidate of usernameCandidates) {
        try {
          await clerk.users.updateUser(clerkUser.id, {
            ...updateBase,
            username: candidate,
          });
          updated = true;
          break;
        } catch (error) {
          if (isClerkUsernameError(error)) {
            continue;
          }
          throw error;
        }
      }
      if (!updated) {
        await clerk.users.updateUser(clerkUser.id, updateBase);
      }
    }
  }

  await clerk.users.setPasswordCompromised(clerkUser.id, {
    revokeAllSessions: true,
  });

  const mappingWarning = await linkLocalUserToClerkId({
    client,
    localUserId: localUser.id,
    clerkUserId: clerkUser.id,
  });

  return {
    status: "synced",
    clerkUserId: clerkUser.id,
    message: "Clerk password reset is enforced. User must set a new password at next login.",
    localLinkWarning: mappingWarning ?? undefined,
  };
}

async function deleteLinkedClerkUser(localUser: ManagedUserRow) {
  const clerkUserId = localUser.clerk_user_id?.trim() ?? "";
  if (!clerkUserId) {
    return {
      status: "not_linked" as const,
      clerkUserId: null,
    };
  }
  if (!isClerkEnabled()) {
    throw new Error("CLERK_DELETE_NOT_CONFIGURED");
  }

  const clerk = await clerkClient();
  try {
    await clerk.users.deleteUser(clerkUserId);
    return {
      status: "deleted" as const,
      clerkUserId,
    };
  } catch (error) {
    if (isClerkNotFoundError(error)) {
      return {
        status: "already_missing" as const,
        clerkUserId,
      };
    }
    throw error;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const auth = await requireAdminRole({ forbiddenMessage: "Forbidden" });
  if (!auth.ok) return auth.response;
  const session = auth.actor;

  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const { userId } = await params;
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";

  if (!action) {
    return NextResponse.json({ error: "Action is required" }, { status: 400 });
  }

  if (action === "deactivate" && userId === session.userId) {
    return NextResponse.json({ error: "You cannot modify your own account this way." }, { status: 400 });
  }

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const existing = await loadUserForUpdate(client, userId);
    if (!existing) {
      await client.query("rollback");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const actorIsDeveloper = isDeveloperRole(session.role);
    const targetIsDeveloper = isDeveloperRole(existing.role);
    if (targetIsDeveloper && !actorIsDeveloper) {
      await client.query("rollback");
      return NextResponse.json(
        { error: "Only developers can modify developer accounts." },
        { status: 403 },
      );
    }
    const existingIsPrivileged = isPrivilegedRole(existing.role);
    const existingIsActive = isLifecycleActiveUser(existing);

    if (action === "update_profile") {
      const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
      const emailRaw = typeof body?.email === "string" ? body.email.trim() : "";
      const usernameRaw = typeof body?.username === "string" ? body.username.trim() : "";
      const username = normalizeUsernameForClerk(usernameRaw);

      if (!isNonEmptyString(fullName, 2)) {
        await client.query("rollback");
        return NextResponse.json({ error: "A valid name is required." }, { status: 400 });
      }
      if (!isEmail(emailRaw)) {
        await client.query("rollback");
        return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
      }
      if (!isNonEmptyString(username, 3) || !isClerkSafeUsernameInput(usernameRaw)) {
        await client.query("rollback");
        return NextResponse.json(
          {
            error: "Invalid username. Use 3+ characters: letters, numbers, underscore, or dash.",
          },
          { status: 400 },
        );
      }

      const email = emailRaw.toLowerCase();
      const emailDup = await client.query(
        "select id from users where lower(email) = lower($1) and id <> $2 limit 1",
        [email, userId],
      );
      if (emailDup.rowCount > 0) {
        await client.query("rollback");
        return NextResponse.json({ error: "Email already exists." }, { status: 409 });
      }

      try {
        const usernameDup = await client.query(
          "select id from users where username is not null and lower(username) = lower($1) and id <> $2 limit 1",
          [username, userId],
        );
        if (usernameDup.rowCount > 0) {
          await client.query("rollback");
          return NextResponse.json({ error: "Username already exists." }, { status: 409 });
        }
      } catch (error) {
        if (isUndefinedColumn(error, "username")) {
          await client.query("rollback");
          return NextResponse.json(
            {
              error: "USER_PROFILE_NOT_CONFIGURED",
              message:
                "users.username column is missing. Apply schema.sql changes and redeploy.",
            },
            { status: 500 },
          );
        }
        throw error;
      }

      try {
        await queryUserUpdate(
          client,
          "update users set full_name = $2, email = $3, username = $4, updated_at = now() where id = $1",
          [userId, fullName, email, username],
        );
      } catch (error) {
        if (isUndefinedColumn(error, "full_name") || isUndefinedColumn(error, "username")) {
          await client.query("rollback");
          return NextResponse.json(
            {
              error: "USER_PROFILE_NOT_CONFIGURED",
              message:
                "users.full_name/username columns are missing. Apply schema.sql changes and redeploy.",
            },
            { status: 500 },
          );
        }
        throw error;
      }

      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "USER_PROFILE_UPDATED",
        entityType: "user",
        entityId: userId,
        details: {
          fullName,
          email,
          username,
        },
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "set_role") {
      const roleRaw = typeof body?.role === "string" ? body.role.trim().toUpperCase() : "";
      const nextRole =
        roleRaw === "DEVELOPER"
          ? "DEVELOPER"
          : roleRaw === "ADMIN"
            ? "ADMIN"
            : "";
      if (!nextRole) {
        await client.query("rollback");
        return NextResponse.json({ error: "Invalid role. Only ADMIN or DEVELOPER are allowed here." }, { status: 400 });
      }
      if (nextRole === "DEVELOPER" && !actorIsDeveloper) {
        await client.query("rollback");
        return NextResponse.json({ error: "Only developers can assign DEVELOPER role." }, { status: 403 });
      }
      const nextRoleIsPrivileged = isPrivilegedRole(nextRole);
      if (userId === session.userId && existingIsPrivileged && !nextRoleIsPrivileged) {
        await client.query("rollback");
        return NextResponse.json(
          { error: "You cannot remove your own admin access." },
          { status: 400 },
        );
      }
      if (existingIsPrivileged && existingIsActive && !nextRoleIsPrivileged) {
        const remainingPrivileged = await countActivePrivilegedUsers(client, {
          excludeUserId: userId,
        });
        if (remainingPrivileged < 1) {
          await client.query("rollback");
          return NextResponse.json(
            {
              error:
                "Cannot remove role from the last active privileged account (ADMIN/DEVELOPER).",
            },
            { status: 409 },
          );
        }
      }

      await queryUserUpdate(client, "update users set role = $2, updated_at = now() where id = $1", [
        userId,
        nextRole,
      ]);
      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "USER_ROLE_CHANGED",
        entityType: "user",
        entityId: userId,
        details: { fromRole: existing.role, toRole: nextRole },
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "unlock") {
      const note = typeof body?.reason === "string" ? body.reason.trim() : "";

      await queryUserUpdate(client, "update users set locked_at = null, updated_at = now() where id = $1", [
        userId,
      ]);
      await client.query("delete from admin_login_attempts where email = $1", [
        String(existing.email ?? "").toLowerCase(),
      ]);
      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "USER_UNLOCKED",
        entityType: "user",
        entityId: userId,
        details: note ? { note } : {},
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "lock") {
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        await client.query("rollback");
        return NextResponse.json({ error: "Reason is required" }, { status: 400 });
      }

      if (userId === session.userId) {
        await client.query("rollback");
        return NextResponse.json({ error: "You cannot lock your own account." }, { status: 400 });
      }

      await queryUserUpdate(
        client,
        "update users set locked_at = now(), updated_at = now() where id = $1 and locked_at is null",
        [userId],
      );
      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "USER_LOCKED",
        entityType: "user",
        entityId: userId,
        details: { reason },
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "reset_password") {
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        await client.query("rollback");
        return NextResponse.json({ error: "Reason is required" }, { status: 400 });
      }
      const isSelfReset = userId === session.userId;

      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h

      try {
        await queryUserUpdate(
          client,
          "update users set password_hash = $2, must_change_password = true, temp_password_expires_at = $3, password_updated_at = now(), locked_at = null, updated_at = now() where id = $1",
          [userId, passwordHash, expiresAt.toISOString()],
        );
      } catch (error) {
        if (
          isUndefinedColumn(error, "must_change_password") ||
          isUndefinedColumn(error, "temp_password_expires_at") ||
          isUndefinedColumn(error, "password_updated_at")
        ) {
          await client.query("rollback");
          return NextResponse.json(
            {
              error: "USER_PASSWORD_RESET_NOT_CONFIGURED",
              message:
                "users temporary-password columns are missing. Apply schema.sql changes and redeploy.",
            },
            { status: 500 },
          );
        }
        throw error;
      }

      await client.query("delete from admin_login_attempts where email = $1", [
        String(existing.email ?? "").toLowerCase(),
      ]);

      let clerkSync: ClerkPasswordResetSyncResult | null = null;
      try {
        clerkSync = await syncClerkPasswordReset({
          client,
          localUser: existing,
          tempPassword,
        });
      } catch (error) {
        await client.query("rollback");
        logError("api.admin.users.PATCH.clerkResetSync", error, {
          actorUserId: session.userId,
          targetUserId: userId,
        });
        return NextResponse.json(
          {
            error:
              "Password reset could not be synced with Clerk. No changes were applied. Try again or use legacy admin login flow.",
          },
          { status: 502 },
        );
      }

      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "USER_PASSWORD_RESET",
        entityType: "user",
        entityId: userId,
        details: {
          reason,
          tempPasswordExpiresAt: expiresAt.toISOString(),
          clerkSyncStatus: clerkSync.status,
          clerkUserId: clerkSync.clerkUserId,
        },
      });

      return NextResponse.json({
        ok: true,
        ...(isSelfReset
          ? {
              selfReset: true,
              message:
                "Password reset initiated. You will be signed out and prompted to set a new password at sign-in.",
            }
          : {
              tempPassword,
              tempPasswordExpiresAt: expiresAt.toISOString(),
            }),
        clerkSync,
      });
    }

    if (action === "deactivate") {
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        await client.query("rollback");
        return NextResponse.json({ error: "Reason is required" }, { status: 400 });
      }
      if (existingIsPrivileged && existingIsActive) {
        const remainingPrivileged = await countActivePrivilegedUsers(client, {
          excludeUserId: userId,
        });
        if (remainingPrivileged < 1) {
          await client.query("rollback");
          return NextResponse.json(
            {
              error:
                "Cannot deactivate the last active privileged account (ADMIN/DEVELOPER).",
            },
            { status: 409 },
          );
        }
      }

      try {
        await queryUserUpdate(
          client,
          "update users set is_active = false, deactivated_at = now(), deactivated_by_user_id = $2, deactivated_reason = $3, updated_at = now() where id = $1",
          [userId, session.userId, reason],
        );
      } catch (error) {
        if (isUndefinedColumn(error, "is_active")) {
          await client.query("rollback");
          return NextResponse.json(
            {
              error: "USER_LIFECYCLE_NOT_CONFIGURED",
              message: "users lifecycle columns are missing. Apply schema.sql changes and redeploy.",
            },
            { status: 500 },
          );
        }
        throw error;
      }

      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "USER_DEACTIVATED",
        entityType: "user",
        entityId: userId,
        details: { reason },
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "reactivate") {
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        await client.query("rollback");
        return NextResponse.json({ error: "Reason is required" }, { status: 400 });
      }

      try {
        await queryUserUpdate(
          client,
          "update users set is_active = true, deactivated_at = null, deactivated_by_user_id = null, deactivated_reason = null, updated_at = now() where id = $1",
          [userId],
        );
      } catch (error) {
        if (isUndefinedColumn(error, "is_active")) {
          await client.query("rollback");
          return NextResponse.json(
            {
              error: "USER_LIFECYCLE_NOT_CONFIGURED",
              message: "users lifecycle columns are missing. Apply schema.sql changes and redeploy.",
            },
            { status: 500 },
          );
        }
        throw error;
      }

      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "USER_REACTIVATED",
        entityType: "user",
        entityId: userId,
        details: { reason },
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "delete_user") {
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        await client.query("rollback");
        return NextResponse.json({ error: "Reason is required" }, { status: 400 });
      }
      if (userId === session.userId) {
        await client.query("rollback");
        return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
      }
      if (existingIsPrivileged && existingIsActive) {
        const remainingPrivileged = await countActivePrivilegedUsers(client, {
          excludeUserId: userId,
        });
        if (remainingPrivileged < 1) {
          await client.query("rollback");
          return NextResponse.json(
            {
              error:
                "Cannot delete the last active privileged account (ADMIN/DEVELOPER).",
            },
            { status: 409 },
          );
        }
      }

      const deleteResult = await client.query("delete from users where id = $1 returning id", [userId]);
      if (deleteResult.rowCount < 1) {
        await client.query("rollback");
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      await insertAuditLogWithClient(client, {
        userId: session.userId,
        action: "USER_DELETED",
        entityType: "user",
        entityId: userId,
        details: {
          reason,
          deletedUserId: existing.id,
          deletedUserEmail: existing.email,
          deletedUserFullName: existing.full_name,
          deletedUserUsername: existing.username,
          deletedUserRole: existing.role,
          deletedUserClerkUserId: existing.clerk_user_id,
          clerkDeleteStatus: "pending_cleanup",
          clerkDeleteUserId: existing.clerk_user_id,
          revokedInvitationIds: [],
          wasActive: existing.is_active ?? null,
          deactivatedAt: existing.deactivated_at ?? null,
          lockedAt: existing.locked_at ?? null,
        },
      });

      await client.query("commit");

      let warning: string | null = null;
      try {
        const clerkDelete = await deleteLinkedClerkUser(existing);
        const revokedInvitationIds = await revokePendingClerkInvitationsByEmail(existing.email);

        await writeAuditLog({
          userId: session.userId,
          action: "USER_DELETE_SYNC_COMPLETED",
          entityType: "user",
          entityId: userId,
          details: {
            deletedUserId: existing.id,
            deletedUserEmail: existing.email,
            deletedUserClerkUserId: existing.clerk_user_id,
            clerkDeleteStatus: clerkDelete.status,
            clerkDeleteUserId: clerkDelete.clerkUserId,
            revokedInvitationIds,
          },
        });
      } catch (error) {
        logError("api.admin.users.PATCH.clerkDelete", error, {
          actorUserId: session.userId,
          targetUserId: userId,
          clerkUserId: existing.clerk_user_id,
        });

        warning =
          error instanceof Error && error.message === "CLERK_DELETE_NOT_CONFIGURED"
            ? "User deleted locally, but Clerk cleanup is not configured in this environment. Remove the Clerk user or invitation manually if needed."
            : "User deleted locally, but Clerk cleanup could not be completed. Remove the Clerk user or invitation manually if needed.";

        await writeAuditLog({
          userId: session.userId,
          action: "USER_DELETE_SYNC_FAILED",
          entityType: "user",
          entityId: userId,
          details: {
            deletedUserId: existing.id,
            deletedUserEmail: existing.email,
            deletedUserClerkUserId: existing.clerk_user_id,
            warning,
          },
        }).catch(() => {});
      }

      return NextResponse.json(warning ? { ok: true, warning } : { ok: true });
    }

    await client.query("rollback");
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    await client.query("rollback");
    logError("api.admin.users.PATCH", error, { actorUserId: session.userId, targetUserId: userId, action });
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  } finally {
    client.release();
  }
}
