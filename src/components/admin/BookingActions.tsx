"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { buttonStyles } from "@/components/ui/Button";
import { formatJmd } from "@/lib/money";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

const actionLabels = {
  confirm: "Confirm Booking",
  pickup: "Confirm Pickup",
  complete: "Complete Booking",
  deposit: "Pay Deposit",
  full: "Pay Balance",
  cancel: "Cancel Booking",
  archive: "Archive Booking",
} as const;

const BOOKING_ACTION_ERROR_AUTO_DISMISS_MS = 6000;

type ActionKey = keyof typeof actionLabels;

type BookingActionsProps = {
  bookingId: string;
  bookingPublicId?: string;
  bookingStatus?: string;
  isPaidInFull?: boolean;
  isDepositPaid?: boolean;
  isPickupInspectionComplete?: boolean;
  canAdmin?: boolean;
  vehicleId: string;
  vehicleLabel?: string;
  promoOptions: Array<{
    id: string;
    code: string;
    discountType: "PERCENT" | "FIXED";
    discountValue: number;
    startAt: string | null;
    endAt: string | null;
    maxRedemptions: number | null;
    redemptionCount: number;
    remainingRedemptions: number | null;
  }>;
  insuranceOption: {
    enabled: boolean;
    planId: string | null;
    pricePerDayCents: number;
  };
  initialPromoCode?: string | null;
  initialInsuranceSelected?: boolean;
  bookingChangesContent?: ReactNode;
  inspectionContent?: ReactNode;
};

