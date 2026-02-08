"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

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
  isPaidInFull?: boolean;
};

export function BookingActions({
  bookingId,
  bookingStatus,
  hasPayments,
  isPaidInFull,
}: BookingActionsProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<ActionKey | null>(null);
  const [emailLoading, setEmailLoading] = useState<"booking_created" | "deposit_receipt" | null>(
    null,
  );
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

    const csrfToken = await ensureCsrfToken();
    const headers = {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken ?? "",
    };

    const response =
      actionKey === "confirm" || actionKey === "complete"
        ? await fetch(`/api/admin/bookings/${bookingId}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ action: actionKey }),
          })
        : await fetch(`/api/admin/bookings/${bookingId}/${actionKey === "full" ? "mark-fully-paid" : actionKey === "deposit" ? "mark-deposit-paid" : "cancel"}`, {
            method: "POST",
            headers,
          });

    const data = await response.json().catch(() => ({}));
    setLoadingKey(null);

    if (!response.ok) {
      setError(data.error ?? "Action failed");
      return;
    }

    setMessage(data.message ?? "Action completed successfully.");
    router.refresh();
  }

  async function resendEmail(type: "booking_created" | "deposit_receipt") {
    setMessage(null);
    setError(null);
    setEmailLoading(type);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/bookings/${bookingId}/resend-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ type }),
    });

    setEmailLoading(null);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Email failed");
      return;
    }

    setMessage("Email sent successfully.");
  }

  return (
    <div className="flex flex-col gap-3">
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
          disabled={loadingKey === "full" || Boolean(isPaidInFull)}
          title={isPaidInFull ? "Already fully paid" : undefined}
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
        >
          {loadingKey === "full" ? "Working..." : actionLabels.full}
        </button>
        <button
          type="button"
          onClick={() => runAction("cancel")}
          disabled={loadingKey === "cancel"}
          className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {loadingKey === "cancel" ? "Working..." : actionLabels.cancel}
        </button>
      </div>
      {hasPayments ? <span className="text-xs text-red-600">Refund required</span> : null}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--ccr-muted)]">Email</span>
        <button
          type="button"
          onClick={() => resendEmail("booking_created")}
          disabled={emailLoading === "booking_created"}
          className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 font-semibold text-[var(--ccr-text)] disabled:opacity-60"
        >
          {emailLoading === "booking_created" ? "Sending..." : "Resend booking email"}
        </button>
        <button
          type="button"
          onClick={() => resendEmail("deposit_receipt")}
          disabled={emailLoading === "deposit_receipt"}
          className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 font-semibold text-[var(--ccr-text)] disabled:opacity-60"
        >
          {emailLoading === "deposit_receipt" ? "Sending..." : "Resend deposit receipt"}
        </button>
        <Link
          href={`/api/admin/bookings/${bookingId}/invoice-payload`}
          className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 font-semibold text-[var(--ccr-text)]"
        >
          Invoice payload
        </Link>
      </div>

      {message ? <p className="text-xs text-green-700">{message}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
