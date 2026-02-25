import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

import { clearSessionCookie } from "@/lib/auth/session";
import { isClerkEnabled } from "@/lib/security/clerk";
import { requireCsrf } from "@/lib/security/csrf";
import { THEME_COOKIE_NAME } from "@/lib/theme";

function resolveRedirectUrl(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const candidate = (searchParams.get("redirect_url") ?? searchParams.get("redirect") ?? "/").trim();
  if (!candidate.startsWith("/")) {
    return "/";
  }
  try {
    const target = new URL(candidate, origin);
    if (target.origin !== origin) {
      return "/";
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

function applyLogoutCookies(response: NextResponse) {
  response.cookies.set(THEME_COOKIE_NAME, "", {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/",
  });
  return response;
}

async function revokeCurrentClerkSession() {
  if (!isClerkEnabled()) {
    return;
  }

  try {
    const { sessionId } = await auth();
    if (!sessionId) {
      return;
    }
    const clerk = await clerkClient();
    await clerk.sessions.revokeSession(sessionId);
  } catch {
    // Logout should still proceed for local session cleanup even if Clerk revoke fails.
  }
}

export async function GET(request: Request) {
  // Allow GET so browser redirects can hard-signout both Clerk and local legacy sessions.
  await revokeCurrentClerkSession();
  await clearSessionCookie();
  const redirectUrl = resolveRedirectUrl(request);
  return applyLogoutCookies(NextResponse.redirect(new URL(redirectUrl, request.url)));
}

export async function POST(request: Request) {
  // Intentionally no admin-role guard:
  // logout must remain callable for partially-authenticated or expired sessions during cutover.
  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }
  await revokeCurrentClerkSession();
  await clearSessionCookie();
  return applyLogoutCookies(NextResponse.json({ ok: true }));
}
