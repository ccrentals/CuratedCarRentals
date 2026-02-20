import { createHash, randomUUID } from "node:crypto";

function privateAccessSecret() {
  return (
    process.env.BOOKING_PRIVATE_FILE_SECRET ||
    process.env.CSRF_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    "ccr-booking-private-access"
  );
}

export function createBookingAccessToken() {
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
