"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { formatJmd } from "@/lib/money";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type ManualPaymentFormProps = {
  bookingId: string;
  total: number;
  paidToDate: number;
  balanceDue: number;
};

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "OTHER", label: "Other" },
] as const;

export function ManualPaymentForm({
  bookingId,
  total,
  paidToDate,
  balanceDue,
}: ManualPaymentFormProps) {
  const router = useRouter();
  const [amount, setAmount] = useState(balanceDue > 0 ? String(balanceDue) : "");
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("CASH");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage(null);
    setError(null);

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid payment amount.");
      setLoading(false);
      return;
    }

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/bookings/${bookingId}/add-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ amount: numericAmount, method, note }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "Unable to add payment.");
      setLoading(false);
      return;
    }

    setMessage(
      data.paidInFull
        ? "Payment recorded. Booking is now paid in full."
        : "Payment recorded. Email sent with updated balance.",
    );
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Add Manual Payment</p>
          <p className="text-xs text-[var(--ccr-muted)]">
            Total {formatJmd(total)} · Paid {formatJmd(paidToDate)} · Balance {formatJmd(balanceDue)}
          </p>
        </div>
      </div>

      <form className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]" onSubmit={handleSubmit}>
        <label className="text-xs text-[var(--ccr-muted)]">
          Amount (JMD)
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            type="number"
            min="0"
            step="0.01"
            required
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <label className="text-xs text-[var(--ccr-muted)]">
          Method
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as (typeof METHODS)[number]["value"])}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            {METHODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--ccr-muted)] md:col-span-2">
          Notes (optional)
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Saving..." : "Record Payment"}
          </button>
        </div>
      </form>

      {message ? <p className="mt-2 text-xs text-emerald-600">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
