import { createHash, randomUUID } from "node:crypto";

function privateAccessSecret() {
  return (
    process.env.BOOKING_PRIVATE_FILE_SECRET ||
    process.env.CSRF_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    "ccr-booking-private-access"
  );
}

export function createBookingAccessToken(seed?: string) {
  const normalizedSeed = typeof seed === "string" ? seed.trim() : "";
  if (normalizedSeed) {
    return createHash("sha256")
      .update(`booking-access:${normalizedSeed}:${privateAccessSecret()}`)
      .digest("hex");
  }
  return `${randomUUID()}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function hashBookingAccessToken(token: string) {
  return createHash("sha256")
    .update(`${token}:${privateAccessSecret()}`)
    .digest("hex");
}

export function bookingAccessCookieName(bookingId: string) {
  return `ccr_booking_access_${bookingId}`;
}

export function hashBookingSubmissionKey(value: string) {
  return createHash("sha256")
    .update(`booking-submit:${value.trim()}:${privateAccessSecret()}`)
    .digest("hex");
}

export function readBookingAccessTokenFromCookieHeader(cookieHeader: string, bookingId: string) {
  const pairs = cookieHeader.split(";").map((entry) => entry.trim());
  const cookieName = bookingAccessCookieName(bookingId);

  for (const pair of pairs) {
    if (!pair) continue;
    const [key, ...rest] = pair.split("=");
    if (key !== cookieName) continue;
    return decodeURIComponent(rest.join("="));
  }

  return "";
}

export function readBookingAccessHash(pricing: Record<string, unknown> | null | undefined) {
  const source = pricing ?? {};
  return typeof source.private_access_token_hash === "string"
    ? source.private_access_token_hash
    : "";
}

export function hasMatchingBookingAccessToken(accessToken: string, expectedHash: string) {
  if (!accessToken || !expectedHash) return false;
  return hashBookingAccessToken(accessToken) === expectedHash;
}
