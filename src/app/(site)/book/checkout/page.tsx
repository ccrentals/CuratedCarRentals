"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { clearBookingDraft } from "@/lib/bookings/draft";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type CheckoutOption = "DEPOSIT" | "FULL" | "CUSTOM" | "BALANCE";

type PaymentStartResponse = {
  ok?: boolean;
  error?: string;
  redirectUrl?: string;
};

export const dynamic = "force-dynamic";

const WIZARD_DRAFT_STORAGE_KEY = "ccr_booking_wizard_draft_v1";

function normalizeText(value: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCheckoutOption(value: string): CheckoutOption | null {
  if (value === "DEPOSIT" || value === "FULL" || value === "CUSTOM" || value === "BALANCE") {
    return value;
  }
  return null;
}

function endpointForOption(option: CheckoutOption) {
  if (option === "FULL") return "/api/payments/wipay/full/start";
  if (option === "CUSTOM") return "/api/payments/wipay/custom/start";
  if (option === "BALANCE") return "/api/payments/wipay/balance/start";
  return "/api/payments/wipay/start";
}

function BookingCheckoutContent() {
  const searchParams = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const checkoutStartedKeyRef = useRef<string | null>(null);

  const bookingId = normalizeText(searchParams.get("bookingId"));
  const option = useMemo(
    () => parseCheckoutOption(normalizeText(searchParams.get("paymentOption")).toUpperCase()),
    [searchParams],
  );
  const customAmountCents = useMemo(() => {
    const value = normalizeText(searchParams.get("customAmountCents"));
    if (!value) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(1, Math.round(parsed));
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    const checkoutKey = [bookingId, option ?? "", customAmountCents ?? ""].join(":");

    if (checkoutStartedKeyRef.current === checkoutKey) {
      return () => {
        cancelled = true;
      };
    }
    checkoutStartedKeyRef.current = checkoutKey;

    async function startCheckout() {
      if (!bookingId) {
        setErrorMessage("Missing booking reference. Return to Step 6 and try again.");
        setStarting(false);
        return;
      }

      if (!option) {
        setErrorMessage("Missing payment option. Return to Step 6 and try again.");
        setStarting(false);
        return;
      }

      if (option === "CUSTOM" && !customAmountCents) {
        setErrorMessage("Custom payment amount is missing. Return to Step 6 and try again.");
        setStarting(false);
        return;
      }

      try {
        const csrfToken = await ensureCsrfToken();
        if (!csrfToken) {
          throw new Error("Unable to verify your session. Refresh and try again.");
        }

        const payload =
          option === "CUSTOM"
            ? { bookingId, customAmountCents: customAmountCents ?? 1 }
            : { bookingId };

        const response = await fetch(endpointForOption(option), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify(payload),
        });

        const data = (await response.json().catch(() => ({}))) as PaymentStartResponse;
        if (!response.ok || !data.redirectUrl) {
          throw new Error(data.error ?? "Unable to start WiPay checkout.");
        }

        clearBookingDraft({ keys: [WIZARD_DRAFT_STORAGE_KEY] });
        window.location.assign(data.redirectUrl);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof Error && error.message
            ? error.message
            : "Unable to start WiPay checkout.",
        );
        setStarting(false);
      }
    }

    void startCheckout();

    return () => {
      cancelled = true;
    };
  }, [bookingId, customAmountCents, option]);

  return (
    <div className="min-h-screen bg-[var(--ccr-bg)] py-10">
      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-lg md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ccr-muted)]">
            Reservation Wizard
          </p>
          <h1 className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">Step 7: WiPay Checkout</h1>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            We are preparing your secure hosted checkout.
          </p>

          {!errorMessage ? (
            <div className="mt-5 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3 text-sm text-[var(--ccr-text)]">
              {starting ? "Starting WiPay checkout..." : "Redirecting..."}
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-[var(--ccr-clerk-danger-border)] bg-[var(--ccr-clerk-danger-bg)] px-4 py-3 text-sm text-[var(--ccr-clerk-danger-text)]">
              {errorMessage}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={bookingId ? `/bookings/${encodeURIComponent(bookingId)}/pay` : "/book"}
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
            >
              Back to Payments
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BookingCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <BookingCheckoutContent />
    </Suspense>
  );
}
