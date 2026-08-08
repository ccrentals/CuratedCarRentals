export type PaymentProvider = "WIPAY" | "STRIPE";
export type StripePaymentMode = "test" | "live";

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

export function isStripeLiveMode() {
  return (process.env.STRIPE_TEST_MODE ?? "").trim().toLowerCase() !== "true" && (process.env.STRIPE_SECRET_KEY ?? "").trim().startsWith("sk_live_");
}

function isProductionDeployment(requestUrl?: string) {
  if (process.env.CONTEXT === "production" || process.env.NETLIFY_CONTEXT === "production") {
    return true;
  }
  if (process.env.BRANCH === "main") return true;

  try {
    const requestHost = new URL(requestUrl ?? "").hostname;
    const siteHost = new URL(process.env.SITE_URL ?? "").hostname;
    return Boolean(requestHost && siteHost && requestHost === siteHost);
  } catch {
    return false;
  }
}

export function getStripePaymentMode(requestUrl?: string): StripePaymentMode {
  if (isProductionDeployment(requestUrl)) {
    if (!isStripeLiveMode()) {
      throw new Error("Stripe production requires STRIPE_TEST_MODE=false and an sk_live_ STRIPE_SECRET_KEY.");
    }
    return "live";
  }

  const isStaging = process.env.NODE_ENV === "test" || isStripeStagingDeployment(requestUrl);
  if (!isStaging) throw new Error("Stripe is enabled only for the staging or production deployment.");
  if (!isStripeTestMode()) throw new Error("Stripe staging requires STRIPE_TEST_MODE=true and an sk_test_ STRIPE_SECRET_KEY.");
  return "test";
}

export function getPublicPaymentProvider(requestUrl?: string): PaymentProvider {
  const provider = configuredProvider();
  if (provider !== "stripe") {
    assertWiPayAvailable(requestUrl);
    return "WIPAY";
  }

  getStripePaymentMode(requestUrl);
  return "STRIPE";
}

export function assertStripeConfiguration(requestUrl?: string) {
  if (getPublicPaymentProvider(requestUrl) !== "STRIPE") {
    throw new Error("Stripe is not enabled for this deployment.");
  }
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!webhookSecret.startsWith("whsec_")) {
    throw new Error("Missing Stripe webhook signing secret.");
  }
}
