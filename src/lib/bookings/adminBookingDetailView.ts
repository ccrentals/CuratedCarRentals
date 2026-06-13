import { buildBookingDateTimeLabel } from "@/lib/bookings/bookingDateTime";
import {
  getBookingLocationAdminBadgeLabel,
  getBookingLocationDetailLines,
  type BookingLocationDetails,
  type BookingLocationFieldValueMap,
} from "@/lib/bookings/bookingLocations";

export type AdminBookingNote = {
  note_id?: string;
  message: string;
  created_at?: string;
  user_id?: string | null;
  email_target?: "none" | "customer" | "internal" | "both";
  email_send_mode?: "immediate" | "scheduled" | string | null;
  email_scheduled_for?: string | null;
  email_customer_sent_at?: string | null;
  email_internal_sent_at?: string | null;
  email_cancelled_at?: string | null;
  email_cancel_reason?: string | null;
  email_last_error?: string | null;
};

export type AdminBookingPaymentRow = {
  id: string;
  public_id: string;
  provider: string;
  status: string;
  deposit_amount_cents: number;
  currency: string;
  created_at: string;
  metadata_json: Record<string, unknown> | null;
  deleted_at?: string | null;
  deleted_reason?: string | null;
};

export type AdminBookingDetailFormState = {
  startDate: string;
  endDate: string;
  pickupTime: string;
  dropoffTime: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  pickupLocationTypeKey: string;
  dropoffLocationTypeKey: string;
  pickupLocationValues: BookingLocationFieldValueMap;
  dropoffLocationValues: BookingLocationFieldValueMap;
  disabled: boolean;
};

export type AdminBookingDetailViewModel = {
  versionKey: string;
  bookingId: string;
  bookingPublicId: string;
  bookingStatus: string;
  displayStatus: string;
  isNonBlocking: boolean;
  isOverridden: boolean;
  pickupLocationBadge: string;
  dropoffLocationBadge: string;
  isPaidInFull: boolean;
  isDepositPaid: boolean;
  isPickupInspectionComplete: boolean;
  vehicleId: string;
  vehicleLabel: string;
  initialPromoCode: string | null;
  initialInsuranceSelected: boolean;
  bookingDetails: {
    entitlement: string;
    paymentOptionLabel: string;
    customPaymentAmountCents: number | null;
    cancellationReason: string | null;
    vehicleLabel: string;
    pickupDateTimeLabel: string;
    dropoffDateTimeLabel: string;
    pickupLocationSnapshot: string;
    dropoffLocationSnapshot: string;
    pickupLocationLabel: string;
    dropoffLocationLabel: string;
    pickupLocationLines: string[];
    dropoffLocationLines: string[];
  };
  customer: {
    name: string;
    email: string;
    phone: string;
    driversLicenseNumber: string;
    hasDriversLicenseDoc: boolean;
    hasSignatureDoc: boolean;
  };
  chargesSummary: {
    paymentIncomplete: boolean;
    refundRequired: boolean;
    days: number;
    paidToDate: number;
    totalBeforePromo: number;
    total: number;
    insuranceSelected: boolean;
    paymentOption: string;
    paymentStatus: string;
    dailyRate: number;
    insurancePricePerDay: number;
    insuranceTotal: number;
    promoCode: string | null;
    promoTotal: number;
    depositDue: number;
    balanceDue: number;
  };
  notes: AdminBookingNote[];
  form: AdminBookingDetailFormState;
};

