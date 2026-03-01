"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { QuoteEmailModal } from "@/components/admin/quotes/QuoteEmailModal";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { InlineDateTimeRange } from "@/components/shared/InlineDateTimeRange";
import { formatJmd } from "@/lib/money";
import {
  formatQuoteActivityActorLabel,
  formatQuoteActivityMeta,
  formatQuoteActivityTitle,
} from "@/lib/quotes/activityLog";
import {
  formatTagsInput,
  parseTagsInput,
  quoteStatusLabel,
  quoteStatusPillToneClass,
  QUOTE_STATUS_PILL_BASE_CLASS,
  shortQuoteId,
  toDateTimeLocalValue,
  toIsoFromDateTimeLocal,
} from "@/lib/quotes/quoteUi";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type QuoteEventItem = {
  id: string;
  createdAt: string;
  eventType: string;
  actorEmail: string | null;
  meta: Record<string, unknown>;
};

type QuoteDetailItem = {
  id: string;
  publicId: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  expiresAt: string | null;
  customerFullName: string;
  customerEmail: string;
  customerPhone: string | null;
  startAt: string;
  endAt: string;
  pickupLocationId: string | null;
  dropoffLocationId: string | null;
  pickupLocationText: string;
  dropoffLocationText: string;
  vehicleId: string | null;
  vehicleLabel: string;
  vehicleClass: string | null;
  pricingJson: Record<string, unknown>;
  baseTotalCents: number;
  insuranceTotalCents: number;
  discountTotalCents: number;
  subtotalCents: number;
  totalCents: number;
  depositRequiredCents: number;
  amountDueCents: number;
  promoCode: string | null;
  insurancePlanId: string | null;
  insuranceEnabled: boolean;
  tags: string[];
  comments: string | null;
  commissionPartnerName: string | null;
  clientPaysAtPartner: boolean;
  rackPriceCents: number | null;
  createdByAdminUserId: string | null;
  lastEmailedAt: string | null;
  lastEmailedTo: string | null;
  convertedBookingId: string | null;
};

type QuoteDetailResponse = {
  ok?: boolean;
  item?: QuoteDetailItem;
  error?: string;
};

type QuoteConvertResponse = {
  ok?: boolean;
  error?: string;
  bookingId?: string;
};

type QuoteDetailClientProps = {
  quoteId: string;
  canManage: boolean;
  createdFlag?: boolean;
  initialEvents: QuoteEventItem[];
};

