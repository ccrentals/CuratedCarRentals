import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { dbQuery } from "@/lib/db";
import { isNonEmptyString } from "@/lib/validators";
import { requireCsrf } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit";

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`\"${column}\"`) && message.includes("does not exist");
}

export async function POST(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const password = typeof body?.password === "string" ? body.password : "";
  const confirmPassword = typeof body?.confirmPassword === "string" ? body.confirmPassword : "";

  if (!isNonEmptyString(password, 8)) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (confirmPassword && confirmPassword !== password) {
    return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
  }

  type UserRow = {
    must_change_password?: boolean | null;
    temp_password_expires_at?: string | null;
  };

  const userResult: { rows: UserRow[] } = await (async () => {
    try {
      return await dbQuery<UserRow>(
        "select must_change_password, temp_password_expires_at from users where id = $1 limit 1",
        [session.userId],
      );
    } catch (error) {
      // If the DB isn't migrated yet, fail with a clear message instead of crashing.
      if (
        isUndefinedColumn(error, "must_change_password") ||
        isUndefinedColumn(error, "temp_password_expires_at")
      ) {
        return { rows: [{ must_change_password: false, temp_password_expires_at: null }] };
      }
      throw error;
    }
  })();

  const user = userResult.rows[0];
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

  const passwordHash = await hashPassword(password);

  await dbQuery(
    "update users set password_hash = $2, must_change_password = false, temp_password_expires_at = null, password_updated_at = now() where id = $1",
    [session.userId, passwordHash],
  );

  await writeAuditLog({
    userId: session.userId,
    action: "USER_PASSWORD_SET",
    entityType: "user",
    entityId: session.userId,
    details: { flow: "first_login" },
  });

  return NextResponse.json({ ok: true });
}

