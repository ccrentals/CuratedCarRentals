"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { buttonStyles } from "@/components/ui/Button";

type PaymentRowActionsProps = {
  paymentId: string;
  provider: string;
  status: string;
  amount: number;
  deletedAt?: string | null;
  isRefunded?: boolean;
  canAdmin: boolean;
  requireRestoreReason?: boolean;
};

type Mode = "delete" | "restore" | "refund" | null;

export function PaymentRowActions({
  paymentId,
  provider,
  status,
  amount,
  deletedAt,
  isRefunded,
  canAdmin,
  requireRestoreReason = true,
}: PaymentRowActionsProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDeleted = Boolean(deletedAt);
  const refunded = Boolean(isRefunded);
  const showManualActions = canAdmin && provider === "MANUAL";
  const showRefundAction = canAdmin && provider === "WIPAY" && status === "DEPOSIT_PAID" && amount > 0;

  const title = useMemo(() => {
    if (showManualActions) {
      return isDeleted ? "Restore payment" : "Cancel payment";
    }
    if (showRefundAction) return "Refund/Void payment";
    return "";
  }, [showManualActions, isDeleted, showRefundAction]);

  async function submit(action: "delete" | "restore") {
    if (loading) return;
    setLoading(true);
    setError(null);

    if (action === "delete" && !reason.trim()) {
      setError("Reason is required.");
      setLoading(false);
      return;
    }

    if (action === "restore" && requireRestoreReason && !note.trim()) {
      setError("Reason is required.");
      setLoading(false);
      return;
    }

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/payments/${paymentId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          action,
          reason: action === "delete" ? reason.trim() : undefined,
          note: action === "restore" ? note.trim() || undefined : undefined,
        }),
      },
    );

    const data = await response.json().catch(() => ({}));

    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Action failed");
      return;
    }

    setMode(null);
    setReason("");
    setNote("");
    router.refresh();
  }

  async function submitRefund() {
    if (loading) return;
    setLoading(true);
    setError(null);

    if (refunded) {
      setError("Already refunded.");
      setLoading(false);
      return;
    }

    if (!reason.trim()) {
      setError("Reason is required.");
      setLoading(false);
      return;
    }

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/payments/${paymentId}/refund`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ reason: reason.trim() }),
    });

    const data = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? data.message ?? "Refund failed");
      return;
    }

    setMode(null);
    setReason("");
    router.refresh();
  }

  if (!showManualActions && !showRefundAction) return null;

  return (
    <div data-testid="payment-row-actions" className="flex items-center justify-end gap-2">
      {showManualActions ? (
        <button
          type="button"
          data-testid={isDeleted ? "payment-row-action-restore" : "payment-row-action-delete"}
          onClick={() => {
            setError(null);
            setReason("");
            setNote("");
            setMode(isDeleted ? "restore" : "delete");
          }}
          title={title}
          className={
            isDeleted
              ? buttonStyles({ variant: "secondary", size: "sm" })
              : buttonStyles({ variant: "danger", size: "sm" })
          }
        >
          {isDeleted ? "Restore" : "Cancel"}
        </button>
      ) : null}

      {showRefundAction ? (
        <button
          type="button"
          data-testid="payment-row-action-refund"
          onClick={() => {
            if (refunded) return;
            setError(null);
            setReason("");
            setMode("refund");
          }}
          disabled={refunded}
          title={refunded ? "Already refunded" : title}
          className={buttonStyles({ variant: "secondary", size: "sm" })}
        >
          Refund/Void
        </button>
      ) : null}

      {mode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => {
              if (loading) return;
              setMode(null);
              setError(null);
            }}
          />
          <div
            data-testid="payment-row-action-dialog"
            className="relative w-full max-w-md rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-[var(--ccr-text)]">
              {mode === "delete"
                ? "Cancel manual payment"
                : mode === "restore"
                  ? "Restore manual payment"
                  : "Refund/Void WiPay payment"}
            </h3>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">
              {mode === "delete"
                ? "This will cancel the payment entry and roll totals back."
                : mode === "restore"
                  ? "This will restore the payment and re-apply totals."
                  : "This records a refund/void in the system and adjusts totals. It does not call WiPay automatically."}
            </p>

            {mode === "delete" ? (
              <label className="mt-4 block text-xs text-[var(--ccr-muted)]">
                Reason (required)
                <textarea
                  data-testid="payment-row-action-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
            ) : mode === "restore" ? (
              <label className="mt-4 block text-xs text-[var(--ccr-muted)]">
                {requireRestoreReason ? "Reason (required)" : "Reason (optional)"}
                <textarea
                  data-testid="payment-row-action-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 text-sm text-[var(--ccr-muted)]">
                  <div className="flex items-center justify-between">
                    <span>Refund amount</span>
                    <span className="font-semibold text-[var(--ccr-text)]">{amount.toFixed(2)}</span>
                  </div>
                </div>
                <label className="block text-xs text-[var(--ccr-muted)]">
                  Reason (required)
                  <textarea
                    data-testid="payment-row-action-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>
              </div>
            )}

            {error ? (
              <p data-testid="payment-row-action-error" className="mt-3 text-xs text-red-300">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                data-testid="payment-row-action-cancel"
                onClick={() => {
                  if (loading) return;
                  setMode(null);
                  setError(null);
                }}
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="payment-row-action-confirm"
                onClick={() => (mode === "refund" ? submitRefund() : submit(mode))}
                disabled={loading}
                className={
                  mode === "delete"
                    ? buttonStyles({ variant: "danger", size: "sm" })
                    : buttonStyles({ variant: "primary", size: "sm" })
                }
              >
                {loading
                  ? "Saving..."
                  : mode === "delete"
                    ? "Cancel payment"
                    : mode === "restore"
                      ? "Restore"
                      : "Record refund"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
