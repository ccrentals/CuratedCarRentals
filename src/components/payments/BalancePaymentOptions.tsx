"use client";

import { useMemo, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

type PaymentStartResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  redirectUrl?: string;
};

const MINIMUM_PARTIAL_JMD = 1_000;

function formatJmd(amount: number) {
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function BalancePaymentOptions({
  bookingId,
  balanceDue,
}: {
  bookingId: string;
  balanceDue: number;
}) {
  const [amount, setAmount] = useState("");
  const [loadingMode, setLoadingMode] = useState<"partial" | "balance" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const amountJmd = Number(amount);
  const wholeAmount = Number.isInteger(amountJmd) ? amountJmd : null;
  const remaining = useMemo(
    () => (wholeAmount === null ? null : Math.max(0, balanceDue - wholeAmount)),
    [balanceDue, wholeAmount],
  );

  async function startPayment(mode: "partial" | "balance") {
    if (loadingMode) return;
    setError(null);

    if (mode === "partial") {
      if (!amount.trim() || wholeAmount === null) {
        setError("Enter a whole JMD amount without cents.");
        return;
      }
      if (wholeAmount < MINIMUM_PARTIAL_JMD) {
        setError(`Partial payments must be at least ${formatJmd(MINIMUM_PARTIAL_JMD)}.`);
        return;
      }
      if (wholeAmount >= balanceDue) {
        setError("Use Pay Full Balance to pay the entire amount due.");
        return;
      }
    }

    setLoadingMode(mode);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/payments/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          bookingId,
          mode,
          ...(mode === "partial" ? { amountJmd: wholeAmount } : {}),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as PaymentStartResponse;
      if (!response.ok || !data.redirectUrl) {
        if (["stale_balance", "already_paid"].includes(data.code ?? "")) {
          setError("The balance has changed. Refresh this page to see the latest amount due.");
        } else {
          setError(data.error ?? "Unable to start payment. Please try again.");
        }
        return;
      }
      window.location.assign(data.redirectUrl);
    } finally {
      setLoadingMode(null);
    }
  }

  const partialUnavailable = balanceDue <= MINIMUM_PARTIAL_JMD;

  return (
    <div className="w-full space-y-5">
      <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
        <label htmlFor="partial-payment-amount" className="text-sm font-semibold text-[var(--ccr-text)]">
          Partial payment amount (JMD)
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id="partial-payment-amount"
            type="number"
            inputMode="numeric"
            min={MINIMUM_PARTIAL_JMD}
            max={Math.max(MINIMUM_PARTIAL_JMD, balanceDue - 1)}
            step="1"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={partialUnavailable || Boolean(loadingMode)}
            placeholder="1000"
            className="min-w-0 flex-1 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-[var(--ccr-text)] disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => startPayment("partial")}
            disabled={partialUnavailable || Boolean(loadingMode)}
            className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loadingMode === "partial" ? "Redirecting…" : "Make Partial Payment"}
          </button>
        </div>
        {partialUnavailable ? (
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            The remaining balance must be paid in full because it is not above the minimum partial payment.
          </p>
        ) : (
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            Minimum partial payment: {formatJmd(MINIMUM_PARTIAL_JMD)}.
            {remaining !== null && wholeAmount !== null && wholeAmount > 0 && wholeAmount < balanceDue
              ? ` Remaining balance after payment: ${formatJmd(remaining)}.`
              : ""}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => startPayment("balance")}
        disabled={Boolean(loadingMode)}
        className="w-full rounded-xl border border-[var(--ccr-primary)] bg-[var(--ccr-surface)] px-4 py-3 text-sm font-semibold text-[var(--ccr-text)] disabled:opacity-60 sm:w-auto"
      >
        {loadingMode === "balance" ? "Redirecting…" : `Pay Full Balance — ${formatJmd(balanceDue)}`}
      </button>
      {error ? <p role="alert" className="text-sm font-medium text-red-600">{error}</p> : null}
    </div>
  );
}
