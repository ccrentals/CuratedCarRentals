"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

export function RestoreVehicleButton({
  vehicleId,
  returnTo,
}: {
  vehicleId: string;
  returnTo: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (loading) return;
    setLoading(true);
    setError(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/vehicles/${vehicleId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        action: "restore",
        csrfToken: csrfToken ?? "",
      }),
    });

    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? data.message ?? "Restore failed");
      return;
    }

    router.push(returnTo);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => restore()}
        disabled={loading}
        className="inline-flex min-h-11 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
      >
        {loading ? "Restoring..." : "Restore"}
      </button>
      {error ? <span className="text-[11px] text-red-400">{error}</span> : null}
    </div>
  );
}
