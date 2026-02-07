import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AdminRouteFlag } from "@/components/site/AdminRouteFlag";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";

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
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="flex min-h-screen flex-col bg-[var(--ccr-bg)] text-[var(--ccr-text)]">
          <AdminRouteFlag />
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
