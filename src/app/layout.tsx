import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { BreakpointOverlay } from "@/components/dev/BreakpointOverlay";
import { CsrfBootstrap } from "@/components/site/CsrfBootstrap";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { assertProductionEnv } from "@/lib/env";
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

export const metadata: Metadata = {
  title: "Curated Car Rentals",
  description: "Car rentals in Jamaica with clean vehicles and simple booking.",
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
  const allowedThemesJson = JSON.stringify(APP_THEMES);

  return (
    <html lang="en" suppressHydrationWarning>
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[var(--ccr-bg)] text-[var(--ccr-text)]`}
      >
        <CsrfBootstrap />
        <div className="flex min-h-screen flex-col">
          <div data-site-header>
            <Header />
          </div>
          <main className="flex-1">{children}</main>
          <div data-site-footer>
            <Footer />
          </div>
        </div>
        {showBreakpointOverlay ? <BreakpointOverlay /> : null}
      </body>
    </html>
  );
}
