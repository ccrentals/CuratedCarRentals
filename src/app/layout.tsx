import type { Metadata } from "next";
import { Geist, Geist_Mono, Great_Vibes, Playfair_Display } from "next/font/google";

import { BreakpointOverlay } from "@/components/dev/BreakpointOverlay";
import { OptionalClerkProvider } from "@/components/security/OptionalClerkProvider";
import { assertProductionEnv } from "@/lib/env";
import { DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL } from "@/lib/seo";
import { APP_THEMES, THEME_COOKIE_NAME, THEME_STORAGE_KEY } from "@/lib/theme";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const greatVibes = Great_Vibes({
  variable: "--font-great-vibes",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: "Car Rentals in Kingston, Jamaica | Curated Car Rentals",
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Rent clean, reliable vehicles in Kingston, Jamaica with transparent pricing, local support, and convenient online reservations.",
  keywords: [
    "car rental Kingston Jamaica",
    "Jamaica car rental",
    "Kingston airport car rental",
    "vehicle rental Jamaica",
    "Curated Car Rentals",
  ],
  category: "travel",
  creator: SITE_NAME,
  publisher: SITE_NAME,
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "en_JM",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "Car Rentals in Kingston, Jamaica | Curated Car Rentals",
    description:
      "Explore Jamaica with a reliable rental vehicle, transparent pricing, and Kingston-based support.",
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        alt: "Rental car on a palm-lined road in Jamaica",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Car Rentals in Kingston, Jamaica | Curated Car Rentals",
    description:
      "Explore Jamaica with a reliable rental vehicle, transparent pricing, and Kingston-based support.",
    images: [DEFAULT_OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: "/live-site/brand/logo.png",
    apple: "/live-site/brand/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  assertProductionEnv();
  const showBreakpointOverlay =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_DISABLE_BREAKPOINT_OVERLAY !== "1";
  const showStagingBanner =
    process.env.NEXT_PUBLIC_SITE_ENV?.trim().toLowerCase() === "staging";
  const allowedThemesJson = JSON.stringify(APP_THEMES);

  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <style
          id="ccr-theme-critical"
          dangerouslySetInnerHTML={{
            __html: `
html, body {
  background: #f5f7fc;
  color: #1a243b;
}
html[data-theme="dark"], html[data-theme="dark"] body {
  background: #0d1427;
  color: #e8edf8;
}
html[data-theme="midnight"], html[data-theme="midnight"] body {
  background: #040507;
  color: #f2f5ff;
}
html[data-theme="ocean"], html[data-theme="ocean"] body {
  background: #0a1b2d;
  color: #e8f5ff;
}
html[data-theme="sand"], html[data-theme="sand"] body {
  background: #f5efe4;
  color: #2c2216;
}
html[data-theme="forest"], html[data-theme="forest"] body {
  background: #0f1d17;
  color: #e9f4ec;
}
`,
          }}
        />
        <script
          id="ccr-theme-init"
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  try {
    var key = "${THEME_STORAGE_KEY}";
    var cookieKey = "${THEME_COOKIE_NAME}";
    var allowed = ${allowedThemesJson};
    var cookieTheme = null;
    var cookieParts = (document.cookie || "").split(";");
    for (var i = 0; i < cookieParts.length; i++) {
      var part = cookieParts[i].trim();
      if (part.indexOf(cookieKey + "=") === 0) {
        cookieTheme = decodeURIComponent(part.slice(cookieKey.length + 1));
        break;
      }
    }
    var theme = allowed.indexOf(cookieTheme) !== -1 ? cookieTheme : localStorage.getItem(key);
    if (!theme || allowed.indexOf(theme) === -1) {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", theme);
    var darkThemes = ["dark", "midnight", "ocean", "forest"];
    document.documentElement.style.colorScheme = darkThemes.indexOf(theme) !== -1 ? "dark" : "light";
  } catch (e) {
    // Best-effort only.
  }
})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable} ${greatVibes.variable} antialiased bg-[var(--ccr-bg)] text-[var(--ccr-text)]`}
      >
        {showStagingBanner ? (
          <div
            role="status"
            className="relative z-[100] border-b border-amber-950 bg-amber-300 px-4 py-2 text-center text-sm font-bold text-amber-950"
          >
            Staging site - test environment only
          </div>
        ) : null}
        <OptionalClerkProvider>
          <div className="flex min-h-screen flex-col">
            <main className="flex-1">{children}</main>
          </div>
        </OptionalClerkProvider>
        {showBreakpointOverlay ? <BreakpointOverlay /> : null}
      </body>
    </html>
  );
}
