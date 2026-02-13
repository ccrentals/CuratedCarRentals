import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/auth/session";
import { requireCsrf } from "@/lib/security/csrf";
import { THEME_COOKIE_NAME } from "@/lib/theme";

export async function POST(request: Request) {
  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }
  await clearSessionCookie();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(THEME_COOKIE_NAME, "", {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/",
  });
  return response;
}
