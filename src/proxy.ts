import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import {
  isAdminRoute,
  isClerkPublicAuthRoute,
  isAccountRoute,
  isClerkEnabled,
  isStagedAdminClerkProtectedRoute,
  LEGACY_ADMIN_SESSION_COOKIE,
  shouldEnforceClerkOnAdminRoutes,
} from "@/lib/security/clerk";
import { buildContentSecurityPolicy } from "@/lib/security/csp";

const CSP_REPORT_ONLY = (process.env.CSP_REPORT_ONLY ?? "").trim().toLowerCase() === "true";
const CSP_REPORT_URI = process.env.CSP_REPORT_URI?.trim() ?? "";
const CSP_HEADER_NAME =
  process.env.NODE_ENV === "production" && !CSP_REPORT_ONLY
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";

function readCanonicalSiteUrl() {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

const clerkProxy = isClerkEnabled()
  ? clerkMiddleware(async (auth, request) => {
      const pathname = request.nextUrl.pathname;

      if (isAccountRoute(pathname)) {
        return NextResponse.redirect(new URL("/admin", request.url));
      }

      // Keep legacy admin auth as the default gate while Clerk migration is in progress.
      if (shouldEnforceClerkOnAdminRoutes() && isStagedAdminClerkProtectedRoute(pathname)) {
        const hasLegacySession = Boolean(request.cookies.get(LEGACY_ADMIN_SESSION_COOKIE)?.value);
        if (!hasLegacySession) {
          await auth.protect();
        }
      }
    })
  : null;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const canonicalSiteUrl = readCanonicalSiteUrl();
  const hostHeader = request.headers.get("host")?.toLowerCase() ?? "";
  const isZeroHost = hostHeader.startsWith("0.0.0.0");
  const pathname = request.nextUrl.pathname;

  if (
    process.env.NODE_ENV === "production" &&
    request.method === "GET" &&
    canonicalSiteUrl &&
    request.nextUrl.host !== canonicalSiteUrl.host &&
    (
      isAdminRoute(pathname) ||
      isClerkPublicAuthRoute(pathname) ||
      pathname === "/api/admin/logout" ||
      pathname === "/api/admin/session/bootstrap" ||
      isAccountRoute(pathname)
    )
  ) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.protocol = canonicalSiteUrl.protocol;
    canonicalUrl.host = canonicalSiteUrl.host;
    return NextResponse.redirect(canonicalUrl);
  }

  if (
    process.env.NODE_ENV !== "production" &&
    isZeroHost &&
    (pathname === "/admin/auth" || pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up"))
  ) {
    const localUrl = request.nextUrl.clone();
    localUrl.hostname = "localhost";
    return NextResponse.redirect(localUrl);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    reportUri: CSP_REPORT_URI || undefined,
  });
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", contentSecurityPolicy);

  if (!clerkProxy) {
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.headers.set(CSP_HEADER_NAME, contentSecurityPolicy);
    return response;
  }

  return clerkProxy(request, event).then((response) => {
    response.headers.set(CSP_HEADER_NAME, contentSecurityPolicy);
    return response;
  });
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