export function QuoteDetailClient({ quoteId, canManage, createdFlag = false, initialEvents }: QuoteDetailClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [convertedBookingId, setConvertedBookingId] = useState<string | null>(null);
  const [item, setItem] = useState<QuoteDetailItem | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [comments, setComments] = useState("");
  const [commissionPartnerName, setCommissionPartnerName] = useState("");
  const [clientPaysAtPartner, setClientPaysAtPartner] = useState(false);
  const [rackPriceInput, setRackPriceInput] = useState("");

  const eventRows = useMemo(() => initialEvents, [initialEvents]);

  const syncEditor = useCallback((nextItem: QuoteDetailItem) => {
    setExpiresAtLocal(toDateTimeLocalValue(nextItem.expiresAt));
    setTagsInput(formatTagsInput(nextItem.tags));
    setComments(nextItem.comments ?? "");
    setCommissionPartnerName(nextItem.commissionPartnerName ?? "");
    setClientPaysAtPartner(Boolean(nextItem.clientPaysAtPartner));
    setRackPriceInput(nextItem.rackPriceCents == null ? "" : String(nextItem.rackPriceCents));
  }, []);

  const loadQuote = useCallback(async () => {
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
      syncEditor(payload.item);
      setConvertedBookingId(payload.item.convertedBookingId ?? null);
    } catch {
      setError("Unable to load quote.");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [quoteId, syncEditor]);

  useEffect(() => {
    void loadQuote();
  }, [loadQuote]);

  async function patchQuote(body: Record<string, unknown>) {
    if (!canManage || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/quotes/${quoteId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ ...body, csrfToken }),
      });

      const payload = (await response.json().catch(() => ({}))) as QuoteDetailResponse;

      if (!response.ok || !payload.ok || !payload.item) {
        setError(payload.error ?? "Unable to update quote.");
        return;
      }

      setItem(payload.item);
      syncEditor(payload.item);
      setConvertedBookingId(payload.item.convertedBookingId ?? null);
      setMessage("Quote updated.");
      router.refresh();
    } catch {
      setError("Unable to update quote.");
    } finally {
      setSaving(false);
    }
  }

  async function convertQuote() {
    if (!canManage || converting) return;
    setConverting(true);
    setError(null);
    setMessage(null);
    setConvertedBookingId(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/quotes/${quoteId}/convert-to-booking`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ csrfToken }),
      });

      const payload = (await response.json().catch(() => ({}))) as QuoteConvertResponse;
      if (!response.ok || !payload.ok || !payload.bookingId) {
        setError(payload.error ?? "Unable to convert quote.");
        return;
      }

      setConvertedBookingId(payload.bookingId);
      setMessage("Quote converted to booking.");
      await loadQuote();
      router.refresh();
    } catch {
      setError("Unable to convert quote.");
    } finally {
      setConverting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-sm text-[var(--ccr-muted)]">Loading quote...</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <p className="text-sm text-[var(--ccr-text)]">{error ?? "Quote not found."}</p>
          <Link
            href="/admin/bookings/quotes"
            className="mt-4 inline-flex rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Back to quotes
          </Link>
        </div>
      </div>
    );
  }

  const rackPrice = item.rackPriceCents ?? item.baseTotalCents;
  const isCancelled = item.status === "CANCELLED";
  const canToggleInvoiceCancellation = ["DRAFT", "SENT", "ACCEPTED", "CANCELLED"].includes(item.status);

  return (
    <div data-testid="quote-detail" className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Quote</p>
          <h1 data-testid="quote-public-id" className="text-3xl font-bold text-[var(--ccr-text)]">
            Quote {shortQuoteId(item.id, item.publicId)}
          </h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">Manage quote status, metadata, pricing snapshot, and actions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/bookings/quotes"
            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Back to quotes
          </Link>
          <Link
            href={`/admin/bookings/quotes/${item.id}/print`}
            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Print
          </Link>
          <Link
            href={`/api/admin/quotes/${item.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            PDF
          </Link>
          <button
            type="button"
            onClick={() => setEmailOpen(true)}
            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Email
          </button>
          <button
            type="button"
            disabled={converting || Boolean(item.convertedBookingId)}
            onClick={() => void convertQuote()}
            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
          >
            {item.convertedBookingId ? "Converted" : converting ? "Converting..." : "Convert to Booking"}
          </button>
          <button
            type="button"
            onClick={() => void patchQuote({ status: isCancelled ? "SENT" : "CANCELLED" })}
            disabled={saving || !canToggleInvoiceCancellation || Boolean(item.convertedBookingId)}
            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
          >
            {isCancelled ? "Revert Cancellation" : "Cancel Invoice"}
          </button>
        </div>
      </div>

      {createdFlag ? <p className="mt-3 text-xs font-semibold text-emerald-200">Quote created successfully.</p> : null}
      {message ? <p className="mt-2 text-xs font-semibold text-emerald-200">{message}</p> : null}
      {convertedBookingId ? (
        <p className="mt-2 text-xs font-semibold text-emerald-200">
          Booking created.{" "}
          <Link href={`/admin/bookings/${convertedBookingId}`} className="underline">
            Open booking
          </Link>
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs font-semibold text-red-300">{error}</p> : null}

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`${QUOTE_STATUS_PILL_BASE_CLASS} ${quoteStatusPillToneClass(item.status)}`}>
            {quoteStatusLabel(item.status)}
          </span>
          <dl className="grid gap-1 text-xs text-[var(--ccr-muted)] sm:grid-cols-3 sm:gap-4">
            <div>
              <dt className="uppercase tracking-wide">Created</dt>
              <dd className="mt-0.5 text-[var(--ccr-text)]"><DateTimeInline value={item.createdAt} /></dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide">Updated</dt>
              <dd className="mt-0.5 text-[var(--ccr-text)]"><DateTimeInline value={item.updatedAt} /></dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide">Expires</dt>
              <dd className="mt-0.5 text-[var(--ccr-text)]">
                {item.expiresAt ? <DateTimeInline value={item.expiresAt} /> : "Not set"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void patchQuote({ status: "SENT" })}
            disabled={saving || item.status === "SENT"}
            data-testid="quote-mark-sent"
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
          >
            Mark Sent
          </button>
          <button
            type="button"
            onClick={() => void patchQuote({ status: "ACCEPTED" })}
            disabled={saving || item.status === "ACCEPTED"}
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
          >
            Mark Accepted
          </button>
          <button
            type="button"
            onClick={() => void patchQuote({ status: "EXPIRED" })}
            disabled={saving || item.status === "EXPIRED"}
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
          >
            Mark Expired
          </button>
          <button
            type="button"
            onClick={() => void patchQuote({ status: "CANCELLED" })}
            disabled={saving || item.status === "CANCELLED"}
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
          >
            Mark Cancelled
          </button>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ccr-muted)]">Customer</h2>
          <p className="mt-3 text-lg font-semibold text-[var(--ccr-text)]">{item.customerFullName}</p>
          <p className="text-sm text-[var(--ccr-muted)]">{item.customerEmail}</p>
          <p className="text-sm text-[var(--ccr-muted)]">{item.customerPhone || "—"}</p>
        </div>

        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ccr-muted)]">Reservation</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--ccr-text)]">
            <InlineDateTimeRange startLabel={item.startAt} endLabel={item.endAt} />
          </div>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">Pickup: {item.pickupLocationText}</p>
          <p className="text-sm text-[var(--ccr-muted)]">Dropoff: {item.dropoffLocationText}</p>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ccr-muted)]">Vehicle</h2>
          <p className="mt-3 text-base font-semibold text-[var(--ccr-text)]">{item.vehicleLabel}</p>
          <p className="text-sm text-[var(--ccr-muted)]">Class: {item.vehicleClass || "—"}</p>
        </div>

        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ccr-muted)]">Pricing Snapshot</h2>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm text-[var(--ccr-muted)]">
            <div>
              <dt>Base</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(item.baseTotalCents)}</dd>
            </div>
            <div>
              <dt>Insurance</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(item.insuranceTotalCents)}</dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">-{formatJmd(item.discountTotalCents)}</dd>
            </div>
            <div>
              <dt>Subtotal</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(item.subtotalCents)}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(item.totalCents)}</dd>
            </div>
            <div>
              <dt>Deposit required</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(item.depositRequiredCents)}</dd>
            </div>
            <div>
              <dt>Amount due</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(item.amountDueCents)}</dd>
            </div>
            <div>
              <dt>Rack price</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(rackPrice)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-[var(--ccr-muted)]">Promo: {item.promoCode || "—"}</p>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ccr-muted)]">Meta</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs text-[var(--ccr-muted)]">
            Expires at
            <input
              type="datetime-local"
              value={expiresAtLocal}
              onChange={(event) => setExpiresAtLocal(event.target.value)}
              className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="text-xs text-[var(--ccr-muted)]">
            Rack price (JMD)
            <input
              type="number"
              min="0"
              step="1"
              value={rackPriceInput}
              onChange={(event) => setRackPriceInput(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="text-xs text-[var(--ccr-muted)] md:col-span-2">
            Tags
            <input
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="vip, airport"
            />
          </label>

          <label className="text-xs text-[var(--ccr-muted)] md:col-span-2">
            Comments
            <textarea
              rows={3}
              value={comments}
              onChange={(event) => setComments(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="text-xs text-[var(--ccr-muted)]">
            Commission partner
            <input
              value={commissionPartnerName}
              onChange={(event) => setCommissionPartnerName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="inline-flex items-center gap-2 text-xs text-[var(--ccr-muted)] md:items-end">
            <input
              type="checkbox"
              checked={clientPaysAtPartner}
              onChange={(event) => setClientPaysAtPartner(event.target.checked)}
              className="h-4 w-4"
            />
            Client pays at partner
          </label>
        </div>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              void patchQuote({
                expires_at: toIsoFromDateTimeLocal(expiresAtLocal),
                tags: parseTagsInput(tagsInput),
                comments: comments.trim() || null,
                commission_partner_name: commissionPartnerName.trim() || null,
                client_pays_at_partner: clientPaysAtPartner,
                rack_price_cents: rackPriceInput.trim() ? Number(rackPriceInput) : null,
              })
            }
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ccr-muted)]">Activity Log</h2>
        {eventRows.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ccr-muted)]">No events recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {eventRows.map((event) => {
              const metaText = formatQuoteActivityMeta(event.meta);
              const actorLabel = formatQuoteActivityActorLabel(event.eventType);
              return (
                <li key={event.id} className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--ccr-text)]">
                      {formatQuoteActivityTitle(event.eventType)}
                    </p>
                    <p className="text-xs text-[var(--ccr-muted)]">
                      <DateTimeInline value={event.createdAt} />
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                    {actorLabel} {event.actorEmail || "System"}
                  </p>
                  {metaText ? <p className="mt-1 text-xs text-[var(--ccr-muted)]">{metaText}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <QuoteEmailModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        onSent={() => {
          setEmailOpen(false);
          void loadQuote();
          router.refresh();
        }}
        target={{
          id: item.id,
          publicId: item.publicId,
          customerFullName: item.customerFullName,
          customerEmail: item.customerEmail,
          startAt: item.startAt,
          endAt: item.endAt,
          pickupLocationText: item.pickupLocationText,
          dropoffLocationText: item.dropoffLocationText,
          vehicleLabel: item.vehicleLabel,
          totalCents: item.totalCents,
          depositRequiredCents: item.depositRequiredCents,
          amountDueCents: item.amountDueCents,
          expiresAt: item.expiresAt,
        }}
      />
    </div>
  );
}
