import { DEFAULT_WIPAY_ORIGIN } from "@/lib/wipay";

function isNonEmpty(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function missingKeys(keys: string[]) {
  return keys.filter((key) => !isNonEmpty(process.env[key]));
}

const WIPAY_ALLOWED_FEE_STRUCTURES = new Set(["customer_pay", "merchant_absorb", "split"]);
const WIPAY_ALLOWED_COUNTRY_CODES = new Set(["JM", "TT", "BB", "GY"]);
const INVOICE_PROVIDERS = new Set(["pdfmonkey", "gotenberg"]);
const DISALLOWED_PRODUCTION_DATABASE_HOSTS = new Set([
  "base",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
]);

function isValidUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function getDatabaseUrlValidationError(value: string | undefined) {
  if (!value || value.trim().length === 0) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return "DATABASE_URL must use postgres:// or postgresql://";
    }

    const hostname = url.hostname.trim().toLowerCase();
    if (process.env.NODE_ENV === "production") {
      if (!hostname) {
        return "DATABASE_URL must include a database host in production";
      }
      if (DISALLOWED_PRODUCTION_DATABASE_HOSTS.has(hostname)) {
        return `DATABASE_URL host "${hostname}" is not valid for production`;
      }
    }

    return null;
  } catch {
    return "DATABASE_URL must be a valid postgres connection string";
  }
}

export type EnvValidation = {
  core: { missing: string[]; invalid: string[] };
  publicRecovery: { missing: string[]; invalid: string[] };
  payments: { missing: string[]; invalid: string[] };
  email: { missing: string[]; invalid: string[] };
  invoices: { missing: string[]; invalid: string[] };
  uploads: { missing: string[]; invalid: string[] };
  cron: { missing: string[]; invalid: string[] };
  notes: string[];
};

export type InvoiceProvider = "pdfmonkey" | "gotenberg";
export type FileStorageProvider = "uploadcare" | "bunny";

export function getInvoiceProvider(): InvoiceProvider {
  const provider = (process.env.INVOICE_PDF_PROVIDER ?? "pdfmonkey").trim().toLowerCase();
  if (provider === "gotenberg") return "gotenberg";
  return "pdfmonkey";
}

export function getFileStorageProvider(): FileStorageProvider {
  return (process.env.FILE_STORAGE_PROVIDER ?? "uploadcare").trim().toLowerCase() === "bunny"
    ? "bunny"
    : "uploadcare";
}

export function isProductionRuntime() {
  if (process.env.CONTEXT === "production" || process.env.NETLIFY_CONTEXT === "production") return true;
  if (process.env.BRANCH === "main") return true;

  try {
    const canonicalHost = new URL(process.env.URL ?? "").hostname;
    const configuredHost = new URL(process.env.SITE_URL ?? "").hostname;
    return Boolean(canonicalHost && configuredHost && canonicalHost === configuredHost);
  } catch {
    return false;
  }
}

