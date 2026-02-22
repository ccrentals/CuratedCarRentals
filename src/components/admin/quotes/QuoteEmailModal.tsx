"use client";

import { useEffect } from "react";

import { buildQuoteEmailDraft } from "@/lib/quotes/quoteUi";

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
  openPath?: string;
};

export function QuoteEmailModal({ open, target, onClose, openPath }: QuoteEmailModalProps) {
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

  if (!open || !target) return null;

  const draft = buildQuoteEmailDraft({
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
    openPath,
  });

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
              <h2 className="mt-1 text-lg font-bold text-[var(--ccr-text)]">Send via mail client</h2>
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
                {draft.subject}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Body preview</p>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-3 text-xs leading-5 text-[var(--ccr-text)]">
                {draft.body}
              </pre>
            </div>
          </div>

          <footer className="border-t border-[var(--ccr-border)] px-5 py-4">
            <a
              href={draft.href}
              className="inline-flex rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Open email client
            </a>
          </footer>
        </div>
      </section>
    </div>
  );
}
