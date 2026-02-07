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
  const environment = process.env.WIPAY_ENV ?? "sandbox";
  const feeStructure = process.env.WIPAY_FEE_STRUCTURE ?? "merchant_absorb";
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

  let payload: any = null;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = null;
  }

  const redirectUrl =
    payload?.url ??
    payload?.data?.url ??
    payload?.data?.payment_url ??
    payload?.payment_url;

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
