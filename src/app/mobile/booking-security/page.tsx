import type { Metadata } from "next";

import { MobileBookingSecurityChallenge } from "@/components/security/MobileBookingSecurityChallenge";

export const metadata: Metadata = {
  title: "Booking security check | Curated Car Rentals",
  robots: { index: false, follow: false },
};

const STATE_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

export default async function MobileBookingSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawState = Array.isArray(params.state) ? params.state[0] : params.state;
  const state = typeof rawState === "string" && STATE_PATTERN.test(rawState) ? rawState : "";

  if (!state) {
    return (
      <main className="min-h-screen bg-[var(--ccr-surface-soft)] px-5 py-12 text-[var(--ccr-text)]">
        <section className="mx-auto max-w-lg rounded-[1.75rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8">
          <h1 className="font-display text-3xl font-bold">Invalid app request</h1>
          <p className="mt-3 leading-7 text-[var(--ccr-muted)]">Return to the Curated Car Rentals app and start the security check again.</p>
        </section>
      </main>
    );
  }

  return <MobileBookingSecurityChallenge state={state} />;
}
