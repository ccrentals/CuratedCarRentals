const IS_PRODUCTION = process.env.NODE_ENV === "production";

const CLERK_DOMAINS = [
  "https://*.clerk.com",
  "https://*.clerk.dev",
  "https://*.clerk.services",
  "https://*.clerk.accounts.dev",
  "https://clerk.curatedcarrentals.com",
];
const TURNSTILE_DOMAINS = ["https://challenges.cloudflare.com"];
const UPLOADCARE_SCRIPT_DOMAINS = ["https://ucarecdn.com"];
const UPLOADCARE_IMAGE_DOMAINS = [
  "https://ucarecdn.com",
  "https://ucarecd.net",
  "https://*.ucarecd.net",
];
const UPLOADCARE_CONNECT_DOMAINS = [...UPLOADCARE_IMAGE_DOMAINS, "https://upload.uploadcare.com"];
const WIPAY_DOMAINS = ["https://jm.wipayfinancial.com"];
const CUSTOMER_SITE_DOMAINS = ["https://curatedcarrentals.com"];

export function getConfiguredBunnyPublicCdn(value = process.env.BUNNY_PUBLIC_CDN_URL) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    return { origin: url.origin, hostname: url.hostname };
  } catch {
    throw new Error("BUNNY_PUBLIC_CDN_URL must be a valid HTTPS origin.");
  }
}

export function buildContentSecurityPolicy(options: {
  nonce: string;
  frameAncestors?: string;
  reportUri?: string;
}): string {
  const bunnyPublicCdn = getConfiguredBunnyPublicCdn();
  const scriptSrc = [
    "'self'",
    `'nonce-${options.nonce}'`,
    ...(!IS_PRODUCTION ? ["'unsafe-eval'"] : []),
    ...CLERK_DOMAINS,
    ...TURNSTILE_DOMAINS,
    ...UPLOADCARE_SCRIPT_DOMAINS,
  ];
  const connectSrc = [
    "'self'",
    ...CLERK_DOMAINS,
    ...TURNSTILE_DOMAINS,
    ...UPLOADCARE_CONNECT_DOMAINS,
    ...(!IS_PRODUCTION ? ["ws:", "wss:"] : []),
  ];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${options.frameAncestors ?? "'none'"}`,
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${[
      ...CLERK_DOMAINS,
      ...UPLOADCARE_IMAGE_DOMAINS,
      ...CUSTOMER_SITE_DOMAINS,
      ...(bunnyPublicCdn ? [bunnyPublicCdn.origin] : []),
    ].join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src 'self' ${[...CLERK_DOMAINS, ...TURNSTILE_DOMAINS, ...WIPAY_DOMAINS].join(" ")}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    `form-action 'self' ${WIPAY_DOMAINS.join(" ")}`,
    ...(IS_PRODUCTION ? ["upgrade-insecure-requests"] : []),
    ...(options.reportUri ? [`report-uri ${options.reportUri}`] : []),
  ].join("; ");
}
