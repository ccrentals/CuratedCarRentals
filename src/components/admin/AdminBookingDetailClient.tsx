"use client";

import Link from "next/link";
import { UserRoundPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { BookingActions } from "@/components/admin/BookingActions";
import { BookingNotes } from "@/components/admin/BookingNotes";
import { BookingUpdateForm } from "@/components/admin/BookingUpdateForm";
import { BookingVehicleInspectionPanel } from "@/components/admin/BookingVehicleInspectionPanel";
import { InfoTooltipIcon } from "@/components/admin/InfoTooltipIcon";
import { CustomerLegalIdImagesManager } from "@/components/admin/CustomerLegalIdImagesManager";
import { ManualPaymentForm } from "@/components/admin/ManualPaymentForm";
import { PaymentRowActions } from "@/components/admin/PaymentRowActions";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { buttonStyles } from "@/components/ui/Button";
import { formatJmd } from "@/lib/money";
import { formatPaymentStatus } from "@/lib/payments/formatPaymentStatus";
import { refundRequiredStyles } from "@/lib/refundRequiredStyles";
import type {
  AdminBookingDetailViewModel,
  AdminBookingPaymentRow,
} from "@/lib/bookings/adminBookingDetailView";
import type { CustomerPrivateFileItem } from "@/lib/customers/privateFiles";
import type { LoadedBookingVehicleInspections } from "@/lib/bookings/vehicleInspectionShared";
import type { MediaAuditActivity } from "@/lib/uploads/mediaAudit";

type AdminBookingActionPromoOption = {
  id: string;
  code: string;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  startAt: string | null;
  endAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  remainingRedemptions: number | null;
};

type AdminBookingActionInsuranceOption = {
  enabled: boolean;
  planId: string | null;
  pricePerDayCents: number;
};

type AdminBookingDetailClientProps = {
  initialDetail: AdminBookingDetailViewModel;
  customerId: string;
  customerIdImages: CustomerPrivateFileItem[];
  canAdmin: boolean;
  requireRestoreReason: boolean;
  promoOptions: AdminBookingActionPromoOption[];
  insuranceOption: AdminBookingActionInsuranceOption;
  inspection?: {
    inspections: LoadedBookingVehicleInspections;
    mediaActivities?: MediaAuditActivity[];
    tablesUnavailable?: boolean;
    canCorrectOdometer?: boolean;
  };
  payments: AdminBookingPaymentRow[];
  refundedOriginalIds: string[];
  children?: ReactNode;
};

function statusBadge(status: string) {
  const normalized = status.toUpperCase();
  const styles: Record<string, string> = {
    PENDING_PAYMENT:
      "border border-[var(--ccr-status-accent-border)] bg-[var(--ccr-status-accent-bg)] text-[var(--ccr-status-accent-text)]",
    BOOKED:
      "border border-[var(--ccr-status-accent-border)] bg-[var(--ccr-status-accent-bg)] text-[var(--ccr-status-accent-text)]",
    CONFIRMED:
      "border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]",
    PICKED_UP:
      "border border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]",
    RETURNED:
      "border border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]",
    CANCELLED:
      "border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] text-[var(--ccr-status-danger-text)]",
  };

  return (
    styles[normalized] ??
    "border border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]"
  );
}

function splitLocationDetailLine(line: string) {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) {
    return { label: null, value: line };
  }

  const label = line.slice(0, separatorIndex).trim();
  const value = line.slice(separatorIndex + 1).trim();
  return {
    label: label || null,
    value: value || line,
  };
}

