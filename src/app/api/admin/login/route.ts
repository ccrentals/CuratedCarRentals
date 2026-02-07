import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { isEmail, isNonEmptyString } from "@/lib/validators";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = body?.email;
  const password = body?.password;

  if (!isEmail(email) || !isNonEmptyString(password, 4)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const result = await dbQuery<{
    id: string;
    email: string;
    password_hash: string;
    role: string;
  }>(
    "select id, email, password_hash, role from users where lower(email) = lower($1) and role in ('ADMIN','admin') limit 1",
    [email.trim()],
  );

  const user = result.rows[0];
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // TEMP: plain string compare (replace with bcrypt/argon in next batch)
  if (user.password_hash !== password) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = createSessionToken(user.id, user.role);
  await setSessionCookie(token);

  return NextResponse.json({ ok: true });
}
