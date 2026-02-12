"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

const actionLabels = {
  confirm: "Confirm Booking",
  complete: "Complete Booking",
  deposit: "Mark Deposit Paid",
  full: "Mark Balance Paid",
  cancel: "Cancel Booking",
  archive: "Archive Booking",
} as const;

type ActionKey = keyof typeof actionLabels;

type BookingActionsProps = {
  bookingId: string;
  bookingStatus?: string;
  isPaidInFull?: boolean;
  isDepositPaid?: boolean;
  canAdmin?: boolean;
};

export function BookingActions({
  bookingId,
  bookingStatus,
  isPaidInFull,
  isDepositPaid,
  canAdmin,
}: BookingActionsProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<ActionKey | null>(null);
  const [emailLoading, setEmailLoading] = useState<"booking_created" | "deposit_receipt" | null>(
    null,
  );
  const normalizedStatus = bookingStatus?.trim().toUpperCase();
  const canConfirm = !normalizedStatus || ["PENDING_PAYMENT", "PENDING"].includes(normalizedStatus);
  const canComplete = !normalizedStatus || ["CONFIRMED", "PICKED_UP"].includes(normalizedStatus);
  const canArchive = Boolean(canAdmin) && normalizedStatus === "RETURNED";
  const canCancel = !normalizedStatus || !["CANCELLED", "RETURNED"].includes(normalizedStatus);
  const cancelButtonClass = canCancel
    ? "rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
    : "rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-muted)] disabled:cursor-not-allowed";

  // Prevent stale status-related errors lingering after a refresh/action.
  useEffect(() => {
    setError(null);
  }, [normalizedStatus]);

  async function runAction(actionKey: ActionKey) {
    setMessage(null);
    setError(null);
    setLoadingKey(actionKey);

    if (actionKey === "deposit" && (isDepositPaid || isPaidInFull)) {
      setError(isPaidInFull ? "Booking is already fully paid" : "Deposit is already recorded");
      setLoadingKey(null);
      return;
    }

    if (actionKey === "cancel" && !canCancel) {
      setError(
        normalizedStatus === "RETURNED"
          ? "Returned bookings cannot be cancelled"
          : "Booking is already cancelled",
      );
      setLoadingKey(null);
      return;
    }

    if (actionKey === "cancel") {
      const confirmed = window.confirm("Cancel this booking?");
      if (!confirmed) {
        setLoadingKey(null);
        return;
      }
    }

    let archiveReason: string | null = null;
    if (actionKey === "archive") {
      const defaultReason =
        normalizedStatus === "RETURNED" ? "Completed/Returned" : "Manual archive";
      archiveReason = window.prompt("Archive reason (required):", defaultReason);
      if (archiveReason === null) {
        setLoadingKey(null);
        return;
      }
      if (!archiveReason.trim()) {
        setError("Archive reason is required.");
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
      actionKey === "confirm" || actionKey === "complete" || actionKey === "archive"
        ? await fetch(`/api/admin/bookings/${bookingId}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify(
              actionKey === "archive" ? { action: actionKey, reason: archiveReason } : { action: actionKey },
            ),
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
          disabled={loadingKey === "deposit" || Boolean(isDepositPaid) || Boolean(isPaidInFull)}
          title={isPaidInFull ? "Already fully paid" : isDepositPaid ? "Deposit already recorded" : undefined}
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
          disabled={loadingKey === "cancel" || !canCancel}
          title={
            !canCancel
              ? normalizedStatus === "RETURNED"
                ? "Returned bookings cannot be cancelled"
                : "Already cancelled"
              : undefined
          }
          className={cancelButtonClass}
        >
          {loadingKey === "cancel" ? "Working..." : actionLabels.cancel}
        </button>
        {canArchive ? (
          <button
            type="button"
            onClick={() => runAction("archive")}
            disabled={loadingKey === "archive"}
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
          >
            {loadingKey === "archive" ? "Working..." : actionLabels.archive}
          </button>
        ) : null}
      </div>

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

      {message ? <p className="text-xs font-semibold text-[var(--ccr-text)]">{message}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
