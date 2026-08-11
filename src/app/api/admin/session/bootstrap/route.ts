import { NextResponse } from "next/server";

import { canAccessAdmin } from "@/lib/auth/roles";
import { createSessionToken, getSessionFromRequest, setSessionCookie } from "@/lib/auth/session";

function resolveRedirectTarget(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const candidate = (searchParams.get("redirect") ?? "/admin").trim();
  if (!candidate.startsWith("/")) {
    return "/admin";
  }

  try {
    const target = new URL(candidate, origin);
    if (target.origin !== origin) {
      return "/admin";
    }
    const normalized = `${target.pathname}${target.search}${target.hash}`;
    if (
      normalized === "/admin/auth" ||
      normalized.startsWith("/admin/auth?") ||
      normalized === "/sign-in" ||
      normalized.startsWith("/sign-in?") ||
      normalized === "/api/admin/session/bootstrap" ||
      normalized.startsWith("/api/admin/session/bootstrap?")
    ) {
      return "/admin";
    }
    return normalized;
  } catch {
    return "/admin";
  }
}

function buildSignInHref(request: Request) {
  const redirectTarget = resolveRedirectTarget(request);
  const query = new URLSearchParams();
  query.set("redirect", redirectTarget);
  return `/sign-in?${query.toString()}`;
}

export async function GET(request: Request) {
  const redirectTarget = resolveRedirectTarget(request);
  const activeSession = await getSessionFromRequest();
  if (activeSession && canAccessAdmin(activeSession.role)) {
    return NextResponse.redirect(new URL(redirectTarget, request.url));
  }

  const bootstrapSession = await getSessionFromRequest({
    allowClerkBridge: true,
    clerkBridgeMode: "any-local-user",
  });

  if (!bootstrapSession || !canAccessAdmin(bootstrapSession.role)) {
    return NextResponse.redirect(new URL(buildSignInHref(request), request.url));
  }

  const response = NextResponse.redirect(new URL(redirectTarget, request.url));
  await setSessionCookie(createSessionToken(bootstrapSession.userId, bootstrapSession.role));
  return response;
}
