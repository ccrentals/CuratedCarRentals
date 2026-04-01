"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { BookingActions } from "@/components/admin/BookingActions";
import { BookingNotes } from "@/components/admin/BookingNotes";
import { BookingUpdateForm } from "@/components/admin/BookingUpdateForm";
import { InfoTooltipIcon } from "@/components/admin/InfoTooltipIcon";
import { ManualPaymentForm } from "@/components/admin/ManualPaymentForm";
import { PaymentRowActions } from "@/components/admin/PaymentRowActions";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { formatJmd } from "@/lib/money";
import { formatPaymentStatus } from "@/lib/payments/formatPaymentStatus";
import { refundRequiredStyles } from "@/lib/refundRequiredStyles";
import type {
  AdminBookingDetailViewModel,
  AdminBookingPaymentRow,
} from "@/lib/bookings/adminBookingDetailView";

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
  canAdmin: boolean;
  requireRestoreReason: boolean;
  promoOptions: AdminBookingActionPromoOption[];
  insuranceOption: AdminBookingActionInsuranceOption;
  inspectionContent?: ReactNode;
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

export function AdminBookingDetailClient({
  initialDetail,
  canAdmin,
  requireRestoreReason,
  promoOptions,
  insuranceOption,
  inspectionContent,
  payments,
  refundedOriginalIds,
  children,
}: AdminBookingDetailClientProps) {
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
            inspectionContent={inspectionContent}
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
              <div className="min-w-0 md:col-span-2">
                <dt className="text-xs uppercase tracking-wide">Structured Location Details</dt>
                <dd
                  data-testid="booking-location-details-block"
                  className="mt-2 grid gap-4 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-4 md:grid-cols-2"
                >
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Pickup
                    </p>
                    <p className="font-semibold text-[var(--ccr-text)]">
                      {detail.bookingDetails.pickupLocationLabel}
                    </p>
                    {detail.bookingDetails.pickupLocationLines.map((line) => (
                      <p key={`pickup-${line}`} className="text-[var(--ccr-muted)]">
                        {line}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Dropoff
                    </p>
                    <p className="font-semibold text-[var(--ccr-text)]">
                      {detail.bookingDetails.dropoffLocationLabel}
                    </p>
                    {detail.bookingDetails.dropoffLocationLines.map((line) => (
                      <p key={`dropoff-${line}`} className="text-[var(--ccr-muted)]">
                        {line}
                      </p>
                    ))}
                  </div>
                </dd>
              </div>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Customer & Vehicle</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Customer</p>
              <p className="font-semibold text-[var(--ccr-text)]">{detail.customer.name}</p>
              <p className="text-[var(--ccr-muted)]">{detail.customer.email}</p>
              <p className="text-[var(--ccr-muted)]">{detail.customer.phone}</p>
              <p className="mt-2 text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                Driver&apos;s License Number
              </p>
              <p className="font-semibold text-[var(--ccr-text)]">
                {detail.customer.driversLicenseNumber}
              </p>
              {detail.customer.hasDriversLicenseDoc || detail.customer.hasSignatureDoc ? (
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-semibold">
                  {detail.customer.hasDriversLicenseDoc ? (
                    <a
                      href={`/admin/bookings/${detail.bookingId}/private-files/DRIVERS_LICENSE`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--ccr-accent)] transition-colors hover:text-[var(--ccr-text)]"
                    >
                      View ID
                    </a>
                  ) : null}
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
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Vehicle</p>
              <p className="font-semibold text-[var(--ccr-text)]">{detail.vehicleLabel}</p>
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

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[var(--ccr-text)]">Admin Notes</h2>
        <BookingNotes bookingId={detail.bookingId} notes={detail.notes} />
      </section>
    </>
  );
}
