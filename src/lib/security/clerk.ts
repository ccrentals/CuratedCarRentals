const LEGACY_ADMIN_PUBLIC_PATHS = ["/admin/login", "/admin/set-password", "/admin/auth"] as const;
const LEGACY_ADMIN_PUBLIC_API_PATHS = ["/api/admin/login", "/api/admin/logout"] as const;
const CLERK_PUBLIC_AUTH_PATHS = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/task/reset-password",
] as const;

export const LEGACY_ADMIN_SESSION_COOKIE = "ccr_admin_session";

function readEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function isClerkPublishableKeyConfigured() {
  return readEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY").length > 0;
}

export function isClerkSecretKeyConfigured() {
  return readEnv("CLERK_SECRET_KEY").length > 0;
}

export function isClerkEnabled() {
  return isClerkPublishableKeyConfigured() && isClerkSecretKeyConfigured();
}

export function shouldEnforceClerkOnAdminRoutes() {
  return readEnv("CLERK_PROTECT_ADMIN_ROUTES") === "1";
}

export function isAccountRoute(pathname: string) {
  return pathname === "/account" || pathname.startsWith("/account/");
}

export function isAdminRoute(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function isAdminApiRoute(pathname: string) {
  return pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

export function isAdminPublicRoute(pathname: string) {
  return LEGACY_ADMIN_PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function isAdminPublicApiRoute(pathname: string) {
  return LEGACY_ADMIN_PUBLIC_API_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function isClerkPublicAuthRoute(pathname: string) {
  return CLERK_PUBLIC_AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function isStandaloneAuthRoute(pathname: string) {
  return isClerkPublicAuthRoute(pathname);
}

export function isStagedAdminClerkProtectedRoute(pathname: string) {
  return (
    (isAdminRoute(pathname) && !isAdminPublicRoute(pathname)) ||
    (isAdminApiRoute(pathname) && !isAdminPublicApiRoute(pathname))
  );
}
