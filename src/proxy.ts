import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";

import {
  isAdminRoute,
  isClerkPublicAuthRoute,
  isAccountRoute,
  isClerkEnabled,
  isStagedAdminClerkProtectedRoute,
  LEGACY_ADMIN_SESSION_COOKIE,
  shouldEnforceClerkOnAdminRoutes,
} from "@/lib/security/clerk";

// This is intentionally public: it is a non-secret build-mode toggle that must
// be inlined into Netlify's proxy bundle.
const CSP_NONCE_ENABLED =
  (process.env.NEXT_PUBLIC_CSP_NONCE_ENABLED ?? "").trim().toLowerCase() === "true";
const CSP_REPORT_ONLY =
  (process.env.NEXT_PUBLIC_CSP_REPORT_ONLY ?? "").trim().toLowerCase() === "true";

function buildNonceCsp(nonce: string) {
  const bunnyOrigin = (() => {
    try {
      const value = process.env.BUNNY_PUBLIC_CDN_URL?.trim();
      return value ? new URL(value).origin : null;
    } catch {
      return null;
    }
  })();
  const clerkDomains = "https://*.clerk.com https://*.clerk.dev https://*.clerk.services https://*.clerk.accounts.dev https://clerk.curatedcarrentals.com";
  const uploadcareImages = "https://ucarecdn.com https://ucarecd.net https://*.ucarecd.net";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}' ${clerkDomains} https://challenges.cloudflare.com https://ucarecdn.com`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${clerkDomains} ${uploadcareImages} https://curatedcarrentals.com${bunnyOrigin ? ` ${bunnyOrigin}` : ""}`,
    `connect-src 'self' ${clerkDomains} https://clerk-telemetry.com https://challenges.cloudflare.com ${uploadcareImages} https://upload.uploadcare.com`,
    `frame-src 'self' ${clerkDomains} https://challenges.cloudflare.com https://jm.wipayfinancial.com`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "form-action 'self' https://jm.wipayfinancial.com",
    ...(CSP_REPORT_ONLY ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function withNonceCsp(response: NextResponse | Response, nonce: string) {
  response.headers.set(
    CSP_REPORT_ONLY ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
    buildNonceCsp(nonce),
  );
  return response;
}

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

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
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

  if (!CSP_NONCE_ENABLED) {
    if (!clerkProxy) return NextResponse.next();
    return (await clerkProxy(request, event)) ?? NextResponse.next();
  }

  const nonce = crypto.randomUUID().replaceAll("-", "");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads this request header while rendering and applies the nonce to its
  // own bootstrap scripts. The browser-facing policy remains report-only here.
  requestHeaders.set("Content-Security-Policy", buildNonceCsp(nonce));
  // Clone before rebuilding the request. Passing the original request directly
  // with an init object can leave POST route handlers with an empty body on
  // Netlify's proxy runtime.
  const requestWithNonce = new NextRequest(request.clone(), { headers: requestHeaders });
  const response = clerkProxy
    ? ((await clerkProxy(requestWithNonce, event)) ?? NextResponse.next({ request: { headers: requestHeaders } }))
    : NextResponse.next({ request: { headers: requestHeaders } });
  return withNonceCsp(response, nonce);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
