import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "ccr_admin_session";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours
const SESSION_ROTATION_WINDOW_SECONDS = 60 * 60; // rotate if within 1 hour of expiry

export type AdminSession = {
  userId: string;
  role: string;
  expiresAt: number;
  issuedAt: number;
};

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not set");
  }
  return secret;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string) {
  const secret = getSessionSecret();
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(userId: string, role: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + COOKIE_MAX_AGE_SECONDS;
  const payload = JSON.stringify({ sub: userId, role, exp: expiresAt, iat: issuedAt });
  const encoded = base64UrlEncode(payload);
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/",
  });
}

export async function getSessionFromRequest(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const signatureOk = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!signatureOk) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as {
      sub: string;
      role: string;
      exp: number;
      iat?: number;
    };

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSeconds) return null;

    if (payload.exp - nowSeconds <= SESSION_ROTATION_WINDOW_SECONDS) {
      const refreshed = createSessionToken(payload.sub, payload.role);
      try {
        await setSessionCookie(refreshed);
      } catch {
        // Ignore rotation errors in read-only rendering contexts.
      }
    }

    return {
      userId: payload.sub,
      role: payload.role,
      expiresAt: payload.exp,
      issuedAt: payload.iat ?? payload.exp - COOKIE_MAX_AGE_SECONDS,
    };
  } catch {
    return null;
  }
}
