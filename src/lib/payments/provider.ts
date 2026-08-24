export type StripePaymentMode = "test" | "live";

export function getPublicPaymentRequestUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  if (!host) return url.toString();

  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  url.host = host;
  url.port = "";
  if (forwardedProtocol === "http" || forwardedProtocol === "https") {
    url.protocol = `${forwardedProtocol}:`;
  }
  return url.toString();
}

function configuredProvider() {
  return (process.env.PAYMENT_PROVIDER ?? "stripe").trim().toLowerCase();
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
  const deployContext = process.env.CONTEXT ?? process.env.NETLIFY_CONTEXT;
  const isExplicitProduction = deployContext === "production" || process.env.BRANCH === "main";

  if (isExplicitProduction) {
    if (!isStripeLiveMode()) {
      throw new Error("Stripe production requires STRIPE_TEST_MODE=false and an sk_live_ STRIPE_SECRET_KEY.");
    }
    return "live";
  }

  const isStaging = process.env.NODE_ENV === "test" || isStripeStagingDeployment(requestUrl);
  if (isStaging) {
    if (!isStripeTestMode()) throw new Error("Stripe staging requires STRIPE_TEST_MODE=true and an sk_test_ STRIPE_SECRET_KEY.");
    return "test";
  }

  if (isProductionDeployment(requestUrl)) {
    if (!isStripeLiveMode()) {
      throw new Error("Stripe production requires STRIPE_TEST_MODE=false and an sk_live_ STRIPE_SECRET_KEY.");
    }
    return "live";
  }

  throw new Error("Stripe is enabled only for the staging or production deployment.");
}

export function getPublicPaymentProvider(requestUrl?: string): "STRIPE" {
  const provider = configuredProvider();
  if (provider !== "stripe") {
    throw new Error("Stripe is the only supported public payment provider.");
  }

  getStripePaymentMode(requestUrl);
  return "STRIPE";
}

export function assertStripeConfiguration(requestUrl?: string) {
  getPublicPaymentProvider(requestUrl);
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!webhookSecret.startsWith("whsec_")) {
    throw new Error("Missing Stripe webhook signing secret.");
  }
}
