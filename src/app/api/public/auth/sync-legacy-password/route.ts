import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

import { parseAppRole } from "@/lib/auth/roles";
import { hashPassword } from "@/lib/auth/password";
import { dbQuery } from "@/lib/db";
import { isClerkEnabled } from "@/lib/security/clerk";
import { requireCsrf } from "@/lib/security/csrf";
import { isNonEmptyString } from "@/lib/validators";

type LocalUserRow = {
  id: string;
  email: string;
  role: string;
  clerk_user_id: string | null;
};

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return code === "42703" && message.includes(`"${column.toLowerCase()}"`) && message.includes("does not exist");
}

function isMissingTable(error: unknown, table: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return code === "42p01" && message.includes(table.toLowerCase());
}

function readEmailFromSessionClaims(sessionClaims: unknown) {
  if (!sessionClaims || typeof sessionClaims !== "object") {
    return null;
  }
  const claims = sessionClaims as Record<string, unknown>;
  const raw = claims.email ?? claims.email_address ?? claims.primary_email_address;
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null;
}

async function findLocalUserForClerkIdentity({
  clerkUserId,
  email,
}: {
  clerkUserId: string;
  email: string | null;
}) {
  let user: LocalUserRow | null = null;
  let hasClerkColumn = true;

  try {
    const byClerk = await dbQuery<LocalUserRow>(
      "select id, email, role, clerk_user_id from users where clerk_user_id = $1 limit 1",
      [clerkUserId],
    );
    user = byClerk.rows[0] ?? null;
  } catch (error) {
    if (!isUndefinedColumn(error, "clerk_user_id")) {
      throw error;
    }
    hasClerkColumn = false;
  }

  if (!user && email) {
    const selectColumns = hasClerkColumn ? "id, email, role, clerk_user_id" : "id, email, role";
    const byEmail = await dbQuery<LocalUserRow>(
      `select ${selectColumns} from users where lower(email) = lower($1) limit 1`,
      [email],
    );
    user = byEmail.rows[0] ?? null;

    if (user && hasClerkColumn) {
      const existingClerkId = user.clerk_user_id?.trim();
      if (!existingClerkId) {
        try {
          await dbQuery(
            "update users set clerk_user_id = $2 where id = $1 and clerk_user_id is null",
            [user.id, clerkUserId],
          );
        } catch (error) {
          if (!isUndefinedColumn(error, "clerk_user_id")) {
            throw error;
          }
        }
      }
    }
  }

  return user;
}

async function updateLocalPassword(userId: string, passwordHash: string) {
  try {
    await dbQuery(
      "update users set password_hash = $2, must_change_password = false, temp_password_expires_at = null, password_updated_at = now(), locked_at = null where id = $1",
      [userId, passwordHash],
    );
    return;
  } catch (error) {
    if (
      !isUndefinedColumn(error, "must_change_password") &&
      !isUndefinedColumn(error, "temp_password_expires_at") &&
      !isUndefinedColumn(error, "password_updated_at") &&
      !isUndefinedColumn(error, "locked_at")
    ) {
      throw error;
    }
  }

  try {
    await dbQuery("update users set password_hash = $2, locked_at = null where id = $1", [
      userId,
      passwordHash,
    ]);
    return;
  } catch (error) {
    if (!isUndefinedColumn(error, "locked_at")) {
      throw error;
    }
  }

  await dbQuery("update users set password_hash = $2 where id = $1", [userId, passwordHash]);
}

export async function POST(request: Request) {
  if (!isClerkEnabled()) {
    return NextResponse.json(
      { error: "Clerk is not configured in this environment." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const password = typeof body?.password === "string" ? body.password : "";
  if (!isNonEmptyString(password, 8)) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const authState = await auth().catch(() => null);
  if (!authState?.userId || authState.sessionStatus !== "active") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clerkUserId = authState.userId;
  let email = readEmailFromSessionClaims(authState.sessionClaims);
  if (!email) {
    const clerkUser = await currentUser().catch(() => null);
    const primary = clerkUser?.emailAddresses.find(
      (item) => item.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress;
    if (primary?.trim()) {
      email = primary.trim().toLowerCase();
    }
  }

  const localUser = await findLocalUserForClerkIdentity({ clerkUserId, email });
  if (!localUser || !parseAppRole(localUser.role)) {
    return NextResponse.json({ ok: true, message: "No eligible local user found to sync." });
  }

  const passwordHash = await hashPassword(password);
  await updateLocalPassword(localUser.id, passwordHash);

  try {
    await dbQuery("delete from admin_login_attempts where email = $1", [localUser.email.toLowerCase()]);
  } catch (error) {
    if (!isMissingTable(error, "admin_login_attempts")) {
      throw error;
    }
  }

  return NextResponse.json({ ok: true });
}

