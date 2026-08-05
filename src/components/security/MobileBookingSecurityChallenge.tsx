"use client";

import { useCallback, useEffect, useState } from "react";

import { TurnstileWidget } from "@/components/security/TurnstileWidget";

export function MobileBookingSecurityChallenge({ state }: { state: string }) {
  const [token, setToken] = useState<string | null>(null);
  const onTokenChange = useCallback((nextToken: string | null) => setToken(nextToken), []);

  useEffect(() => {
    if (!token) return;
    const query = new URLSearchParams({ token, state });
    window.location.replace(`curatedcarrentals://booking-security?${query.toString()}`);
  }, [state, token]);

  return (
    <main className="min-h-screen bg-[var(--ccr-surface-soft)] px-5 py-12 text-[var(--ccr-text)]">
      <section className="mx-auto max-w-lg rounded-[1.75rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-xl sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ccr-accent-strong)]">
          Curated Car Rentals app
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold">Confirm you are human</h1>
        <p className="mt-3 leading-7 text-[var(--ccr-muted)]">
          Complete this one-time security check. You will return to the Android app automatically.
        </p>
        <div className="mt-6 rounded-xl border border-[var(--ccr-border)] p-4">
          <TurnstileWidget action="public_booking" onTokenChange={onTokenChange} theme="light" />
        </div>
        {token ? <p className="mt-4 text-sm font-semibold">Returning to the app…</p> : null}
        <p className="mt-6 text-xs leading-5 text-[var(--ccr-muted)]">
          This page verifies the booking request only. Payment information is never entered here.
        </p>
      </section>
    </main>
  );
}
