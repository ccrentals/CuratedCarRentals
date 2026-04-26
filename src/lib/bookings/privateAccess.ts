import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createBookingAccessToken(seed?: string) {
  const normalizedSeed = typeof seed === "string" ? seed.trim() : "";
  if (normalizedSeed) {
    return sha256(`booking-access:${normalizedSeed}`);
  }
  return `${randomUUID()}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function hashBookingAccessToken(token: string) {
  return sha256(`booking-token:${token}`);
}

export function bookingAccessCookieName(bookingId: string) {
  return `ccr_booking_access_${bookingId}`;
}

export function hashBookingSubmissionKey(value: string) {
  return sha256(`booking-submit:${value.trim()}`);
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

function bookingEmailAccessSecret() {
  return (
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    process.env.CSRF_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    ""
  );
}

function bookingEmailAccessPayload(bookingId: string, accessHash: string) {
  return `booking-email-access:${bookingId.trim()}:${accessHash.trim()}`;
}

export function createBookingEmailAccessSignature(bookingId: string, accessHash: string) {
  const secret = bookingEmailAccessSecret();
  if (!secret || !bookingId.trim() || !accessHash.trim()) return "";

  return createHmac("sha256", secret)
    .update(bookingEmailAccessPayload(bookingId, accessHash))
    .digest("hex");
}

export function hasMatchingBookingEmailAccessSignature(
  signature: string,
  bookingId: string,
  accessHash: string,
) {
  const expected = createBookingEmailAccessSignature(bookingId, accessHash);
  const provided = signature.trim();
  if (!expected || !provided) return false;

  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function hasMatchingBookingAccessToken(accessToken: string, expectedHash: string) {
  if (!accessToken || !expectedHash) return false;
  if (accessToken === `hash:${expectedHash}`) return true;
  return hashBookingAccessToken(accessToken) === expectedHash;
}