export function validateEnv(): EnvValidation {
  const notes: string[] = [];

  const coreMissing = missingKeys(["DATABASE_URL", "ADMIN_SESSION_SECRET", "SITE_URL"]);
  const coreInvalid: string[] = [];
  const databaseUrlError = getDatabaseUrlValidationError(process.env.DATABASE_URL);
  if (databaseUrlError) {
    coreInvalid.push(databaseUrlError);
  }
  if (isNonEmpty(process.env.SITE_URL) && !isValidUrl(process.env.SITE_URL)) {
    coreInvalid.push("SITE_URL must be a valid http(s) URL");
  }

  // CSRF_SECRET is required in production; in development we allow a fallback.
  const csrfMissing = !isNonEmpty(process.env.CSRF_SECRET) ? ["CSRF_SECRET"] : [];
  if (csrfMissing.length > 0 && process.env.NODE_ENV !== "production") {
    notes.push("CSRF_SECRET is not set; development fallback secret will be used.");
  }

  const configuredPaymentProvider = (process.env.PAYMENT_PROVIDER ?? "wipay").trim().toLowerCase();
  const isStripe = configuredPaymentProvider === "stripe";
  const paymentsMissing = isStripe
    ? missingKeys(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_TEST_MODE"])
    : missingKeys(["WIPAY_ACCOUNT_NUMBER", "WIPAY_API_KEY", "WIPAY_ENV", "WIPAY_FEE_STRUCTURE"]);
  const paymentsInvalid: string[] = [];
  if (!["wipay", "stripe"].includes(configuredPaymentProvider)) {
    paymentsInvalid.push("PAYMENT_PROVIDER must be wipay or stripe");
  }
  if (isStripe) {
    const isProductionDeployment = isProductionRuntime();
    const stripeTestMode = (process.env.STRIPE_TEST_MODE ?? "").trim().toLowerCase() === "true";
    if (isProductionDeployment) {
      if (stripeTestMode) paymentsInvalid.push("STRIPE_TEST_MODE must be false in production");
      if (isNonEmpty(process.env.STRIPE_SECRET_KEY) && !process.env.STRIPE_SECRET_KEY!.startsWith("sk_live_")) paymentsInvalid.push("STRIPE_SECRET_KEY must be a Stripe live key in production");
    } else {
      if (!stripeTestMode) paymentsInvalid.push("STRIPE_TEST_MODE must be true for the staging trial");
      if (isNonEmpty(process.env.STRIPE_SECRET_KEY) && !process.env.STRIPE_SECRET_KEY!.startsWith("sk_test_")) paymentsInvalid.push("STRIPE_SECRET_KEY must be a Stripe test key outside production");
    }
    if (isNonEmpty(process.env.STRIPE_WEBHOOK_SECRET) && !process.env.STRIPE_WEBHOOK_SECRET!.startsWith("whsec_")) paymentsInvalid.push("STRIPE_WEBHOOK_SECRET must be a webhook signing secret");
  }
  if (!isNonEmpty(process.env.WIPAY_ORIGIN)) {
    notes.push(`WIPAY_ORIGIN is not set; defaulting to ${DEFAULT_WIPAY_ORIGIN}.`);
  }
  const wipayEnv = (process.env.WIPAY_ENV ?? "").trim().toLowerCase();
  if (isNonEmpty(process.env.WIPAY_ENV) && !["sandbox", "live"].includes(wipayEnv)) {
    paymentsInvalid.push("WIPAY_ENV must be sandbox or live");
  }
  const fee = (process.env.WIPAY_FEE_STRUCTURE ?? "").trim().toLowerCase();
  if (isNonEmpty(process.env.WIPAY_FEE_STRUCTURE) && !WIPAY_ALLOWED_FEE_STRUCTURES.has(fee)) {
    paymentsInvalid.push("WIPAY_FEE_STRUCTURE must be customer_pay, merchant_absorb, or split");
  }
  const account = (process.env.WIPAY_ACCOUNT_NUMBER ?? "").trim();
  if (isNonEmpty(process.env.WIPAY_ACCOUNT_NUMBER) && !/^\d+$/.test(account)) {
    paymentsInvalid.push("WIPAY_ACCOUNT_NUMBER must be digits only");
  }
  const wipayCountryCode = (process.env.WIPAY_COUNTRY_CODE ?? "").trim().toUpperCase();
  if (
    isNonEmpty(process.env.WIPAY_COUNTRY_CODE) &&
    !WIPAY_ALLOWED_COUNTRY_CODES.has(wipayCountryCode)
  ) {
    paymentsInvalid.push("WIPAY_COUNTRY_CODE must be JM, TT, BB, or GY");
  }

  const emailMissing = missingKeys(["RESEND_API_KEY", "RESEND_FROM"]);
  const emailInvalid: string[] = [];

  const publicRecoveryMissing = missingKeys(["RETURNING_CUSTOMER_OTP_SECRET"]);
  const publicRecoveryInvalid: string[] = [];

  const invoicesMissing: string[] = [];
  const invoicesInvalid: string[] = [];
  const invoiceProviderRaw = (process.env.INVOICE_PDF_PROVIDER ?? "pdfmonkey")
    .trim()
    .toLowerCase();
  const invoiceProvider = getInvoiceProvider();
  if (!INVOICE_PROVIDERS.has(invoiceProviderRaw)) {
    invoicesInvalid.push("INVOICE_PDF_PROVIDER must be pdfmonkey or gotenberg");
  }
  if (invoiceProvider === "gotenberg") {
    const gotenbergUrl = (process.env.GOTENBERG_URL ?? "").trim();
    if (gotenbergUrl) {
      if (!isValidUrl(gotenbergUrl)) {
        invoicesInvalid.push("GOTENBERG_URL must be a valid http(s) URL");
      }
    } else if (process.env.NODE_ENV === "production") {
      invoicesMissing.push("GOTENBERG_URL");
    } else {
      notes.push("GOTENBERG_URL is not set; defaulting to http://localhost:3001 in development.");
    }
  } else {
    invoicesMissing.push(...missingKeys(["PDFMONKEY_API_KEY", "PDFMONKEY_TEMPLATE_ID"]));
  }

  const fileStorageProviderRaw = (process.env.FILE_STORAGE_PROVIDER ?? "uploadcare").trim().toLowerCase();
  const fileStorageProvider = getFileStorageProvider();
  const uploadsMissing =
    fileStorageProvider === "bunny"
      ? missingKeys([
          "BUNNY_STORAGE_PUBLIC_ZONE",
          "BUNNY_STORAGE_PUBLIC_ACCESS_KEY",
          "BUNNY_STORAGE_PRIVATE_ZONE",
          "BUNNY_STORAGE_PRIVATE_ACCESS_KEY",
          "BUNNY_PUBLIC_CDN_URL",
        ])
      : missingKeys(["NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY"]);
  const uploadsInvalid: string[] = [];
  if (!["uploadcare", "bunny"].includes(fileStorageProviderRaw)) {
    uploadsInvalid.push("FILE_STORAGE_PROVIDER must be uploadcare or bunny");
  }
  if (isNonEmpty(process.env.BUNNY_STORAGE_ENDPOINT) && !isValidUrl(process.env.BUNNY_STORAGE_ENDPOINT)) {
    uploadsInvalid.push("BUNNY_STORAGE_ENDPOINT must be a valid http(s) URL");
  }
  if (fileStorageProvider === "bunny" && !isValidUrl(process.env.BUNNY_PUBLIC_CDN_URL)) {
    uploadsInvalid.push("BUNNY_PUBLIC_CDN_URL must be a valid http(s) URL");
  }

  const cronMissing = missingKeys(["CRON_SECRET"]);
  const cronInvalid: string[] = [];

  return {
    core: { missing: [...coreMissing, ...csrfMissing], invalid: coreInvalid },
    publicRecovery: { missing: publicRecoveryMissing, invalid: publicRecoveryInvalid },
    payments: { missing: paymentsMissing, invalid: paymentsInvalid },
    email: { missing: emailMissing, invalid: emailInvalid },
    invoices: { missing: invoicesMissing, invalid: invoicesInvalid },
    uploads: { missing: uploadsMissing, invalid: uploadsInvalid },
    cron: { missing: cronMissing, invalid: cronInvalid },
    notes,
  };
}

export function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;
  const report = validateEnv();

  // For production boot, fail fast on core security/runtime settings only.
  const missing = report.core.missing;
  const invalid = report.core.invalid;

  if (missing.length > 0 || invalid.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`Missing env: ${missing.join(", ")}`);
    if (invalid.length > 0) parts.push(`Invalid env: ${invalid.join(", ")}`);
    throw new Error(parts.join(" | "));
  }
}
