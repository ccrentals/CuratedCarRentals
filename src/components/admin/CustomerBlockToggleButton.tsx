"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

type CustomerBlockToggleButtonProps = {
  customerId: string;
  isBlocked: boolean;
};

export function CustomerBlockToggleButton({
  customerId,
  isBlocked,
}: CustomerBlockToggleButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onToggle() {
    if (loading) return;
    const nextBlocked = !isBlocked;
    const confirmed = window.confirm(
      nextBlocked
        ? "Block this customer? New bookings from customer pages will be disabled."
        : "Unblock this customer?",
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/customers/${customerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          setBlocked: nextBlocked,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        window.alert(payload?.error ?? "Unable to update customer block status.");
        setLoading(false);
        return;
      }

      router.refresh();
    } catch {
      window.alert("Unable to update customer block status.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
        isBlocked
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
          : "border-red-500/60 bg-red-500/10 text-red-300"
      } disabled:cursor-not-allowed disabled:opacity-60`}
      title={isBlocked ? "Unblock customer" : "Block customer"}
    >
      {loading ? "Saving..." : isBlocked ? "Unblock" : "Block"}
    </button>
  );
}
