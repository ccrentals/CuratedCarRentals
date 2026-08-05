import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { logWarn } from "@/lib/log";
import { canAccessAdmin } from "@/lib/auth/roles";
import { getNativeAdminSessionFromAuthorization } from "@/lib/auth/session";

const COOKIE_NAME = "ccr_csrf";
const MAX_AGE_SECONDS = 60 * 60 * 2;
function getSecret() {
  const secret = process.env.CSRF_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") {
    const fallback = process.env.ADMIN_SESSION_SECRET ?? "dev-csrf-secret";
    logWarn("security.csrf.missingSecret", {});
    return fallback;
  }
  throw new Error("CSRF_SECRET is not set");
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string) {
  return createHash("sha256").update(`${value}.${getSecret()}`).digest("base64url");
}

export async function getOrCreateCsrfToken() {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing && verifyCsrfToken(existing)) return existing;

  const raw = `${randomBytes(16).toString("hex")}.${Date.now()}`;
  const token = `${base64UrlEncode(raw)}.${sign(raw)}`;
  store.set(COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
  return token;
}

export async function getCsrfTokenFromCookie() {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

export function verifyCsrfToken(token?: string | null) {
  if (!token) return false;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;
  const raw = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = sign(raw);
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function requireCsrf(request: Request, bodyToken?: string | null) {
  // Native admin mutations authenticate with a short-lived, audience-bound bearer
  // token. CSRF applies to ambient browser cookies, not explicit Authorization
  // credentials. Never bypass this check for browser-audience session tokens.
  const nativeSession = getNativeAdminSessionFromAuthorization(request.headers.get("authorization"));
  if (nativeSession && canAccessAdmin(nativeSession.role)) {
    return true;
  }

  const headerToken = request.headers.get("x-csrf-token") ?? bodyToken ?? null;
  const cookieToken = await getCsrfTokenFromCookie();
  if (!headerToken || !cookieToken) return false;
  if (headerToken !== cookieToken) return false;
  return verifyCsrfToken(headerToken);
}
