"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { InlineDateTimeRange } from "@/components/shared/InlineDateTimeRange";
import { buttonStyles } from "@/components/ui/Button";
import { siteContent } from "@/data/content";
import { formatJmd } from "@/lib/money";
import { quoteStatusLabel, shortQuoteId } from "@/lib/quotes/quoteUi";

type QuoteDetailItem = {
  id: string;
  publicId: string;
  createdAt: string;
  status: string;
  expiresAt: string | null;
  customerFullName: string;
  customerEmail: string;
  customerPhone: string | null;
  startAt: string;
  endAt: string;
  pickupLocationText: string;
  dropoffLocationText: string;
  vehicleLabel: string;
  vehicleClass: string | null;
  baseTotalCents: number;
  insuranceTotalCents: number;
  discountTotalCents: number;
  subtotalCents: number;
  totalCents: number;
  depositRequiredCents: number;
  amountDueCents: number;
  promoCode: string | null;
  comments: string | null;
};

type QuoteDetailResponse = {
  ok?: boolean;
  item?: QuoteDetailItem;
  error?: string;
};

export function QuotePrintClient({ quoteId }: { quoteId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<QuoteDetailItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/quotes/${quoteId}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as QuoteDetailResponse;
      if (!response.ok || !payload.ok || !payload.item) {
        setError(payload.error ?? "Unable to load quote.");
        setItem(null);
        return;
      }

      setItem(payload.item);
    } catch {
      setError("Unable to load quote.");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 print:px-0 print:py-0">
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link
          href={`/admin/bookings/quotes/${quoteId}`}
          className={buttonStyles({ variant: "secondary", size: "sm" })}
        >
          Back to quote
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className={buttonStyles({ variant: "secondary", size: "sm" })}
        >
          Print
        </button>
      </div>

      <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 print:rounded-none print:border-0 print:bg-transparent print:p-0">
        {loading ? <p className="text-sm text-[var(--ccr-muted)]">Loading quote...</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        {item ? (
          <div className="space-y-5 text-[var(--ccr-text)]">
            <header className="border-b border-[var(--ccr-border)] pb-4">
              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">{siteContent.brand}</p>
              <h1 className="mt-1 text-2xl font-bold">
                Quote {shortQuoteId(item.id, item.publicId)}
              </h1>
              <p className="mt-1 text-sm text-[var(--ccr-muted)]">Status: {quoteStatusLabel(item.status)}</p>
              <p className="text-sm text-[var(--ccr-muted)]">Created: <DateTimeInline value={item.createdAt} /></p>
              <p className="text-sm text-[var(--ccr-muted)]">
                Expires: {item.expiresAt ? <DateTimeInline value={item.expiresAt} /> : "Not set"}
              </p>
            </header>

            <section>
              <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ccr-muted)]">Customer</h2>
              <p className="mt-2 font-semibold">{item.customerFullName}</p>
              <p className="text-sm text-[var(--ccr-muted)]">{item.customerEmail}</p>
              <p className="text-sm text-[var(--ccr-muted)]">{item.customerPhone || "—"}</p>
            </section>

            <section>
              <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ccr-muted)]">Reservation</h2>
              <p className="mt-2 text-sm"><InlineDateTimeRange startLabel={item.startAt} endLabel={item.endAt} /></p>
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">Pickup: {item.pickupLocationText}</p>
              <p className="text-sm text-[var(--ccr-muted)]">Dropoff: {item.dropoffLocationText}</p>
              <p className="text-sm text-[var(--ccr-muted)]">Vehicle: {item.vehicleLabel}{item.vehicleClass ? ` (${item.vehicleClass})` : ""}</p>
            </section>

            <section>
              <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ccr-muted)]">Pricing</h2>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-[var(--ccr-muted)]">Base</dt>
                  <dd className="font-semibold">{formatJmd(item.baseTotalCents)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--ccr-muted)]">Insurance</dt>
                  <dd className="font-semibold">{formatJmd(item.insuranceTotalCents)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--ccr-muted)]">Discount</dt>
                  <dd className="font-semibold">-{formatJmd(item.discountTotalCents)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--ccr-muted)]">Subtotal</dt>
                  <dd className="font-semibold">{formatJmd(item.subtotalCents)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--ccr-muted)]">Total</dt>
                  <dd className="font-semibold">{formatJmd(item.totalCents)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--ccr-muted)]">Deposit required</dt>
                  <dd className="font-semibold">{formatJmd(item.depositRequiredCents)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--ccr-muted)]">Amount due now</dt>
                  <dd className="font-semibold">{formatJmd(item.amountDueCents)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--ccr-muted)]">Promo</dt>
                  <dd className="font-semibold">{item.promoCode || "—"}</dd>
                </div>
              </dl>
            </section>

            {item.comments ? (
              <section>
                <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ccr-muted)]">Comments</h2>
                <p className="mt-2 text-sm text-[var(--ccr-muted)]">{item.comments}</p>
              </section>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
