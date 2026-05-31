import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TARGET_EMAIL = "damian.ay.thompson@gmail.com";

function secureEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const expectedToken = process.env.ONE_TIME_ADMIN_RESET_TOKEN?.trim() ?? "";
  const providedToken = request.headers.get("x-admin-reset-token")?.trim() ?? "";

  if (!expectedToken || !providedToken || !secureEquals(providedToken, expectedToken)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    temporaryPassword?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const temporaryPassword =
    typeof body?.temporaryPassword === "string" ? body.temporaryPassword.trim() : "";

  if (email !== TARGET_EMAIL || temporaryPassword.length < 10) {
    return NextResponse.json({ ok: false, error: "Invalid reset request" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  const result = await dbQuery<{
    id: string;
    email: string;
    role: string;
    is_active: boolean | null;
  }>(
    `update users
     set password_hash = $2,
         must_change_password = true,
         temp_password_expires_at = $3,
         password_updated_at = now(),
         locked_at = null,
         clerk_user_id = null,
         updated_at = now()
     where lower(email) = lower($1)
     returning id, email, role, is_active`,
    [TARGET_EMAIL, passwordHash, expiresAt],
  );

  await dbQuery("delete from admin_login_attempts where lower(email) = lower($1)", [
    TARGET_EMAIL,
  ]);

  const row = result.rows[0] ?? null;
  if (!row) {
    return NextResponse.json({ ok: false, error: "Target user not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    email: row.email,
    role: row.role,
    isActive: row.is_active !== false,
    expiresAt,
  });
}
