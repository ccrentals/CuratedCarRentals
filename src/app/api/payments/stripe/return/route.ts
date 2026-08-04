import { NextResponse } from "next/server";
import { getStripeClient } from "@/lib/payments/stripe";
import { reconcileStripeCheckoutSession } from "@/lib/payments/stripeReconcile";

export async function GET(request: Request) {
  const url = new URL(request.url); const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return NextResponse.redirect(new URL("/payment/failed?reason=notfound", url.origin));
  try {
    const session = await getStripeClient().checkout.sessions.retrieve(sessionId);
    const result = await reconcileStripeCheckoutSession(session, "return");
    const destination = result.ok ? `/payment/success?bookingId=${encodeURIComponent(result.bookingId ?? "")}` : `/payment/failed?reason=${encodeURIComponent(result.status)}${result.bookingId ? `&bookingId=${encodeURIComponent(result.bookingId)}` : ""}`;
    return NextResponse.redirect(new URL(destination, url.origin));
  } catch { return NextResponse.redirect(new URL("/payment/failed?reason=verification", url.origin)); }
}
