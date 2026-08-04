export type PaymentProvider = "WIPAY" | "STRIPE";

function configuredProvider() {
  return (process.env.PAYMENT_PROVIDER ?? "wipay").trim().toLowerCase();
}

export function isStripeTestMode() {
  return process.env.STRIPE_TEST_MODE === "true" && (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

export function getPublicPaymentProvider(): PaymentProvider {
  const provider = configuredProvider();
  if (provider !== "stripe") return "WIPAY";

  // Stripe must never be selectable from a production deployment or with a live key.
  const isProduction = process.env.CONTEXT === "production" || process.env.NETLIFY_CONTEXT === "production";
  const isStaging = process.env.NODE_ENV === "test" || process.env.BRANCH === "staging" || process.env.CONTEXT === "branch-deploy";
  if (isProduction || !isStaging || !isStripeTestMode()) {
    throw new Error("Stripe is restricted to the staging deployment with an sk_test_ key.");
  }
  return "STRIPE";
}

export function assertStripeTestConfiguration() {
  if (getPublicPaymentProvider() !== "STRIPE") {
    throw new Error("Stripe is not enabled for this deployment.");
  }
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!webhookSecret.startsWith("whsec_")) {
    throw new Error("Missing Stripe test webhook signing secret.");
  }
}
