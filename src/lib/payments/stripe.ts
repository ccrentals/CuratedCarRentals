import Stripe from "stripe";

import { assertStripeTestConfiguration } from "@/lib/payments/provider";

export function toStripeJmdMinorUnits(amountJmd: number) {
  if (!Number.isSafeInteger(amountJmd) || amountJmd < 1) {
    throw new Error("Stripe JMD amount must be a positive whole-JMD value.");
  }

  const stripeMinorUnits = amountJmd * 100;
  if (!Number.isSafeInteger(stripeMinorUnits)) {
    throw new Error("Stripe JMD amount is too large.");
  }

  return stripeMinorUnits;
}

export function getStripeClient(requestUrl?: string) {
  assertStripeTestConfiguration(requestUrl);
  return new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
}

export function stripeCheckoutSiteUrl() {
  const siteUrl = (process.env.SITE_URL ?? "").trim();
  if (!siteUrl) throw new Error("Missing SITE_URL");
  return siteUrl;
}

export function stripeCheckoutUrls() {
  const siteUrl = stripeCheckoutSiteUrl();
  return {
    successUrl: new URL("/api/payments/stripe/return?session_id={CHECKOUT_SESSION_ID}", siteUrl).toString(),
    cancelUrl: new URL("/api/payments/stripe/return?cancelled=1&session_id={CHECKOUT_SESSION_ID}", siteUrl).toString(),
  };
}
