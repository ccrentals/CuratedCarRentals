"use client";

import { useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

type PaymentStartResponse = {
  ok?: boolean;
  error?: string;
  redirectUrl?: string;
};

export function PayInFullButton({ bookingId }: { bookingId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setError(null);

    const csrfToken = await ensureCsrfToken();

    const response = await fetch("/api/payments/wipay/full/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ bookingId }),
    });

    let data: PaymentStartResponse = {};
    try {
      data = (await response.json()) as PaymentStartResponse;
    } catch {
      data = {};
    }

    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Failed to start payment");
      return;
    }

    if (!data.redirectUrl) {
      setError(data.error ?? "Missing redirectUrl from API");
      return;
    }

    if (data.ok === false && data.error) {
      setError(data.error);
      return;
    }

    window.location.href = data.redirectUrl;
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
      >
        {loading ? "Redirecting..." : "Pay in Full"}
      </button>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
