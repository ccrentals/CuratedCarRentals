import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import {
  bookingAccessCookieName,
  hasMatchingBookingEmailAccessSignature,
  readBookingAccessHash,
} from "@/lib/bookings/privateAccess";

type BookingAccessRow = {
  id: string;
  pricing_json: Record<string, unknown> | null;
};

const TARGET_PATH_BUILDERS = {
  view: (id: string) => `/bookings/${id}`,
  pay: (id: string) => `/bookings/${id}/pay`,
  balance: (id: string) => `/bookings/${id}/balance`,
  invoice: (id: string) => `/bookings/${id}/invoice`,
} as const;

type AccessTarget = keyof typeof TARGET_PATH_BUILDERS;

function normalizeTarget(value: string | null): AccessTarget {
  if (value === "pay" || value === "balance" || value === "invoice") return value;
  return "view";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bookingId = typeof id === "string" ? id.trim() : "";
  if (!bookingId) {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const target = normalizeTarget(url.searchParams.get("target"));
  const signature = (url.searchParams.get("sig") ?? "").trim();

  const result = await dbQuery<BookingAccessRow>(
    "select id, pricing_json from bookings where id = $1 limit 1",
    [bookingId],
  );
  const booking = result.rows[0] ?? null;
  if (!booking) {
    return new NextResponse("Not found", { status: 404 });
  }

  const accessHash = readBookingAccessHash(booking.pricing_json);
  if (!accessHash || !hasMatchingBookingEmailAccessSignature(signature, booking.id, accessHash)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const redirectUrl = new URL(TARGET_PATH_BUILDERS[target](booking.id), request.url);
  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set({
    name: bookingAccessCookieName(booking.id),
    value: `hash:${accessHash}`,
    httpOnly: true,
    secure: redirectUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