function StructuredLocationSide({
  title,
  locationLabel,
  lines,
}: {
  title: string;
  locationLabel: string;
  lines: string[];
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">{title}</p>
      <p className="mt-2 font-semibold text-[var(--ccr-text)]">{locationLabel}</p>
      {lines.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {lines.map((line) => {
            const detailLine = splitLocationDetailLine(line);

            return (
              <div key={`${title}-${line}`} className="min-w-0 rounded-lg bg-[var(--ccr-bg)] px-3 py-2">
                {detailLine.label ? (
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    {detailLine.label}
                  </p>
                ) : null}
                <p className="mt-1 break-words font-semibold text-[var(--ccr-text)]">
                  {detailLine.value}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AdminBookingDetailClient({
  initialDetail,
  customerId,
  customerIdImages,
  canAdmin,
  requireRestoreReason,
  promoOptions,
  insuranceOption,
  inspection,
  payments,
  refundedOriginalIds,
  children,
}: AdminBookingDetailClientProps) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);

  useEffect(() => {
    setDetail(initialDetail);
  }, [initialDetail]);

  return (
    <>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Booking</span>
          <span
            data-testid="booking-public-id"
            className="font-mono text-lg font-bold leading-none text-[var(--ccr-text)] md:text-xl"
          >
            {detail.bookingPublicId}
          </span>
          <span
            data-testid="booking-status-badge"
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusBadge(
              detail.displayStatus,
            )}`}
          >
            {detail.displayStatus.replace(/_/g, " ")}
          </span>
          <span
            data-testid="booking-pickup-type-badge"
            className="inline-flex items-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]"
          >
            Pickup: {detail.pickupLocationBadge}
          </span>
          <span
            data-testid="booking-dropoff-type-badge"
            className="inline-flex items-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]"
          >
            Dropoff: {detail.dropoffLocationBadge}
          </span>
          {detail.isNonBlocking ? <InfoTooltipIcon message="UNPAID - Not holding vehicle" /> : null}
          {detail.isOverridden ? (
            <span className="inline-flex items-center rounded-full border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-status-danger-text)]">
              OVERRIDDEN
            </span>
          ) : null}
        </div>

        <div className="w-full pt-1">
          <BookingActions
            key={detail.versionKey}
            bookingId={detail.bookingId}
            bookingPublicId={detail.bookingPublicId}
            bookingStatus={detail.bookingStatus}
            isPaidInFull={detail.isPaidInFull}
            isDepositPaid={detail.isDepositPaid}
            isPickupInspectionComplete={detail.isPickupInspectionComplete}
            isReturnInspectionComplete={detail.isReturnInspectionComplete}
            canAdmin={canAdmin}
            vehicleId={detail.vehicleId}
            vehicleLabel={detail.vehicleLabel}
            promoOptions={promoOptions}
            insuranceOption={insuranceOption}
            initialPromoCode={detail.initialPromoCode}
            initialInsuranceSelected={detail.initialInsuranceSelected}
            bookingChangesContent={
              <BookingUpdateForm
                bookingId={detail.bookingId}
                startDate={detail.form.startDate}
                endDate={detail.form.endDate}
                pickupTime={detail.form.pickupTime}
                dropoffTime={detail.form.dropoffTime}
                customerName={detail.form.customerName}
                customerEmail={detail.form.customerEmail}
                customerPhone={detail.form.customerPhone}
                pickupLocationTypeKey={detail.form.pickupLocationTypeKey}
                dropoffLocationTypeKey={detail.form.dropoffLocationTypeKey}
                pickupLocationValues={detail.form.pickupLocationValues}
                dropoffLocationValues={detail.form.dropoffLocationValues}
                disabled={detail.form.disabled}
                onBookingUpdated={setDetail}
              />
            }
            inspectionContent={
              inspection ? (
                <BookingVehicleInspectionPanel
                  bookingId={detail.bookingId}
                  bookingStatus={detail.bookingStatus}
                  bookingPublicId={detail.bookingPublicId}
                  inspections={inspection.inspections}
                  mediaActivities={inspection.mediaActivities}
                  tablesUnavailable={inspection.tablesUnavailable}
                  canCorrectOdometer={inspection.canCorrectOdometer}
                  isPaidInFull={detail.isPaidInFull}
                  onInspectionCompleted={(inspectionType) => {
                    setDetail((current) => ({
                      ...current,
                      isPickupInspectionComplete:
                        inspectionType === "PICKUP"
                          ? true
                          : current.isPickupInspectionComplete,
                      isReturnInspectionComplete:
                        inspectionType === "RETURN"
                          ? true
                          : current.isReturnInspectionComplete,
                    }));
                  }}
                  onBookingLifecycleCompleted={(action) => {
                    setDetail((current) => ({
                      ...current,
                      bookingStatus: action === "pickup" ? "PICKED_UP" : "RETURNED",
                      displayStatus: action === "pickup" ? "PICKED_UP" : "RETURNED",
                      form: {
                        ...current.form,
                        disabled: action === "complete" ? true : current.form.disabled,
                      },
                    }));
                    router.refresh();
                  }}
                />
              ) : undefined
            }
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Booking Details</h2>
          <dl className="mt-4 grid gap-6 text-sm text-[var(--ccr-muted)] md:grid-cols-2">
            <div className="space-y-3">
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Status</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">{detail.displayStatus.replace(/_/g, " ")}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Entitlement</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">{detail.bookingDetails.entitlement}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Payment Option</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">
                  {detail.bookingDetails.paymentOptionLabel}
                </dd>
              </div>
              {detail.bookingDetails.customPaymentAmountCents !== null ? (
                <div className="min-w-0">
                  <dt className="text-xs uppercase tracking-wide">Custom Amount</dt>
                  <dd className="font-semibold text-[var(--ccr-text)]">
                    {formatJmd(detail.bookingDetails.customPaymentAmountCents)}
                  </dd>
                </div>
              ) : null}
              {detail.bookingDetails.cancellationReason ? (
                <div className="min-w-0">
                  <dt className="text-xs uppercase tracking-wide">Cancellation Reason</dt>
                  <dd className="font-semibold text-[var(--ccr-text)]">
                    {detail.bookingDetails.cancellationReason}
                  </dd>
                </div>
              ) : null}
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Vehicle</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">{detail.bookingDetails.vehicleLabel}</dd>
              </div>
            </div>

            <div className="space-y-3">
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Pickup Date & Time</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">
                  <DateTimeInline value={detail.bookingDetails.pickupDateTimeLabel} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Dropoff Date & Time</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">
                  <DateTimeInline value={detail.bookingDetails.dropoffDateTimeLabel} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Pickup Location Snapshot</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">
                  {detail.bookingDetails.pickupLocationSnapshot}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Dropoff Location Snapshot</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">
                  {detail.bookingDetails.dropoffLocationSnapshot}
                </dd>
              </div>
            </div>
            <div className="min-w-0 md:col-span-2">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] transition-colors hover:text-[var(--ccr-text)] [&::-webkit-details-marker]:hidden">
                  <span>Structured Location Details</span>
                  <span
                    aria-hidden="true"
                    className="text-base leading-none text-[var(--ccr-accent)] transition-transform group-open:rotate-180"
                  >
                    ^
                  </span>
                </summary>
                <dd
                  data-testid="booking-location-details-block"
                  className="mt-2 grid gap-4 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-4 md:grid-cols-2"
                >
                  <StructuredLocationSide
                    title="Pickup"
                    locationLabel={detail.bookingDetails.pickupLocationLabel}
                    lines={detail.bookingDetails.pickupLocationLines}
                  />
                  <StructuredLocationSide
                    title="Dropoff"
                    locationLabel={detail.bookingDetails.dropoffLocationLabel}
                    lines={detail.bookingDetails.dropoffLocationLines}
                  />
                </dd>
              </details>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Customer & Vehicle</h2>
            <Link
              href={`/admin/customers/${customerId}`}
              className={buttonStyles({
                variant: "secondary",
                size: "xs",
                className: "gap-2",
              })}
            >
              <UserRoundPen aria-hidden="true" className="h-4 w-4" />
              Update customer
            </Link>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="text-xs font-bold uppercase text-[var(--ccr-text)]">Customer</p>
              <p className="font-normal text-[var(--ccr-muted)]">{detail.customer.name}</p>
              <p className="text-[var(--ccr-muted)]">{detail.customer.email}</p>
              <p className="text-[var(--ccr-muted)]">{detail.customer.phone}</p>
              <p className="mt-2 text-xs font-bold uppercase text-[var(--ccr-text)]">
                Driver&apos;s License Number
              </p>
              <p className="font-normal text-[var(--ccr-muted)]">
                {detail.customer.driversLicenseNumber}
              </p>
              {detail.customer.hasSignatureDoc ? (
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-semibold">
                  {detail.customer.hasSignatureDoc ? (
                    <a
                      href={`/admin/bookings/${detail.bookingId}/private-files/SIGNATURE`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--ccr-accent)] transition-colors hover:text-[var(--ccr-text)]"
                    >
                      View Signature
                    </a>
                  ) : null}
                </div>
              ) : null}
              <CustomerLegalIdImagesManager
                customerId={customerId}
                initialItems={customerIdImages}
                readOnly
                compact
              />
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-[var(--ccr-text)]">Vehicle</p>
              <p className="font-normal text-[var(--ccr-muted)]">{detail.vehicleLabel}</p>
            </div>
          </div>
        </section>
      </div>

      {children}

      <section
        data-testid="booking-charges-summary"
        className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Charges Summary</h2>
          <div className="flex flex-wrap items-center gap-2">
            {detail.chargesSummary.paymentIncomplete && detail.chargesSummary.total > 0 ? (
              <span className="rounded-full border border-[var(--ccr-accent)]/40 bg-[var(--ccr-accent)]/15 px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
                Payment incomplete
              </span>
            ) : null}
            {detail.chargesSummary.refundRequired ? (
              <span data-testid="booking-summary-refund-required" className={refundRequiredStyles.badge}>
                Refund required
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-4 grid gap-6 text-sm text-[var(--ccr-muted)] md:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span>Confirmed Booked Days</span>
              <span className="font-semibold text-[var(--ccr-text)]">{detail.chargesSummary.days}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Paid to date</span>
              <span data-testid="booking-summary-paid-to-date" className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(detail.chargesSummary.paidToDate)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Total of Booking</span>
              <span data-testid="booking-summary-total" className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(detail.chargesSummary.totalBeforePromo)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Insurance selected</span>
              <span className="font-semibold text-[var(--ccr-text)]">
                {detail.chargesSummary.insuranceSelected ? "Yes" : "No"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Payment option (stored)</span>
              <span className="font-semibold text-[var(--ccr-text)]">{detail.chargesSummary.paymentOption}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Payment status</span>
              <span data-testid="booking-summary-payment-status" className="font-semibold text-[var(--ccr-text)]">
                {detail.chargesSummary.paymentStatus.replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <div className="space-y-3 border-t border-[var(--ccr-border)] pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex items-center justify-between">
              <span>Daily Rate</span>
              <span className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(detail.chargesSummary.dailyRate)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Insurance price/day</span>
              <span className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(detail.chargesSummary.insurancePricePerDay)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Insurance total</span>
              <span className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(detail.chargesSummary.insuranceTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Promo total{detail.chargesSummary.promoCode ? ` (${detail.chargesSummary.promoCode})` : ""}</span>
              <span className="font-semibold text-[var(--ccr-text)]">
                {detail.chargesSummary.promoTotal > 0
                  ? `-${formatJmd(detail.chargesSummary.promoTotal)}`
                  : formatJmd(0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Deposit due</span>
              <span className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(detail.chargesSummary.depositDue)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Balance due</span>
              <span data-testid="booking-summary-balance-due" className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(detail.chargesSummary.balanceDue)}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        data-testid="booking-payments-section"
        className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Payments</h2>
          <Link
            href={`/admin/payments?bookingId=${detail.bookingId}`}
            data-testid="booking-view-in-payments"
            className="text-sm font-semibold text-[var(--ccr-text)]"
          >
            View in Payments
          </Link>
        </div>
        <ManualPaymentForm
          bookingId={detail.bookingId}
          bookingPublicId={detail.bookingPublicId}
          total={detail.chargesSummary.total}
          paidToDate={detail.chargesSummary.paidToDate}
          balanceDue={detail.chargesSummary.balanceDue}
        />
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ccr-muted)]">No payments recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                <tr>
                  <th className="px-3 py-2">Payment ID</th>
                  <th className="px-3 py-2">Payment Method</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const paymentReference =
                    typeof payment.metadata_json?.reference === "string"
                      ? payment.metadata_json.reference
                      : null;
                  const paymentNote =
                    typeof payment.metadata_json?.note === "string" ? payment.metadata_json.note : null;

                  return (
                    <tr
                      key={payment.id}
                      data-testid="booking-payment-row"
                      data-payment-id={payment.id}
                      data-payment-public-id={payment.public_id}
                      className={`border-b border-[var(--ccr-border)] last:border-b-0 ${
                        payment.deleted_at ? "bg-[var(--ccr-surface-soft)]" : ""
                      }`}
                      title={payment.deleted_reason ? `Deleted: ${payment.deleted_reason}` : undefined}
                    >
                      <td
                        data-testid="booking-payment-public-id"
                        className="px-3 py-2 font-mono text-xs text-[var(--ccr-text)]"
                      >
                        {payment.public_id}
                      </td>
                      <td data-testid="booking-payment-method" className="px-3 py-2 text-[var(--ccr-text)]">
                        <div className="flex items-center gap-2">
                          <span className="whitespace-nowrap">
                            {payment.provider === "MANUAL"
                              ? (payment.metadata_json?.method_label as string | undefined) ??
                                (payment.metadata_json?.method as string | undefined) ??
                                "MANUAL"
                              : payment.provider}
                          </span>
                          {paymentReference || paymentNote ? (
                            <details className="group relative">
                              <summary
                                className="inline-flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--ccr-border)] text-[10px] font-bold leading-none text-[var(--ccr-accent)] transition group-open:rotate-180"
                                title="View payment note"
                                aria-label="View payment note"
                              >
                                ▾
                              </summary>
                              <div className="absolute left-0 top-full z-20 mt-2 w-max max-w-[20rem] rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-2 text-xs text-[var(--ccr-muted)] shadow-sm">
                                {paymentReference ? <p className="break-words">Ref: {paymentReference}</p> : null}
                                {paymentNote ? <p className="mt-1 break-words">Note: {paymentNote}</p> : null}
                              </div>
                            </details>
                          ) : null}
                        </div>
                      </td>
                      <td data-testid="booking-payment-status" className="px-3 py-2 text-[var(--ccr-text)]">
                        {formatPaymentStatus(payment.status, {
                          paymentType:
                            typeof payment.metadata_json?.payment_type === "string"
                              ? String(payment.metadata_json.payment_type)
                              : null,
                        })}
                      </td>
                      <td data-testid="booking-payment-amount" className="px-3 py-2 text-[var(--ccr-text)]">
                        {formatJmd(payment.deposit_amount_cents)}
                      </td>
                      <td className="px-3 py-2 text-[var(--ccr-muted)]">
                        <TableDateTime value={payment.created_at} />
                      </td>
                      <td className="px-3 py-2">
                        <PaymentRowActions
                          paymentId={payment.id}
                          provider={payment.provider}
                          status={payment.status}
                          amount={Number(payment.deposit_amount_cents ?? 0)}
                          deletedAt={payment.deleted_at}
                          isRefunded={refundedOriginalIds.includes(payment.id)}
                          canAdmin={canAdmin}
                          requireRestoreReason={requireRestoreReason}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-sm">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-5 text-lg font-bold text-[var(--ccr-text)] transition-colors hover:text-[var(--ccr-accent)] [&::-webkit-details-marker]:hidden">
            <span>Admin Notes</span>
            <span
              aria-hidden="true"
              className="text-base leading-none text-[var(--ccr-accent)] transition-transform group-open:rotate-180"
            >
              ^
            </span>
          </summary>
          <div className="border-t border-[var(--ccr-border)] px-6 pb-6 pt-1">
            <BookingNotes bookingId={detail.bookingId} notes={detail.notes} />
          </div>
        </details>
      </section>
    </>
  );
}
