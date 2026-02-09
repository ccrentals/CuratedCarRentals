import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { getSessionFromRequest } from "@/lib/auth/session";
import { getDbPool } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { logError } from "@/lib/log";

function isAdminRole(role: string | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase() === "ADMIN";
}

function generateTempPassword() {
  // Short, copy-friendly, URL-safe, and strong enough as a temporary secret.
  return randomBytes(9).toString("base64url"); // ~12 chars
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`"${column}"`) && message.includes("does not exist");
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  if ((action === "deactivate" || action === "reset_password") && userId === session.userId) {
    return NextResponse.json({ error: "You cannot modify your own account this way." }, { status: 400 });
  }

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      "select id, email, role, is_active, deactivated_at, locked_at from users where id = $1 for update",
      [userId],
    );

    if (existingResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existing = existingResult.rows[0] as {
      id: string;
      email: string;
      role: string;
      is_active?: boolean | null;
      deactivated_at?: string | null;
      locked_at?: string | null;
    };

    if (action === "set_role") {
      const roleRaw = typeof body?.role === "string" ? body.role.trim().toUpperCase() : "";
      const nextRole = roleRaw === "ADMIN" ? "ADMIN" : roleRaw === "USER" ? "USER" : "";
      if (!nextRole) {
        await client.query("rollback");
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }

      await client.query("update users set role = $2 where id = $1", [userId, nextRole]);
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

      await client.query("update users set locked_at = null where id = $1", [userId]);
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

      await client.query("update users set locked_at = now() where id = $1 and locked_at is null", [
        userId,
      ]);
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

      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h

      try {
        await client.query(
          "update users set password_hash = $2, must_change_password = true, temp_password_expires_at = $3, password_updated_at = now(), locked_at = null where id = $1",
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
      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "USER_PASSWORD_RESET",
        entityType: "user",
        entityId: userId,
        details: { reason, tempPasswordExpiresAt: expiresAt.toISOString() },
      });

      return NextResponse.json({
        ok: true,
        tempPassword,
        tempPasswordExpiresAt: expiresAt.toISOString(),
      });
    }

    if (action === "deactivate") {
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        await client.query("rollback");
        return NextResponse.json({ error: "Reason is required" }, { status: 400 });
      }

      try {
        await client.query(
          "update users set is_active = false, deactivated_at = now(), deactivated_by_user_id = $2, deactivated_reason = $3 where id = $1",
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
        await client.query(
          "update users set is_active = true, deactivated_at = null, deactivated_by_user_id = null, deactivated_reason = null where id = $1",
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
