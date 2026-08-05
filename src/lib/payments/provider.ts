export type PaymentProvider = "WIPAY" | "STRIPE";

function configuredProvider() {
  return (process.env.PAYMENT_PROVIDER ?? "wipay").trim().toLowerCase();
}

export function isStripeStagingDeployment() {
  if (process.env.BRANCH === "staging") return true;

  const deployContext = process.env.CONTEXT ?? process.env.NETLIFY_CONTEXT;
  if (deployContext !== "branch-deploy") return false;

  try {
    return new URL(process.env.SITE_URL ?? "").hostname === "staging--ccrentals.netlify.app";
  } catch {
    return false;
  }
}

export function assertWiPayAvailable() {
  if (isStripeStagingDeployment()) {
    throw new Error("WiPay is disabled for the staging deployment.");
  }
}

export function isStripeTestMode() {
  return (process.env.STRIPE_TEST_MODE ?? "").trim().toLowerCase() === "true" && (process.env.STRIPE_SECRET_KEY ?? "").trim().startsWith("sk_test_");
}

export function getPublicPaymentProvider(): PaymentProvider {
  const provider = configuredProvider();
  if (provider !== "stripe") {
    assertWiPayAvailable();
    return "WIPAY";
  }

  // Stripe must never be selectable from a production deployment or with a live key.
  const isProduction = process.env.CONTEXT === "production" || process.env.NETLIFY_CONTEXT === "production";
  const isStaging = process.env.NODE_ENV === "test" || isStripeStagingDeployment();
  if (isProduction || !isStaging) throw new Error("Stripe is enabled only for the staging deployment.");
  if (!isStripeTestMode()) throw new Error("Stripe staging requires STRIPE_TEST_MODE=true and an sk_test_ STRIPE_SECRET_KEY.");
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