export function BookingActions({
  bookingId,
  bookingPublicId,
  bookingStatus,
  isPaidInFull,
  isDepositPaid,
  isPickupInspectionComplete,
  canAdmin,
  vehicleId,
  vehicleLabel,
  promoOptions,
  insuranceOption,
  initialPromoCode,
  initialInsuranceSelected,
  bookingChangesContent,
  inspectionContent,
}: BookingActionsProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<ActionKey | null>(null);
  const [emailLoading, setEmailLoading] = useState<"booking_created" | "deposit_receipt" | null>(
    null,
  );
  const [pricingLoading, setPricingLoading] = useState<"promo" | "insurance" | null>(null);
  const [showPricingEmailAction, setShowPricingEmailAction] = useState(false);
  const [activePanel, setActivePanel] = useState<
    "booking" | "email" | "pricing" | "changes" | "inspection"
  >("booking");
  const [selectedPromoCode, setSelectedPromoCode] = useState<string>(initialPromoCode ?? "");
  const [appliedPromoCode, setAppliedPromoCode] = useState<string>(initialPromoCode ?? "");
  const [insuranceSelected, setInsuranceSelected] = useState<boolean>(initialInsuranceSelected === true);
  const normalizedStatus = bookingStatus?.trim().toUpperCase();
  const canConfirm = !normalizedStatus || ["PENDING_PAYMENT", "PENDING"].includes(normalizedStatus);
  const pickupRequiresConfirmedStatus = normalizedStatus !== "CONFIRMED";
  const pickupRequiresFullPayment = !isPaidInFull;
  const pickupRequiresInspection = !isPickupInspectionComplete;
  const canPickup =
    Boolean(normalizedStatus) &&
    normalizedStatus === "CONFIRMED" &&
    Boolean(isPaidInFull) &&
    Boolean(isPickupInspectionComplete);
  const canComplete = !normalizedStatus || ["CONFIRMED", "PICKED_UP"].includes(normalizedStatus);
  const canArchive = Boolean(canAdmin) && normalizedStatus === "RETURNED";
  const canCancel = !normalizedStatus || !["CANCELLED", "RETURNED"].includes(normalizedStatus);
  const actionButtonBaseClass = buttonStyles({
    variant: "secondary",
    size: "md",
    className: "w-full text-xs leading-tight lg:w-auto",
  });
  const emailButtonClass = buttonStyles({
    variant: "secondary",
    size: "sm",
    className: "w-full lg:w-auto",
  });
  const cancelButtonClass = canCancel
    ? buttonStyles({
        variant: "danger",
        size: "md",
        className: "w-full text-xs lg:w-auto",
      })
    : buttonStyles({
        variant: "secondary",
        size: "md",
        className: "w-full text-xs text-[var(--ccr-muted)] lg:w-auto",
      });
  const activeTabClass = buttonStyles({
    variant: "primary",
    size: "sm",
    className: "uppercase tracking-wide",
  });
  const inactiveTabClass = buttonStyles({
    variant: "outline",
    size: "sm",
    className: "uppercase tracking-wide text-[var(--ccr-muted)] hover:text-[var(--ccr-text)]",
  });
  const pickupDisabledReason = !canPickup
    ? pickupRequiresInspection
      ? "Complete the pickup inspection before confirming pickup."
      : pickupRequiresConfirmedStatus
        ? normalizedStatus === "PICKED_UP"
          ? "Pickup has already been confirmed."
          : "Confirm the booking before confirming pickup."
        : pickupRequiresFullPayment
          ? "Booking must be fully paid before pickup."
          : "Pickup cannot be confirmed yet."
    : null;

  useEffect(() => {
    if (!error) return undefined;

    const timeoutId = window.setTimeout(() => {
      setError((current) => (current === error ? null : current));
    }, BOOKING_ACTION_ERROR_AUTO_DISMISS_MS);

    return () => window.clearTimeout(timeoutId);
  }, [error]);

  async function runAction(actionKey: ActionKey) {
    setMessage(null);
    setError(null);
    setLoadingKey(actionKey);

    if (actionKey === "deposit" && (isDepositPaid || isPaidInFull)) {
      setError(isPaidInFull ? "Booking is already fully paid" : "Deposit is already recorded");
      setLoadingKey(null);
      return;
    }

    if (actionKey === "cancel" && !canCancel) {
      setError(
        normalizedStatus === "RETURNED"
          ? "Returned bookings cannot be cancelled"
          : "Booking is already cancelled",
      );
      setLoadingKey(null);
      return;
    }

    if (actionKey === "cancel") {
      const confirmed = window.confirm("Cancel this booking?");
      if (!confirmed) {
        setLoadingKey(null);
        return;
      }
    }

    if (actionKey === "full") {
      const target = bookingPublicId?.trim() || bookingId.slice(0, 8);
      const confirmed = window.confirm(
        `Record manual balance payment for booking ${target}? This action updates paid totals immediately.`,
      );
      if (!confirmed) {
        setLoadingKey(null);
        return;
      }
    }

    let archiveReason: string | null = null;
    if (actionKey === "archive") {
      const defaultReason =
        normalizedStatus === "RETURNED" ? "Completed/Returned" : "Manual archive";
      archiveReason = window.prompt("Archive reason (required):", defaultReason);
      if (archiveReason === null) {
        setLoadingKey(null);
        return;
      }
      if (!archiveReason.trim()) {
        setError("Archive reason is required.");
        setLoadingKey(null);
        return;
      }
    }

    const csrfToken = await ensureCsrfToken();
    const headers = {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken ?? "",
    };

    const response =
      actionKey === "confirm" ||
      actionKey === "pickup" ||
      actionKey === "complete" ||
      actionKey === "archive"
        ? await fetch(`/api/admin/bookings/${bookingId}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify(
              actionKey === "archive" ? { action: actionKey, reason: archiveReason } : { action: actionKey },
            ),
          })
        : await fetch(`/api/admin/bookings/${bookingId}/${actionKey === "full" ? "mark-fully-paid" : actionKey === "deposit" ? "mark-deposit-paid" : "cancel"}`, {
            method: "POST",
            headers,
          });

    const data = await response.json().catch(() => ({}));
    setLoadingKey(null);

    if (!response.ok) {
      const apiError = String(data.error ?? "Action failed");
      if (actionKey === "deposit" && apiError === "Booking cannot be confirmed") {
        setError("Deposit cannot be recorded for this booking.");
        return;
      }
      setError(apiError);
      return;
    }

    setMessage(data.message ?? "Action completed successfully.");
    router.refresh();
  }

  async function resendEmail(type: "booking_created" | "deposit_receipt") {
    setMessage(null);
    setError(null);
    setEmailLoading(type);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/bookings/${bookingId}/resend-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ type }),
    });

    setEmailLoading(null);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Email failed");
      return;
    }

    setMessage("Email sent successfully.");
  }

  async function applyPromoCode() {
    if (!selectedPromoCode.trim()) {
      setError("Select a promo code first.");
      return;
    }

    setMessage(null);
    setError(null);
    setPricingLoading("promo");

    const csrfToken = await ensureCsrfToken();
    const previewResponse = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        action: "apply_promo",
        code: selectedPromoCode.trim(),
        previewOnly: true,
      }),
    });
    const previewData = (await previewResponse.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      beforeSummary?: { total?: number; netPaidToDate?: number };
      summary?: { total?: number; balanceDue?: number; refundRequired?: boolean };
    };
    if (!previewResponse.ok || !previewData.ok) {
      setPricingLoading(null);
      setError(previewData.error ?? "Unable to preview promo code.");
      return;
    }

    const confirmed = window.confirm(
      [
        `Apply promo ${selectedPromoCode.trim().toUpperCase()}?`,
        `Current total: ${formatJmd(Number(previewData.beforeSummary?.total ?? 0))}`,
        `New total: ${formatJmd(Number(previewData.summary?.total ?? 0))}`,
        `Paid to date: ${formatJmd(Number(previewData.beforeSummary?.netPaidToDate ?? 0))}`,
        `New balance: ${formatJmd(Number(previewData.summary?.balanceDue ?? 0))}`,
        previewData.summary?.refundRequired
          ? "This change will mark the booking as refund required. No refund will be issued automatically."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (!confirmed) {
      setPricingLoading(null);
      return;
    }

    const response = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        action: "apply_promo",
        code: selectedPromoCode.trim(),
        confirmed: true,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      message?: string;
      summary?: { promoCode?: string | null };
    };
    setPricingLoading(null);

    if (!response.ok || !data.ok) {
      setError(data.error ?? "Unable to apply promo code.");
      return;
    }

    const normalizedCode = String(data.summary?.promoCode ?? selectedPromoCode).trim().toUpperCase();
    setAppliedPromoCode(normalizedCode);
    setSelectedPromoCode(normalizedCode);
    setMessage(data.message ?? `Promo ${normalizedCode} applied.`);
    setShowPricingEmailAction(true);
    router.refresh();
  }

  async function removePromoCode() {
    setMessage(null);
    setError(null);
    setPricingLoading("promo");

    const csrfToken = await ensureCsrfToken();
    const previewResponse = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ action: "remove_promo", previewOnly: true }),
    });
    const previewData = (await previewResponse.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      beforeSummary?: { total?: number; netPaidToDate?: number };
      summary?: { total?: number; balanceDue?: number; refundRequired?: boolean };
    };
    if (!previewResponse.ok || !previewData.ok) {
      setPricingLoading(null);
      setError(previewData.error ?? "Unable to preview promo removal.");
      return;
    }

    const confirmed = window.confirm(
      [
        `Remove promo ${appliedPromoCode}?`,
        `Current total: ${formatJmd(Number(previewData.beforeSummary?.total ?? 0))}`,
        `New total: ${formatJmd(Number(previewData.summary?.total ?? 0))}`,
        `Paid to date: ${formatJmd(Number(previewData.beforeSummary?.netPaidToDate ?? 0))}`,
        `New balance: ${formatJmd(Number(previewData.summary?.balanceDue ?? 0))}`,
        previewData.summary?.refundRequired
          ? "This change will mark the booking as refund required. No refund will be issued automatically."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (!confirmed) {
      setPricingLoading(null);
      return;
    }

    const response = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ action: "remove_promo", confirmed: true }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      message?: string;
    };
    setPricingLoading(null);

    if (!response.ok || !data.ok) {
      setError(data.error ?? "Unable to remove promo code.");
      return;
    }

    setAppliedPromoCode("");
    setSelectedPromoCode("");
    setMessage(data.message ?? "Promo removed.");
    setShowPricingEmailAction(true);
    router.refresh();
  }

  async function updateInsuranceSelection(enabled: boolean) {
    setMessage(null);
    setError(null);
    setPricingLoading("insurance");

    const csrfToken = await ensureCsrfToken();
    const requestBody = {
      action: "set_insurance",
      enabled,
      insurancePlanId: enabled ? insuranceOption.planId : null,
    };
    const previewResponse = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ ...requestBody, previewOnly: true }),
    });

    const previewData = (await previewResponse.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      beforeSummary?: {
        total?: number;
        netPaidToDate?: number;
        promoCode?: string | null;
      };
      summary?: {
        total?: number;
        balanceDue?: number;
        refundRequired?: boolean;
        promoCode?: string | null;
      };
    };

    if (!previewResponse.ok || !previewData.ok) {
      setPricingLoading(null);
      setError(previewData.error ?? "Unable to preview the insurance change.");
      return;
    }

    const previousPromo = previewData.beforeSummary?.promoCode ?? null;
    const nextPromo = previewData.summary?.promoCode ?? null;
    const promoChange =
      previousPromo !== nextPromo
        ? nextPromo
          ? `Promo will change from ${previousPromo ?? "none"} to ${nextPromo}.`
          : `Promo ${previousPromo ?? ""} will be removed because it is no longer valid.`
        : "";
    const confirmed = window.confirm(
      [
        enabled ? "Apply insurance to this booking?" : "Remove insurance from this booking?",
        `Current total: ${formatJmd(Number(previewData.beforeSummary?.total ?? 0))}`,
        `New total: ${formatJmd(Number(previewData.summary?.total ?? 0))}`,
        `Paid to date: ${formatJmd(Number(previewData.beforeSummary?.netPaidToDate ?? 0))}`,
        `New balance: ${formatJmd(Number(previewData.summary?.balanceDue ?? 0))}`,
        promoChange,
        previewData.summary?.refundRequired
          ? "This change will mark the booking as refund required. No refund will be issued automatically."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (!confirmed) {
      setPricingLoading(null);
      return;
    }

    const response = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ ...requestBody, confirmed: true }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      message?: string;
      summary?: { insuranceSelected?: boolean };
    };
    setPricingLoading(null);

    if (!response.ok || !data.ok) {
      setError(data.error ?? "Unable to update insurance.");
      return;
    }

    setInsuranceSelected(data.summary?.insuranceSelected === true);
    setMessage(data.message ?? (enabled ? "Insurance applied." : "Insurance removed."));
    setShowPricingEmailAction(true);
    router.refresh();
  }

  function formatPromoOptionLabel(option: BookingActionsProps["promoOptions"][number]) {
    const discountLabel =
      option.discountType === "PERCENT"
        ? `${option.discountValue}%`
        : formatJmd(Math.max(0, Number(option.discountValue ?? 0)));
    const redemptionsLabel =
      option.remainingRedemptions === null
        ? "unlimited"
        : `${option.remainingRedemptions} left`;
    return `${option.code} (${discountLabel}, ${redemptionsLabel})`;
  }

  return (
    <div data-testid="booking-actions-panel" className="flex flex-col gap-4">
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="booking-actions-tab-booking"
          onClick={() => setActivePanel("booking")}
          className={activePanel === "booking" ? activeTabClass : inactiveTabClass}
          aria-pressed={activePanel === "booking"}
        >
          Booking Actions
        </button>
        <button
          type="button"
          data-testid="booking-actions-tab-email"
          onClick={() => setActivePanel("email")}
          className={activePanel === "email" ? activeTabClass : inactiveTabClass}
          aria-pressed={activePanel === "email"}
        >
          Email Actions
        </button>
        <button
          type="button"
          data-testid="booking-actions-tab-pricing"
          onClick={() => setActivePanel("pricing")}
          className={activePanel === "pricing" ? activeTabClass : inactiveTabClass}
          aria-pressed={activePanel === "pricing"}
        >
          Pricing Actions
        </button>
        {bookingChangesContent ? (
          <button
            type="button"
            data-testid="booking-actions-tab-changes"
            onClick={() => setActivePanel("changes")}
            className={activePanel === "changes" ? activeTabClass : inactiveTabClass}
            aria-pressed={activePanel === "changes"}
          >
            Booking Changes
          </button>
        ) : null}
        {inspectionContent ? (
          <button
            type="button"
            data-testid="booking-actions-tab-inspection"
            onClick={() => setActivePanel("inspection")}
            className={activePanel === "inspection" ? activeTabClass : inactiveTabClass}
            aria-pressed={activePanel === "inspection"}
          >
            Vehicle Inspection
          </button>
        ) : null}
      </div>

      {activePanel === "changes" && bookingChangesContent ? (
        <div>{bookingChangesContent}</div>
      ) : activePanel === "inspection" && inspectionContent ? (
        <div>{inspectionContent}</div>
      ) : (
        <div
          data-testid={`booking-actions-panel-${activePanel}`}
          className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3"
        >
          {activePanel === "booking" ? (
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:flex lg:flex-wrap lg:items-center">
              <button
                type="button"
                data-testid="booking-action-confirm"
                onClick={() => runAction("confirm")}
                disabled={loadingKey === "confirm" || !canConfirm}
                className={actionButtonBaseClass}
              >
                {loadingKey === "confirm" ? "Working..." : actionLabels.confirm}
              </button>
              <button
                type="button"
                data-testid="booking-action-pickup"
                onClick={() => runAction("pickup")}
                disabled={loadingKey === "pickup" || !canPickup}
                title={pickupDisabledReason ?? undefined}
                className={actionButtonBaseClass}
              >
                {loadingKey === "pickup" ? "Working..." : actionLabels.pickup}
              </button>
              {pickupDisabledReason ? (
                <p className="col-span-2 -mt-1 text-xs text-[var(--ccr-muted)] lg:w-full">
                  {pickupDisabledReason}
                </p>
              ) : null}
              <button
                type="button"
                data-testid="booking-action-complete"
                onClick={() => runAction("complete")}
                disabled={loadingKey === "complete" || !canComplete}
                className={actionButtonBaseClass}
              >
                {loadingKey === "complete" ? "Working..." : actionLabels.complete}
              </button>
              <button
                type="button"
                data-testid="booking-action-deposit"
                onClick={() => runAction("deposit")}
                disabled={loadingKey === "deposit" || Boolean(isDepositPaid) || Boolean(isPaidInFull)}
                title={
                  isPaidInFull ? "Already fully paid" : isDepositPaid ? "Deposit already recorded" : undefined
                }
                className={actionButtonBaseClass}
              >
                {loadingKey === "deposit" ? "Working..." : actionLabels.deposit}
              </button>
              <button
                type="button"
                data-testid="booking-action-full"
                onClick={() => runAction("full")}
                disabled={loadingKey === "full" || Boolean(isPaidInFull)}
                title={isPaidInFull ? "Already fully paid" : undefined}
                className={actionButtonBaseClass}
              >
                {loadingKey === "full" ? "Working..." : actionLabels.full}
              </button>
              <button
                type="button"
                data-testid="booking-action-cancel"
                onClick={() => runAction("cancel")}
                disabled={loadingKey === "cancel" || !canCancel}
                title={
                  !canCancel
                    ? normalizedStatus === "RETURNED"
                      ? "Returned bookings cannot be cancelled"
                      : "Already cancelled"
                    : undefined
                }
                className={cancelButtonClass}
              >
                {loadingKey === "cancel" ? "Working..." : actionLabels.cancel}
              </button>
              {canArchive ? (
                <button
                  type="button"
                  data-testid="booking-action-archive"
                  onClick={() => runAction("archive")}
                  disabled={loadingKey === "archive"}
                  className={actionButtonBaseClass}
                >
                  {loadingKey === "archive" ? "Working..." : actionLabels.archive}
                </button>
              ) : null}
            </div>
          ) : activePanel === "email" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:flex lg:flex-wrap lg:items-center">
              <button
                type="button"
                onClick={() => resendEmail("booking_created")}
                disabled={emailLoading === "booking_created"}
                className={emailButtonClass}
              >
                {emailLoading === "booking_created" ? "Sending..." : "Resend booking email"}
              </button>
              <button
                type="button"
                onClick={() => resendEmail("deposit_receipt")}
                disabled={emailLoading === "deposit_receipt"}
                className={emailButtonClass}
              >
                {emailLoading === "deposit_receipt" ? "Sending..." : "Resend deposit receipt"}
              </button>
              <Link href={`/api/admin/bookings/${bookingId}/invoice-payload`} className={emailButtonClass}>
                Invoice payload
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Apply Promo</p>
                <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                  Select an existing promo code and apply it to this booking.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={selectedPromoCode}
                    onChange={(event) => setSelectedPromoCode(event.target.value)}
                    className="min-w-[260px] rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  >
                    <option value="">Select promo code…</option>
                    {promoOptions.map((promo) => (
                      <option key={promo.id} value={promo.code}>
                        {formatPromoOptionLabel(promo)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={applyPromoCode}
                    disabled={pricingLoading === "promo" || promoOptions.length === 0}
                    className={emailButtonClass}
                  >
                    {pricingLoading === "promo" ? "Applying..." : "Apply Promo"}
                  </button>
                  <button
                    type="button"
                    onClick={removePromoCode}
                    disabled={pricingLoading === "promo" || !appliedPromoCode}
                    className={emailButtonClass}
                  >
                    {pricingLoading === "promo" ? "Removing..." : "Remove Promo"}
                  </button>
                </div>
                {promoOptions.length === 0 ? (
                  <p className="mt-2 text-xs text-[var(--ccr-muted)]">No promo codes configured yet.</p>
                ) : null}
                <p className="mt-2 text-xs text-[var(--ccr-muted)]">
                  Active on booking:{" "}
                  <span className="font-semibold text-[var(--ccr-text)]">
                    {appliedPromoCode || "None"}
                  </span>
                </p>
              </div>

              <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Apply Insurance</p>
                <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                  Vehicle:{" "}
                  <span className="font-semibold text-[var(--ccr-text)]">
                    {vehicleLabel || vehicleId}
                  </span>
                </p>
                <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                  System insurance rate/day:{" "}
                  <span className="font-semibold text-[var(--ccr-text)]">
                    {insuranceOption.enabled ? formatJmd(insuranceOption.pricePerDayCents) : "Not configured"}
                  </span>
                </p>
                <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                  Current booking insurance:{" "}
                  <span className="font-semibold text-[var(--ccr-text)]">
                    {insuranceSelected ? "Applied" : "Not applied"}
                  </span>
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateInsuranceSelection(true)}
                    disabled={pricingLoading === "insurance" || !insuranceOption.enabled || insuranceSelected}
                    className={emailButtonClass}
                  >
                    {pricingLoading === "insurance" ? "Applying..." : "Apply Insurance"}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateInsuranceSelection(false)}
                    disabled={pricingLoading === "insurance" || !insuranceSelected}
                    className={emailButtonClass}
                  >
                    {pricingLoading === "insurance" ? "Removing..." : "Remove Insurance"}
                  </button>
                </div>
                {!insuranceOption.enabled ? (
                  <p className="mt-2 text-xs text-[var(--ccr-muted)]">
                    No enabled insurance plan exists for this vehicle/global configuration.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}

      {message ? (
        <div className="flex flex-wrap items-center gap-2">
          <p data-testid="booking-actions-message" className="text-xs font-semibold text-[var(--ccr-text)]">
            {message}
          </p>
          {showPricingEmailAction ? (
            <button
              type="button"
              onClick={() => resendEmail("booking_created")}
              disabled={emailLoading === "booking_created"}
              className={emailButtonClass}
            >
              {emailLoading === "booking_created" ? "Sending..." : "Resend updated booking email"}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p data-testid="booking-actions-error" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
