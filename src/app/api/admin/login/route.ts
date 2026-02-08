import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { isEmail, isNonEmptyString } from "@/lib/validators";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { requireCsrf } from "@/lib/security/csrf";

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = body?.email;
  const password = body?.password;

  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  if (!isEmail(email) || !isNonEmptyString(password, 4)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const emailLower = String(email).trim().toLowerCase();
  const ip = getClientIp(request);

  const windowMinutes = 15;
  const maxAttempts = 5;
  const rateResult = await dbQuery<{ count: string }>(
    "select count(*) from admin_login_attempts where created_at > now() - ($3 || ' minutes')::interval and success = false and (email = $1 or ip = $2)",
    [emailLower, ip, String(windowMinutes)],
  );
  const recentFailures = Number(rateResult.rows[0]?.count ?? 0);
  const result = await dbQuery<{
    id: string;
    email: string;
    password_hash: string;
    role: string;
    locked_at: string | null;
  }>(
    "select id, email, password_hash, role, locked_at from users where lower(email) = lower($1) and role in ('ADMIN','admin') limit 1",
    [emailLower],
  );

  const user = result.rows[0];
  if (!user) {
    await dbQuery(
      "insert into admin_login_attempts (email, ip, success) values ($1, $2, false)",
      [emailLower, ip],
    );
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (user.locked_at) {
    await dbQuery(
      "insert into admin_login_attempts (email, ip, success) values ($1, $2, false)",
      [emailLower, ip],
    );
    return NextResponse.json({ error: "You are locked out." }, { status: 429 });
  }

  if (recentFailures >= maxAttempts) {
    await dbQuery("update users set locked_at = now() where id = $1 and locked_at is null", [
      user.id,
    ]);
    await dbQuery(
      "insert into admin_login_attempts (email, ip, success) values ($1, $2, false)",
      [emailLower, ip],
    );
    return NextResponse.json({ error: "You are locked out." }, { status: 429 });
  }

  if (!user.password_hash.startsWith("$2")) {
    await dbQuery(
      "insert into admin_login_attempts (email, ip, success) values ($1, $2, false)",
      [emailLower, ip],
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
      [emailLower, ip],
    );
    if (recentFailures + 1 >= maxAttempts) {
      await dbQuery("update users set locked_at = now() where id = $1 and locked_at is null", [
        user.id,
      ]);
      return NextResponse.json({ error: "You are locked out." }, { status: 429 });
    }
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = createSessionToken(user.id, user.role);
  await setSessionCookie(token);
  await dbQuery(
    "insert into admin_login_attempts (email, ip, success) values ($1, $2, true)",
    [emailLower, ip],
  );

  return NextResponse.json({ ok: true });
}
