import type { NextConfig } from "next";
import { getConfiguredBunnyPublicCdn } from "./src/lib/security/csp";

export { getConfiguredBunnyPublicCdn } from "./src/lib/security/csp";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const BUNNY_PUBLIC_CDN = getConfiguredBunnyPublicCdn();

function buildSecurityHeaders(options?: { frameAncestors?: string; xFrameOptions?: string }) {
  return [
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
      ...(BUNNY_PUBLIC_CDN
        ? [
            {
              protocol: "https" as const,
              hostname: BUNNY_PUBLIC_CDN.hostname,
            },
          ]
        : []),
    ],
  },
};

export default nextConfig;
