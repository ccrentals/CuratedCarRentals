import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

const PRIVATE_PATHS = [
  "/admin/",
  "/api/",
  "/book/checkout",
  "/bookings/",
  "/forgot-password",
  "/payment/",
  "/sign-in/",
  "/sign-up/",
  "/task/",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: "OAI-SearchBot",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
