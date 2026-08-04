import Stripe from "stripe";

import { assertStripeTestConfiguration } from "@/lib/payments/provider";

export function toStripeJmdMinorUnits(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
    throw new Error("Stripe JMD amount must be a positive integer in minor units.");
  }
  return amountCents;
}

export function getStripeClient() {
  assertStripeTestConfiguration();
  return new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
}

export function stripeCheckoutUrls() {
  const siteUrl = (process.env.SITE_URL ?? "").trim();
  if (!siteUrl) throw new Error("Missing SITE_URL");
  return {
    successUrl: new URL("/api/payments/stripe/return?session_id={CHECKOUT_SESSION_ID}", siteUrl).toString(),
    cancelUrl: new URL("/api/payments/stripe/return?cancelled=1&session_id={CHECKOUT_SESSION_ID}", siteUrl).toString(),
  };
}
