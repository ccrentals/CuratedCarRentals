import { NextResponse } from "next/server";
import { logError } from "@/lib/log";
import { getStripeClient, stripeCheckoutSiteUrl } from "@/lib/payments/stripe";
import { reconcileStripeCheckoutSession } from "@/lib/payments/stripeReconcile";

export async function GET(request: Request) {
  const url = new URL(request.url); const sessionId = url.searchParams.get("session_id");
  const siteUrl = stripeCheckoutSiteUrl();
  if (!sessionId) return NextResponse.redirect(new URL("/payment/failed?reason=notfound", siteUrl));
  let bookingId = "";
  try {
    const session = await getStripeClient().checkout.sessions.retrieve(sessionId);
    bookingId = session.metadata?.booking_id ?? "";
    const result = await reconcileStripeCheckoutSession(session, "return");
    const destination = result.ok ? `/payment/success?bookingId=${encodeURIComponent(result.bookingId ?? "")}` : `/payment/failed?reason=${encodeURIComponent(result.status)}${result.bookingId ? `&bookingId=${encodeURIComponent(result.bookingId)}` : ""}`;
    return NextResponse.redirect(new URL(destination, siteUrl));
  } catch (error) {
    logError("stripe_checkout_return_failed", error, { sessionId, bookingId });
    const retry = bookingId ? `&bookingId=${encodeURIComponent(bookingId)}` : "";
    return NextResponse.redirect(new URL(`/payment/failed?reason=verification${retry}`, siteUrl));
  }
}
