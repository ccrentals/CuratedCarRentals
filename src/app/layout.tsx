import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";

import { CsrfBootstrap } from "@/components/site/CsrfBootstrap";
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
  const allowedThemesJson = JSON.stringify(APP_THEMES);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="ccr-theme-init"
          // Apply theme before hydration to avoid flashes on refresh.
          strategy="beforeInteractive"
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
        {children}
      </body>
    </html>
  );
}
