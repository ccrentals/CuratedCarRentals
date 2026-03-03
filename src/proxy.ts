import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import {
  isAccountRoute,
  isClerkEnabled,
  isStagedAdminClerkProtectedRoute,
  LEGACY_ADMIN_SESSION_COOKIE,
  shouldEnforceClerkOnAdminRoutes,
} from "@/lib/security/clerk";

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
  const hostHeader = request.headers.get("host")?.toLowerCase() ?? "";
  const isZeroHost = hostHeader.startsWith("0.0.0.0");

  if (
    process.env.NODE_ENV !== "production" &&
    isZeroHost &&
    (request.nextUrl.pathname === "/admin/auth" ||
      request.nextUrl.pathname.startsWith("/sign-in") ||
      request.nextUrl.pathname.startsWith("/sign-up"))
  ) {
    const localUrl = request.nextUrl.clone();
    localUrl.hostname = "localhost";
    return NextResponse.redirect(localUrl);
  }

  if (!clerkProxy) {
    return NextResponse.next();
  }
  return clerkProxy(request, event);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
