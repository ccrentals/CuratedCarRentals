import { createHash } from "node:crypto";

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

export function computeHash(transactionId: string, originalTotal: string, apiKey: string) {
  return createHash("md5").update(`${transactionId}${originalTotal}${apiKey}`).digest("hex");
}
