import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { getStripeClient } from "@/lib/payments/stripe";
import { reconcileStripeCheckoutSession } from "@/lib/payments/stripeReconcile";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing Stripe signature", { status: 400 });
  let event;
  try { event = getStripeClient().webhooks.constructEvent(await request.text(), signature, process.env.STRIPE_WEBHOOK_SECRET!.trim()); }
  catch { return new Response("Invalid Stripe signature", { status: 400 }); }
  const inserted = await getDbPool().query("insert into webhook_events (provider, event_id) values ('STRIPE', $1) on conflict (provider, event_id) do nothing returning id", [event.id]);
  if (!inserted.rowCount) return NextResponse.json({ received: true, duplicate: true });
  const sessionEvent = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"].includes(event.type);
  if (sessionEvent) await reconcileStripeCheckoutSession(event.data.object as import("stripe").Stripe.Checkout.Session, "webhook");
  return NextResponse.json({ received: true });
}
