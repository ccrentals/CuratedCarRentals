import { createHash } from "node:crypto";

const WIPAY_ENDPOINT = "https://jm.wipayfinancial.com/plugins/payments/request";

export type WiPayRequestParams = {
  orderId: string;
  amountDecimal: string;
  responseUrl: string;
  name?: string;
  email?: string;
  phone?: string;
};

export function getCanonicalSiteUrl() {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) {
    throw new Error("SITE_URL is not set");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("SITE_URL is invalid");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("SITE_URL must use http or https");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

export function buildCanonicalSiteUrl(pathname: string) {
  return new URL(pathname, getCanonicalSiteUrl()).toString();
}

export function buildRequestParams({
  orderId,
  amountDecimal,
  responseUrl,
  name,
  email,
  phone,
}: WiPayRequestParams) {
  const accountNumberRaw = process.env.WIPAY_ACCOUNT_NUMBER;
  const apiKey = process.env.WIPAY_API_KEY;
  const environment = (process.env.WIPAY_ENV ?? "sandbox").trim().toLowerCase();
  const feeStructure = (process.env.WIPAY_FEE_STRUCTURE ?? "merchant_absorb").trim().toLowerCase();
  const rawOrigin = process.env.WIPAY_ORIGIN ?? "curated-car-rentals";
  const origin = rawOrigin
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  if (!accountNumberRaw || !apiKey) {
    throw new Error("WIPAY_ACCOUNT_NUMBER or WIPAY_API_KEY not set");
  }

  const accountNumber = accountNumberRaw.trim();
  if (!/^\d+$/.test(accountNumber)) {
    throw new Error("Invalid WIPAY_ACCOUNT_NUMBER: must be digits only");
  }

  return {
    account_number: accountNumber,
    country_code: "JM",
    currency: "JMD",
    environment,
    fee_structure: feeStructure,
    method: "credit_card",
    order_id: orderId,
    origin,
    response_url: responseUrl,
    total: amountDecimal,
    name,
    email,
    phone,
  };
}

export async function requestHostedPageUrl(params: Record<string, string | undefined>) {
  const body = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      body.append(key, value);
    }
  });

  const response = await fetch(WIPAY_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const responseText = await response.text();

  if (!response.ok) {
    const snippet = responseText.slice(0, 300);
    throw new Error(`HTTP ${response.status}: ${snippet || "WiPay request failed"}`);
  }

  let payload: unknown = null;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = null;
  }

  const payloadObject =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const payloadData =
    payloadObject?.data && typeof payloadObject.data === "object" && !Array.isArray(payloadObject.data)
      ? (payloadObject.data as Record<string, unknown>)
      : null;

  const redirectUrl =
    (typeof payloadObject?.url === "string" ? payloadObject.url : undefined) ??
    (typeof payloadData?.url === "string" ? payloadData.url : undefined) ??
    (typeof payloadData?.payment_url === "string" ? payloadData.payment_url : undefined) ??
    (typeof payloadObject?.payment_url === "string" ? payloadObject.payment_url : undefined);

  if (redirectUrl) {
    return { url: redirectUrl, raw: payload ?? responseText };
  }

  const urlMatch = responseText.match(/https?:\/\/[^\s"']+/i);
  if (urlMatch?.[0]) {
    return { url: urlMatch[0], raw: payload ?? responseText };
  }

  throw new Error("WiPay response missing hosted url");
}

export function computeHash(transactionId: string, originalTotal: string, apiKey: string) {
  return createHash("md5").update(`${transactionId}${originalTotal}${apiKey}`).digest("hex");
}
