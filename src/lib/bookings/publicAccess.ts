import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import {
  bookingAccessCookieName,
  hasMatchingBookingEmailAccessSignature,
  hasMatchingBookingAccessToken,
  readBookingAccessHash,
  readBookingAccessTokenFromCookieHeader,
} from "@/lib/bookings/privateAccess";

export async function hasPublicBookingAccessForRequest(
  request: Request,
  bookingId: string,
  pricing: Record<string, unknown> | null | undefined,
) {
  const session = await getSessionFromRequest();
  if (session) return true;

  const expectedHash = readBookingAccessHash(pricing);
  const accessToken = readBookingAccessTokenFromCookieHeader(
    request.headers.get("cookie") ?? "",
    bookingId,
  );

  return hasMatchingBookingAccessToken(accessToken, expectedHash);
}

export async function hasPublicBookingAccessForPage(
  bookingId: string,
  pricing: Record<string, unknown> | null | undefined,
  signature?: string | null,
) {
  const session = await getSessionFromRequest();
  if (session) return true;

  const expectedHash = readBookingAccessHash(pricing);
  if (!expectedHash) return false;

  if (
    signature &&
    hasMatchingBookingEmailAccessSignature(signature, bookingId, expectedHash)
  ) {
    return true;
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get(bookingAccessCookieName(bookingId))?.value ?? "";

  return hasMatchingBookingAccessToken(accessToken, expectedHash);
}

export function bookingAccessForbiddenResponse() {
  return NextResponse.json(
    { ok: false, error: "Forbidden" },
    {
      status: 403,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
