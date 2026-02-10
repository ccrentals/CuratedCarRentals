import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";

import { CsrfBootstrap } from "@/components/site/CsrfBootstrap";
import { assertProductionEnv } from "@/lib/env";

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
    var key = "ccr-theme";
    var theme = localStorage.getItem(key);
    if (theme !== "light" && theme !== "dark") {
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
