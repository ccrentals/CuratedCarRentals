"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const actionLabels = {
  confirm: "Confirm Booking",
  complete: "Complete Booking",
  deposit: "Mark Deposit Paid",
  full: "Mark Balance Paid",
  cancel: "Cancel Booking",
} as const;

type ActionKey = keyof typeof actionLabels;

type BookingActionsProps = {
  bookingId: string;
  bookingStatus?: string;
  hasPayments?: boolean;
};

export function BookingActions({ bookingId, bookingStatus, hasPayments }: BookingActionsProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<ActionKey | null>(null);
  const normalizedStatus = bookingStatus?.toUpperCase();
  const canConfirm = !normalizedStatus || ["PENDING_PAYMENT", "PENDING"].includes(normalizedStatus);
  const canComplete = !normalizedStatus || ["CONFIRMED", "PICKED_UP"].includes(normalizedStatus);

  async function runAction(actionKey: ActionKey) {
    setMessage(null);
    setError(null);
    setLoadingKey(actionKey);

    if (actionKey === "cancel") {
      const confirmed = window.confirm("Cancel this booking?");
      if (!confirmed) {
        setLoadingKey(null);
        return;
      }
    }

    const response =
      actionKey === "confirm" || actionKey === "complete"
        ? await fetch(`/api/admin/bookings/${bookingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: actionKey }),
          })
        : await fetch(`/api/admin/bookings/${bookingId}/${actionKey === "full" ? "mark-fully-paid" : actionKey === "deposit" ? "mark-deposit-paid" : "cancel"}`, {
            method: "POST",
          });

    setLoadingKey(null);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Action failed");
      return;
    }

    setMessage("Action completed successfully.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => runAction("confirm")}
        disabled={loadingKey === "confirm" || !canConfirm}
        className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
      >
        {loadingKey === "confirm" ? "Working..." : actionLabels.confirm}
      </button>
      <button
        type="button"
        onClick={() => runAction("complete")}
        disabled={loadingKey === "complete" || !canComplete}
        className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
      >
        {loadingKey === "complete" ? "Working..." : actionLabels.complete}
      </button>
      <button
        type="button"
        onClick={() => runAction("deposit")}
        disabled={loadingKey === "deposit"}
        className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
      >
        {loadingKey === "deposit" ? "Working..." : actionLabels.deposit}
      </button>
      <button
        type="button"
        onClick={() => runAction("full")}
        disabled={loadingKey === "full"}
        className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
      >
        {loadingKey === "full" ? "Working..." : actionLabels.full}
      </button>
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => runAction("cancel")}
          disabled={loadingKey === "cancel"}
          className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {loadingKey === "cancel" ? "Working..." : actionLabels.cancel}
        </button>
        {hasPayments ? (
          <span className="mt-1 text-xs text-red-600">Refund required</span>
        ) : null}
      </div>

      {message ? <p className="text-xs text-green-700">{message}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
