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
  "https://clerk.curatedcarrentals.com",
];

const TURNSTILE_DOMAINS = [
  // Cloudflare Turnstile widget + siteverify-related browser calls.
  "https://challenges.cloudflare.com",
];

const UPLOADCARE_DOMAINS = [
  // Uploadcare widget script and CDN files used by admin/public uploads.
  "https://ucarecdn.com",
  "https://ucarecd.net",
  "https://*.ucarecd.net",
  "https://upload.uploadcare.com",
];

const WIPAY_DOMAINS = [
  // WiPay hosted payment pages (redirect/form targets).
  "https://jm.wipayfinancial.com",
];

const CUSTOMER_SITE_DOMAINS = [
  // Remote marketing/fleet assets mirrored from the live customer site.
  "https://curatedcarrentals.com",
];

function buildCsp(frameAncestors: string = "'none'") {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'", // Required for existing inline theme bootstrap script.
    ...(!IS_PRODUCTION ? ["'unsafe-eval'"] : []),
    ...CLERK_DOMAINS,
    ...TURNSTILE_DOMAINS,
    ...UPLOADCARE_DOMAINS,
  ];

  // In dev, Next.js HMR uses websockets (ws/wss). CSP `connect-src 'self'` does not cover ws/wss.
  const connectSrc = [
    "'self'",
    ...CLERK_DOMAINS,
    ...TURNSTILE_DOMAINS,
    ...UPLOADCARE_DOMAINS,
    ...(!IS_PRODUCTION ? ["ws:", "wss:"] : []),
  ];

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors ${frameAncestors}`,
    `script-src ${scriptSrc.join(" ")}`,
    `style-src 'self' 'unsafe-inline'`,
    `font-src 'self' data:`,
    `img-src 'self' data: blob: ${[...CLERK_DOMAINS, ...UPLOADCARE_DOMAINS, ...CUSTOMER_SITE_DOMAINS].join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
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

function buildSecurityHeaders(options?: { frameAncestors?: string; xFrameOptions?: string }) {
  return [
    { key: CSP_HEADER_NAME, value: buildCsp(options?.frameAncestors) },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: options?.xFrameOptions ?? "DENY" },
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
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactCompiler: true,

  // Allow Next dev to serve /_next assets when using local Playwright/dev origins.
  allowedDevOrigins: [
    "http://ccr.test:3000",
    "http://ccr.test:4173",
    "http://localhost:3000",
    "http://localhost:4173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:4173",
    "https://ccr.test:3000",
    "https://ccr.test:4173",
    "https://localhost:3000",
    "https://localhost:4173",
    "https://127.0.0.1:3000",
    "https://127.0.0.1:4173",
  ],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
      {
        source: "/bookings/:id/invoice",
        headers: buildSecurityHeaders({
          frameAncestors: "'self'",
          xFrameOptions: "SAMEORIGIN",
        }),
      },
      {
        source: "/bookings/:id/invoice/preview",
        headers: buildSecurityHeaders({
          frameAncestors: "'self'",
          xFrameOptions: "SAMEORIGIN",
        }),
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ucarecdn.com",
      },
      {
        protocol: "https",
        hostname: "ucarecd.net",
      },
      {
        protocol: "https",
        hostname: "**.ucarecd.net",
      },
      {
        protocol: "https",
        hostname: "curatedcarrentals.com",
      },
    ],
  },
};

export default nextConfig;
