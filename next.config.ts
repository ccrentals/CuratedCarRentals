import type { NextConfig } from "next";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const CSP_REPORT_ONLY = (process.env.CSP_REPORT_ONLY ?? "").trim().toLowerCase() === "true";
const CSP_REPORT_URI = process.env.CSP_REPORT_URI?.trim() ?? "";

const CLERK_DOMAINS = [
  // Clerk frontend API + auth widgets.
  "https://*.clerk.com",
  "https://*.clerk.dev",
  "https://*.clerk.services",
  "https://*.clerk.accounts.dev",
];

const TURNSTILE_DOMAINS = [
  // Cloudflare Turnstile widget + siteverify-related browser calls.
  "https://challenges.cloudflare.com",
];

const UPLOADCARE_DOMAINS = [
  // Uploadcare widget script and CDN files used by admin/public uploads.
  "https://ucarecdn.com",
  "https://upload.uploadcare.com",
];

const WIPAY_DOMAINS = [
  // WiPay hosted payment pages (redirect/form targets).
  "https://jm.wipayfinancial.com",
];

function buildCsp() {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'", // Required for existing inline theme bootstrap script.
    ...(!IS_PRODUCTION ? ["'unsafe-eval'"] : []),
    ...CLERK_DOMAINS,
    ...TURNSTILE_DOMAINS,
    ...UPLOADCARE_DOMAINS,
  ];

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `script-src ${scriptSrc.join(" ")}`,
    `style-src 'self' 'unsafe-inline'`,
    `font-src 'self' data:`,
    `img-src 'self' data: blob: ${UPLOADCARE_DOMAINS.join(" ")}`,
    `connect-src 'self' ${[...CLERK_DOMAINS, ...TURNSTILE_DOMAINS, ...UPLOADCARE_DOMAINS].join(
      " ",
    )}`,
    `frame-src 'self' ${[...CLERK_DOMAINS, ...TURNSTILE_DOMAINS, ...WIPAY_DOMAINS].join(" ")}`,
    `worker-src 'self' blob:`,
    `media-src 'self' blob:`,
    `form-action 'self' ${WIPAY_DOMAINS.join(" ")}`,
    ...(IS_PRODUCTION ? ["upgrade-insecure-requests"] : []),
    ...(CSP_REPORT_URI ? [`report-uri ${CSP_REPORT_URI}`] : []),
  ];

  return directives.join("; ");
}

const CSP_HEADER_NAME =
  IS_PRODUCTION && !CSP_REPORT_ONLY
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";

const SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  { key: CSP_HEADER_NAME, value: buildCsp() },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  ...(IS_PRODUCTION
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
