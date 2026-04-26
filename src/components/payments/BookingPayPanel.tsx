"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { DateRangeArrow } from "@/components/shared/DateRangeArrow";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { formatJmd } from "@/lib/money";
import { PayBalanceButton } from "@/components/payments/PayBalanceButton";
import { PayDepositButton } from "@/components/payments/PayDepositButton";
import { PayInFullButton } from "@/components/payments/PayInFullButton";
import { PayOnPickupButton } from "@/components/payments/PayOnPickupButton";

type BookingPaySummary = {
  days: number;
  subtotal: number;
  total: number;
  deposit: number;
  netPaidToDate: number;
  balanceDue: number;
  promoCode: string | null;
  promoDiscount: number;
  paymentStatus: "UNPAID" | "DUE_ON_PICKUP" | "DEPOSIT_PAID" | "PAID_IN_FULL";
  paymentOption: "DEPOSIT" | "FULL" | "CUSTOM" | "NONE";
};

type PromoResponse = {
  ok?: boolean;
  error?: string;
  summary?: BookingPaySummary;
  promo?: {
    code?: string;
    discountAmountCents?: number;
  };
};

export function BookingPayPanel({
  bookingId,
  vehicleLabel,
  startDateLabel,
  endDateLabel,
  initialSummary,
}: {
  bookingId: string;
  vehicleLabel: string;
  startDateLabel: string;
  endDateLabel: string;
  initialSummary: BookingPaySummary;
}) {
  const [summary, setSummary] = useState<BookingPaySummary>(initialSummary);
  const [promoInput, setPromoInput] = useState(initialSummary.promoCode ?? "");
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);

  const { depositDue, canPayBalance, canPayInFullFromZero } = useMemo(() => {
    const due = Math.max(0, summary.deposit - summary.netPaidToDate);
    return {
      depositDue: due,
      canPayBalance: summary.netPaidToDate > 0 && summary.balanceDue > 0,
      canPayInFullFromZero: summary.netPaidToDate <= 0,
    };
  }, [summary.balanceDue, summary.deposit, summary.netPaidToDate]);

  async function applyPromo() {
    if (promoBusy) return;
    setPromoBusy(true);
    setPromoError(null);
    setPromoMessage(null);

    const code = promoInput.trim().toUpperCase();
    if (!code) {
      setPromoBusy(false);
      setPromoError("Enter a promo code.");
      return;
    }

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/public/bookings/${bookingId}/promo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ code }),
    });
    const data = (await response.json().catch(() => ({}))) as PromoResponse;
    setPromoBusy(false);

    if (!response.ok || !data.ok || !data.summary) {
      setPromoError(data.error ?? "Promo code could not be applied.");
      return;
    }

    setSummary(data.summary);
    setPromoInput(data.summary.promoCode ?? code);
    const displayCode = data.promo?.code ?? data.summary.promoCode ?? code;
    setPromoMessage(`Promo "${displayCode}" applied.`);
  }

  async function removePromo() {
    if (promoBusy) return;
    setPromoBusy(true);
    setPromoError(null);
    setPromoMessage(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/public/bookings/${bookingId}/promo`, {
      method: "DELETE",
      headers: {
        "x-csrf-token": csrfToken ?? "",
      },
    });
    const data = (await response.json().catch(() => ({}))) as PromoResponse;
    setPromoBusy(false);

    if (!response.ok || !data.ok || !data.summary) {
      setPromoError(data.error ?? "Promo code could not be removed.");
      return;
    }

    setSummary(data.summary);
    setPromoInput("");
    setPromoMessage("Promo removed.");
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Pay Online</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          Final payment step. Apply promo codes here before you continue to payment.
        </p>
        <div className="mt-4 rounded-xl border border-amber-300/40 bg-amber-200/15 p-4 text-sm text-amber-100">
          <p className="font-semibold">Deposit required to guarantee availability</p>
          <p className="mt-1 text-amber-100/90">
            Please note vehicle availability is not guaranteed without payment. To guarantee
            availability a deposit is required.
          </p>
        </div>
        {summary.paymentOption === "NONE" ? (
          <div className="mt-4 rounded-xl border border-red-300/40 bg-red-500/15 p-4 text-sm text-red-100">
            <p className="font-semibold">Pay on Pickup selected</p>
            <p className="mt-1 text-red-100/90">
              Please note vehicle availability is not guaranteed without payment. To guarantee
              availability a deposit is required.
            </p>
          </div>
        ) : null}

        <div className="mt-4 space-y-2 text-sm text-[var(--ccr-muted)]">
          <p>
            Vehicle: <span className="font-semibold text-[var(--ccr-text)]">{vehicleLabel}</span>
          </p>
          <p>
            Dates:{" "}
            <span className="inline-flex items-center font-semibold text-[var(--ccr-text)]">
              {startDateLabel}
              <DateRangeArrow />
              {endDateLabel}
            </span>
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Promo code</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="text"
              value={promoInput}
              onChange={(event) => setPromoInput(event.target.value.toUpperCase())}
              placeholder="Enter promo code"
              className="min-w-[220px] flex-1 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
            <button
              type="button"
              onClick={applyPromo}
              disabled={promoBusy}
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] disabled:opacity-60"
            >
              {promoBusy ? "Applying..." : "Apply"}
            </button>
            {summary.promoCode ? (
              <button
                type="button"
                onClick={removePromo}
                disabled={promoBusy}
                className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] disabled:opacity-60"
              >
                Remove
              </button>
            ) : null}
          </div>
          {promoMessage ? <p className="mt-2 text-sm text-[var(--ccr-text)]">{promoMessage}</p> : null}
          {promoError ? <p className="mt-2 text-sm text-red-600">{promoError}</p> : null}
        </div>

        <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Pricing Summary</h3>
          <div className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div className="flex items-start justify-between gap-4 text-[var(--ccr-text)]">
              <span className="text-[var(--ccr-muted)]">Confirmed booked days</span>
              <span className="text-right font-semibold">{summary.days}</span>
            </div>
            <div className="flex items-start justify-between gap-4 text-[var(--ccr-text)]">
              <span className="text-[var(--ccr-muted)]">Subtotal</span>
              <span className="text-right font-semibold">{formatJmd(summary.subtotal)}</span>
            </div>
            <div className="flex items-start justify-between gap-4 text-[var(--ccr-text)]">
              <span className="text-[var(--ccr-muted)]">
                Promo{summary.promoCode ? ` (${summary.promoCode})` : ""}
              </span>
              <span className="text-right font-semibold">-{formatJmd(summary.promoDiscount)}</span>
            </div>
            <div className="flex items-start justify-between gap-4 text-[var(--ccr-text)]">
              <span className="text-[var(--ccr-muted)]">Total you will pay</span>
              <span className="text-right font-semibold">{formatJmd(summary.total)}</span>
            </div>
            <div className="flex items-start justify-between gap-4 text-[var(--ccr-text)]">
              <span className="text-[var(--ccr-muted)]">Deposit online</span>
              <span className="text-right font-semibold">{formatJmd(summary.deposit)}</span>
            </div>
            <div className="flex items-start justify-between gap-4 text-[var(--ccr-text)]">
              <span className="text-[var(--ccr-muted)]">Paid to date</span>
              <span className="text-right font-semibold">{formatJmd(summary.netPaidToDate)}</span>
            </div>
            <div className="flex items-start justify-between gap-4 text-[var(--ccr-text)] sm:col-start-2">
              <span className="text-[var(--ccr-muted)]">Balance due</span>
              <span className="text-right font-semibold">{formatJmd(summary.balanceDue)}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex h-full flex-col rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">Pay Deposit</p>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">
              {depositDue > 0
                ? `Pay ${formatJmd(depositDue)} now to confirm. Remaining balance ${formatJmd(
                    Math.max(0, summary.balanceDue - depositDue),
                  )} due on pickup.`
                : "Deposit is already paid."}
            </p>
            <div className="mt-auto pt-3">
              {depositDue > 0 ? (
                <PayDepositButton bookingId={bookingId} />
              ) : (
                <span className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]">
                  Deposit paid
                </span>
              )}
            </div>
          </div>

          <div className="flex h-full flex-col rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">Pay on Pickup</p>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">
              Pay {formatJmd(0)} now. Total of {formatJmd(summary.total)} due on pickup.
            </p>
            <div className="mt-2 rounded-lg border border-amber-300/40 bg-amber-200/15 p-3 text-xs text-amber-100">
              Please note vehicle availability is not guaranteed without payment. To guarantee availability a deposit is required.
            </div>
            <div className="mt-auto pt-3">
              {summary.netPaidToDate > 0 ? (
                <span className="inline-flex items-center whitespace-nowrap rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]">
                  Payment already started
                </span>
              ) : summary.paymentOption === "NONE" && summary.paymentStatus === "DUE_ON_PICKUP" ? (
                <span className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]">
                  Selected
                </span>
              ) : (
                <PayOnPickupButton bookingId={bookingId} />
              )}
            </div>
          </div>

          <div className="flex h-full flex-col rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">
              {canPayBalance ? "Pay Balance" : "Pay in Full"}
            </p>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">
              {summary.balanceDue <= 0
                ? "This booking is already fully paid."
                : canPayBalance
                  ? `Pay the remaining balance of ${formatJmd(summary.balanceDue)} now.`
                  : `Pay ${formatJmd(summary.total)} now. Balance due becomes ${formatJmd(0)}.`}
            </p>
            <div className="mt-auto pt-3">
              {summary.balanceDue <= 0 ? (
                <span className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]">
                  Paid in full
                </span>
              ) : canPayBalance ? (
                <PayBalanceButton bookingId={bookingId} />
              ) : canPayInFullFromZero ? (
                <PayInFullButton bookingId={bookingId} />
              ) : (
                <span className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]">
                  Use Pay Balance
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <Link
            href={`/bookings/${bookingId}`}
            className="inline-flex rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
          >
            Back to Booking
          </Link>
        </div>
      </div>
    </div>
  );
}
