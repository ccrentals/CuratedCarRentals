export type PaymentProvider = "WIPAY" | "STRIPE";

function configuredProvider() {
  return (process.env.PAYMENT_PROVIDER ?? "wipay").trim().toLowerCase();
}

function hasStagingHostname(value: string | undefined) {
  try {
    return new URL(value ?? "").hostname === "staging--ccrentals.netlify.app";
  } catch {
    return false;
  }
}

export function isStripeStagingDeployment(requestUrl?: string) {
  if (process.env.BRANCH === "staging") return true;
  if (hasStagingHostname(requestUrl)) return true;

  const deployContext = process.env.CONTEXT ?? process.env.NETLIFY_CONTEXT;
  return deployContext === "branch-deploy" && hasStagingHostname(process.env.SITE_URL);
}

export function assertWiPayAvailable(requestUrl?: string) {
  if (isStripeStagingDeployment(requestUrl)) {
    throw new Error("WiPay is disabled for the staging deployment.");
  }
}

export function isStripeTestMode() {
  return (process.env.STRIPE_TEST_MODE ?? "").trim().toLowerCase() === "true" && (process.env.STRIPE_SECRET_KEY ?? "").trim().startsWith("sk_test_");
}

export function getPublicPaymentProvider(requestUrl?: string): PaymentProvider {
  const provider = configuredProvider();
  if (provider !== "stripe") {
    assertWiPayAvailable(requestUrl);
    return "WIPAY";
  }

  // Stripe must never be selectable from a production deployment or with a live key.
  const isProduction = process.env.CONTEXT === "production" || process.env.NETLIFY_CONTEXT === "production";
  const isStaging = process.env.NODE_ENV === "test" || isStripeStagingDeployment(requestUrl);
  if (isProduction || !isStaging) throw new Error("Stripe is enabled only for the staging deployment.");
  if (!isStripeTestMode()) throw new Error("Stripe staging requires STRIPE_TEST_MODE=true and an sk_test_ STRIPE_SECRET_KEY.");
  return "STRIPE";
}

export function assertStripeTestConfiguration(requestUrl?: string) {
  if (getPublicPaymentProvider(requestUrl) !== "STRIPE") {
    throw new Error("Stripe is not enabled for this deployment.");
  }
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!webhookSecret.startsWith("whsec_")) {
    throw new Error("Missing Stripe test webhook signing secret.");
  }
}
