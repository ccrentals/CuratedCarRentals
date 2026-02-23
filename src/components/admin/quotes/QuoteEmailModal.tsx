"use client";

import { useEffect, useMemo, useState } from "react";

import { buildQuoteEmailDraft } from "@/lib/quotes/quoteUi";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type QuoteEmailTarget = {
  id: string;
  customerFullName: string;
  customerEmail: string;
  startAt: string;
  endAt: string;
  pickupLocationText: string;
  dropoffLocationText: string;
  vehicleLabel: string;
  totalCents: number;
  depositRequiredCents: number;
  amountDueCents: number;
  expiresAt?: string | null;
};

type QuoteEmailModalProps = {
  open: boolean;
  target: QuoteEmailTarget | null;
  onClose: () => void;
  onSent?: () => void;
};

type QuoteEmailResponse = {
  ok?: boolean;
  error?: string;
  toEmail?: string;
};

export function QuoteEmailModal({ open, target, onClose, onSent }: QuoteEmailModalProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setError(null);
    setSuccess(null);
    setSending(false);
  }, [open, target?.id]);

  const draft = useMemo(() => {
    if (!target) return null;
    return buildQuoteEmailDraft({
      quoteId: target.id,
      customerName: target.customerFullName,
      customerEmail: target.customerEmail,
      startAt: target.startAt,
      endAt: target.endAt,
      pickupLocation: target.pickupLocationText,
      dropoffLocation: target.dropoffLocationText,
      vehicleLabel: target.vehicleLabel,
      totalCents: target.totalCents,
      depositRequiredCents: target.depositRequiredCents,
      amountDueCents: target.amountDueCents,
      expiresAt: target.expiresAt ?? null,
    });
  }, [target]);

  async function sendEmail() {
    if (!target || sending) return;
    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/quotes/${target.id}/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          csrfToken,
          toEmail: target.customerEmail,
          message: message.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as QuoteEmailResponse;
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Unable to send quote email.");
        return;
      }

      setSuccess(`Email sent to ${payload.toEmail ?? target.customerEmail}.`);
      onSent?.();
    } catch {
      setError("Unable to send quote email.");
    } finally {
      setSending(false);
    }
  }

  if (!open || !target) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close email quote modal"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Email quote"
        className="absolute right-0 top-0 h-full w-full max-w-xl border-l border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-2xl"
      >
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-[var(--ccr-border)] px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Email Quote</p>
              <h2 className="mt-1 text-lg font-bold text-[var(--ccr-text)]">Send from server</h2>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">To: {target.customerEmail}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Close
            </button>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Subject</p>
              <p className="mt-1 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]">
                {draft?.subject ?? "Quote"}
              </p>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Optional note
              <textarea
                rows={4}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Add a short note for the customer..."
                className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm font-normal normal-case text-[var(--ccr-text)]"
              />
            </label>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Body preview</p>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-3 text-xs leading-5 text-[var(--ccr-text)]">
                {draft?.body ?? ""}
              </pre>
            </div>

            {error ? <p className="text-xs font-semibold text-red-300">{error}</p> : null}
            {success ? <p className="text-xs font-semibold text-emerald-200">{success}</p> : null}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-[var(--ccr-border)] px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void sendEmail()}
              disabled={sending}
              className="rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
            >
              {sending ? "Sending..." : "Send email"}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
