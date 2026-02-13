"use client";

import { useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

type PayOnPickupResponse = {
  ok?: boolean;
  error?: string;
  bookingId?: string;
};

export function PayOnPickupButton({ bookingId }: { bookingId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setError(null);

    const csrfToken = await ensureCsrfToken();

    const response = await fetch(`/api/public/bookings/${bookingId}/pay-on-pickup`, {
      method: "POST",
      headers: {
        "x-csrf-token": csrfToken ?? "",
      },
    });

    let data: PayOnPickupResponse = {};
    try {
      data = (await response.json()) as PayOnPickupResponse;
    } catch {
      data = {};
    }

    setLoading(false);

    if (!response.ok || data.ok === false) {
      setError(data.error ?? "Unable to select pay on pickup");
      return;
    }

    window.location.href = `/bookings/${bookingId}`;
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
      >
        {loading ? "Saving..." : "Pay on Pickup"}
      </button>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
