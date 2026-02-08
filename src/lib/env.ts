function isNonEmpty(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function missingKeys(keys: string[]) {
  return keys.filter((key) => !isNonEmpty(process.env[key]));
}

function isValidUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export type EnvValidation = {
  core: { missing: string[]; invalid: string[] };
  payments: { missing: string[]; invalid: string[] };
  email: { missing: string[]; invalid: string[] };
  invoices: { missing: string[]; invalid: string[] };
  uploads: { missing: string[]; invalid: string[] };
  cron: { missing: string[]; invalid: string[] };
  notes: string[];
};

export function validateEnv(): EnvValidation {
  const notes: string[] = [];

  const coreMissing = missingKeys(["DATABASE_URL", "ADMIN_SESSION_SECRET", "SITE_URL"]);
  const coreInvalid: string[] = [];
  if (isNonEmpty(process.env.SITE_URL) && !isValidUrl(process.env.SITE_URL)) {
    coreInvalid.push("SITE_URL must be a valid http(s) URL");
  }

  // CSRF_SECRET is required in production; in development we allow a fallback.
  const csrfMissing = !isNonEmpty(process.env.CSRF_SECRET) ? ["CSRF_SECRET"] : [];
  if (csrfMissing.length > 0 && process.env.NODE_ENV !== "production") {
    notes.push("CSRF_SECRET is not set; development fallback secret will be used.");
  }

  const paymentsMissing = missingKeys([
    "WIPAY_ACCOUNT_NUMBER",
    "WIPAY_API_KEY",
    "WIPAY_ENV",
    "WIPAY_FEE_STRUCTURE",
    "WIPAY_ORIGIN",
  ]);
  const paymentsInvalid: string[] = [];
  const wipayEnv = (process.env.WIPAY_ENV ?? "").trim().toLowerCase();
  if (isNonEmpty(process.env.WIPAY_ENV) && !["sandbox", "live"].includes(wipayEnv)) {
    paymentsInvalid.push("WIPAY_ENV must be sandbox or live");
  }
  const fee = (process.env.WIPAY_FEE_STRUCTURE ?? "").trim();
  if (isNonEmpty(process.env.WIPAY_FEE_STRUCTURE) && fee !== "merchant_absorb") {
    paymentsInvalid.push("WIPAY_FEE_STRUCTURE must be merchant_absorb");
  }
  const account = (process.env.WIPAY_ACCOUNT_NUMBER ?? "").trim();
  if (isNonEmpty(process.env.WIPAY_ACCOUNT_NUMBER) && !/^\d+$/.test(account)) {
    paymentsInvalid.push("WIPAY_ACCOUNT_NUMBER must be digits only");
  }

  const emailMissing = missingKeys(["RESEND_API_KEY", "RESEND_FROM"]);
  const emailInvalid: string[] = [];

  const invoicesMissing = missingKeys(["PDFMONKEY_API_KEY", "PDFMONKEY_TEMPLATE_ID"]);
  const invoicesInvalid: string[] = [];

  const uploadsMissing = missingKeys(["NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY"]);
  const uploadsInvalid: string[] = [];

  const cronMissing = missingKeys(["CRON_SECRET"]);
  const cronInvalid: string[] = [];

  return {
    core: { missing: [...coreMissing, ...csrfMissing], invalid: coreInvalid },
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