function readPaymentMetadataText(metadata: AdminBookingPaymentRow["metadata_json"], key: string) {
  const value = metadata?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function buildAdminBookingNotes(
  adminNotes: AdminBookingNote[],
  payments: AdminBookingPaymentRow[],
) {
  const notes = [...adminNotes];
  const paymentNotes: AdminBookingNote[] = payments.flatMap((payment) => {
    const reference = readPaymentMetadataText(payment.metadata_json, "reference");
    const note = readPaymentMetadataText(payment.metadata_json, "note");
    if (!reference && !note) return [];

    const providerLabel =
      payment.provider === "MANUAL"
        ? (payment.metadata_json?.method_label as string | undefined) ??
          (payment.metadata_json?.method as string | undefined) ??
          "Manual"
        : payment.provider;

    const paymentPublicId = String(payment.public_id ?? "").trim() || payment.id;
    const parts = [`Payment ${paymentPublicId} (${providerLabel})`];
    if (reference) parts.push(`Ref: ${reference}`);
    if (note) parts.push(`Note: ${note}`);

    return [
      {
        note_id: `payment-${payment.id}`,
        message: parts.join(" • "),
        created_at: payment.created_at,
      },
    ];
  });

  notes.push(...paymentNotes);
  notes.sort((left, right) => {
    const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
    return rightTime - leftTime;
  });

  return notes;
}

export function buildAdminBookingDateTimeLabel(input: {
  date: string;
  time: string | null | undefined;
  at: string | null | undefined;
}) {
  return buildBookingDateTimeLabel(input);
}

export function buildAdminBookingDetailView(input: {
  versionKey: string;
  bookingId: string;
  bookingPublicId: string;
  bookingStatus: string;
  displayStatus: string;
  isNonBlocking: boolean;
  isOverridden: boolean;
  isPaidInFull: boolean;
  isDepositPaid: boolean;
  isPickupInspectionComplete: boolean;
  vehicleId: string;
  vehicleLabel: string;
  initialPromoCode: string | null;
  initialInsuranceSelected: boolean;
  entitlement: string;
  paymentOptionLabel: string;
  customPaymentAmountCents: number | null;
  cancellationReason: string | null;
  pickupDateTimeLabel: string;
  dropoffDateTimeLabel: string;
  pickupLocationSnapshot: string;
  dropoffLocationSnapshot: string;
  bookingLocationDetails: BookingLocationDetails;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  driversLicenseNumber: string | null;
  hasDriversLicenseDoc: boolean;
  hasSignatureDoc: boolean;
  days: number;
  paidToDate: number;
  totalBeforePromo: number;
  total: number;
  insuranceSelected: boolean;
  paymentOption: string;
  paymentStatus: string;
  dailyRate: number;
  insurancePricePerDay: number;
  insuranceTotal: number;
  promoCode: string | null;
  promoTotal: number;
  depositDue: number;
  balanceDue: number;
  refundRequired: boolean;
  notes: AdminBookingNote[];
  form: AdminBookingDetailFormState;
}) {
  return {
    versionKey: input.versionKey,
    bookingId: input.bookingId,
    bookingPublicId: input.bookingPublicId,
    bookingStatus: input.bookingStatus,
    displayStatus: input.displayStatus,
    isNonBlocking: input.isNonBlocking,
    isOverridden: input.isOverridden,
    pickupLocationBadge: getBookingLocationAdminBadgeLabel(input.bookingLocationDetails.pickup.type),
    dropoffLocationBadge: getBookingLocationAdminBadgeLabel(input.bookingLocationDetails.dropoff.type),
    isPaidInFull: input.isPaidInFull,
    isDepositPaid: input.isDepositPaid,
    isPickupInspectionComplete: input.isPickupInspectionComplete,
    vehicleId: input.vehicleId,
    vehicleLabel: input.vehicleLabel,
    initialPromoCode: input.initialPromoCode,
    initialInsuranceSelected: input.initialInsuranceSelected,
    bookingDetails: {
      entitlement: input.entitlement,
      paymentOptionLabel: input.paymentOptionLabel,
      customPaymentAmountCents: input.customPaymentAmountCents,
      cancellationReason: input.cancellationReason,
      vehicleLabel: input.vehicleLabel,
      pickupDateTimeLabel: input.pickupDateTimeLabel,
      dropoffDateTimeLabel: input.dropoffDateTimeLabel,
      pickupLocationSnapshot: input.pickupLocationSnapshot,
      dropoffLocationSnapshot: input.dropoffLocationSnapshot,
      pickupLocationLabel: input.bookingLocationDetails.pickup.label,
      dropoffLocationLabel: input.bookingLocationDetails.dropoff.label,
      pickupLocationLines: getBookingLocationDetailLines(input.bookingLocationDetails.pickup),
      dropoffLocationLines: getBookingLocationDetailLines(input.bookingLocationDetails.dropoff),
    },
    customer: {
      name: input.customerName,
      email: input.customerEmail,
      phone: input.customerPhone,
      driversLicenseNumber: input.driversLicenseNumber || "Not provided",
      hasDriversLicenseDoc: input.hasDriversLicenseDoc,
      hasSignatureDoc: input.hasSignatureDoc,
    },
    chargesSummary: {
      paymentIncomplete: !input.isPaidInFull && input.total > 0,
      refundRequired: input.refundRequired,
      days: input.days,
      paidToDate: input.paidToDate,
      totalBeforePromo: input.totalBeforePromo,
      total: input.total,
      insuranceSelected: input.insuranceSelected,
      paymentOption: input.paymentOption,
      paymentStatus: input.paymentStatus,
      dailyRate: input.dailyRate,
      insurancePricePerDay: input.insurancePricePerDay,
      insuranceTotal: input.insuranceTotal,
      promoCode: input.promoCode,
      promoTotal: input.promoTotal,
      depositDue: input.depositDue,
      balanceDue: input.balanceDue,
    },
    notes: input.notes,
    form: input.form,
  } satisfies AdminBookingDetailViewModel;
}
