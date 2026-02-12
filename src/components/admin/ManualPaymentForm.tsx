"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

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
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "POS_CARD", label: "POS/Card on delivery" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTHER", label: "Other" },
] as const;

type MethodValue = (typeof METHODS)[number]["value"];

function toDateTimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function ManualPaymentForm({
  bookingId,
  total,
  paidToDate,
  balanceDue,
}: ManualPaymentFormProps) {
  const router = useRouter();
  const [methodChoice, setMethodChoice] = useState<string>("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [method, setMethod] = useState<MethodValue>("CASH");
  const [amount, setAmount] = useState(balanceDue > 0 ? String(balanceDue) : "");
  const [paidAt, setPaidAt] = useState(() => toDateTimeLocalValue(new Date()));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaultAmount = useMemo(() => (balanceDue > 0 ? String(balanceDue) : ""), [balanceDue]);

  function closeDrawer() {
    setDrawerOpen(false);
    setLoading(false);
    setError(null);
    setMethodChoice("");
  }

  function openDrawer(nextMethod: MethodValue) {
    setMessage(null);
    setError(null);
    setMethod(nextMethod);
    setAmount(defaultAmount);
    setPaidAt(toDateTimeLocalValue(new Date()));
    setReference("");
    setNote("");
    setDrawerOpen(true);
  }

  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid payment amount.");
      setLoading(false);
      return;
    }

    const paidAtDate = paidAt ? new Date(paidAt) : null;
    const paidAtIso =
      paidAtDate && !Number.isNaN(paidAtDate.getTime()) ? paidAtDate.toISOString() : undefined;

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/bookings/${bookingId}/add-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        amount: numericAmount,
        method,
        reference: reference.trim() || undefined,
        note,
        paidAt: paidAtIso,
      }),
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
    closeDrawer();
    router.refresh();
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Add Manual Payment</p>
          <p className="text-xs text-[var(--ccr-muted)]">
            Total{" "}
            <span className="font-semibold text-[color:var(--ccr-money-emphasis)]">
              {formatJmd(total)}
            </span>{" "}
            · Paid{" "}
            <span className="font-semibold text-[color:var(--ccr-money-emphasis)]">
              {formatJmd(paidToDate)}
            </span>{" "}
            · Balance{" "}
            <span className="font-semibold text-[color:var(--ccr-money-emphasis)]">
              {formatJmd(balanceDue)}
            </span>
          </p>
        </div>
      </div>

      <label className="mt-3 block text-xs text-[var(--ccr-muted)]">
        Method
        <select
          value={methodChoice}
          onChange={(event) => {
            const next = event.target.value as MethodValue | "";
            setMethodChoice(next);
            if (next) openDrawer(next);
          }}
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
        >
          <option value="">Select a payment method…</option>
          {METHODS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {message ? (
        <p className="mt-2 text-sm font-semibold text-[var(--ccr-text)]">{message}</p>
      ) : null}
      {error && !drawerOpen ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}

      <div className={`fixed inset-0 z-50 ${drawerOpen ? "" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity ${drawerOpen ? "opacity-100" : "opacity-0"}`}
          onClick={closeDrawer}
        />
        <div
          className={`absolute right-0 top-0 h-full w-full max-w-md border-l border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-2xl transition-transform duration-200 ease-out ${
            drawerOpen ? "translate-x-0" : "translate-x-full"
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Add manual payment"
        >
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--ccr-border)] px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Add Manual Payment
                </p>
                <h3 className="mt-1 text-lg font-bold text-[var(--ccr-text)]">
                  Record an offline payment
                </h3>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
              >
                Close
              </button>
            </div>

            <form className="flex-1 overflow-y-auto px-5 py-4" onSubmit={handleSubmit}>
              <div className="grid gap-3">
                <label className="text-xs text-[var(--ccr-muted)]">
                  Method
                  <select
                    value={method}
                    onChange={(event) => setMethod(event.target.value as MethodValue)}
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  >
                    {METHODS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs text-[var(--ccr-muted)]">
                  Amount paid (JMD)
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>

                <label className="text-xs text-[var(--ccr-muted)]">
                  Payment date/time
                  <input
                    value={paidAt}
                    onChange={(event) => setPaidAt(event.target.value)}
                    type="datetime-local"
                    required
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>

                <label className="text-xs text-[var(--ccr-muted)]">
                  Reference / receipt # (optional)
                  <input
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    type="text"
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>

                <label className="text-xs text-[var(--ccr-muted)]">
                  Notes (optional)
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>

                {error ? <p className="text-xs text-red-600">{error}</p> : null}
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {loading ? "Saving..." : "Save Payment"}
                </button>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
