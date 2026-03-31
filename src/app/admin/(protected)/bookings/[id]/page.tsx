import Link from "next/link";
import { notFound } from "next/navigation";

import { dbQuery } from "@/lib/db";
import { BookingActions } from "@/components/admin/BookingActions";
import { BookingIncidentsCard } from "@/components/admin/BookingIncidentsCard";
import { BookingVehicleInspectionPanel } from "@/components/admin/BookingVehicleInspectionPanel";
import { BookingNotes } from "@/components/admin/BookingNotes";
import { InfoTooltipIcon } from "@/components/admin/InfoTooltipIcon";
import { BookingUpdateForm } from "@/components/admin/BookingUpdateForm";
import { ManualPaymentForm } from "@/components/admin/ManualPaymentForm";
import { PaymentRowActions } from "@/components/admin/PaymentRowActions";
import { RefundRequiredToast } from "@/components/admin/RefundRequiredToast";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { InlineDateTimeRange } from "@/components/shared/InlineDateTimeRange";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { loadAdminSettings } from "@/lib/adminSettings";
import { getSessionFromRequest } from "@/lib/auth/session";
import { fmtDate, fmtDateNoSeconds, fmtDateOnly } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import { formatPaymentStatus } from "@/lib/payments/formatPaymentStatus";
import {
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
  isNonBlockingBookingHold,
} from "@/lib/payments/pricing";
import { readBookingOverrideInfo } from "@/lib/bookings/holds";
import { formatBookingStatusLabel } from "@/lib/bookings/formatBookingStatusLabel";
import { refundRequiredStyles } from "@/lib/refundRequiredStyles";
import { isEntitledBooking } from "@/lib/availability/entitlement";
import {
  getBookingLocationAdminBadgeLabel,
  readBookingLocationDetails,
} from "@/lib/bookings/bookingLocations";
import {
  createEmptyBookingVehicleInspectionSummaries,
  isBookingVehicleInspectionMissingTableError,
  loadBookingVehicleInspectionSummaries,
} from "@/lib/bookings/vehicleInspection";
import { loadBookingIncidents } from "@/lib/bookings/bookingIncidents";

type BookingDetails = {
  id: string;
  public_id: string;
  start_date: string;
  end_date: string;
  start_at: string | null;
  end_at: string | null;
  pickup_time: string | null;
  dropoff_time: string | null;
  pickup_location: string;
  dropoff_location: string | null;
  pickup_location_text_snapshot: string | null;
  dropoff_location_text_snapshot: string | null;
  vehicle_id: string;
  insurance_selected: boolean | null;
  insurance_price_per_day_cents: number | null;
  insurance_total_cents: number | null;
  payment_option: string | null;
  custom_payment_amount_cents: number | null;
  drivers_license_number: string | null;
  drivers_license_expiration_date: string | null;
  status: string;
  pricing_json: Record<string, unknown>;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_legal_id_type: string | null;
  customer_legal_id_number: string | null;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  daily_rate_cents: number;
  deposit_cents: number;
};

type PaymentRow = {
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

type AdminNote = {
  note_id?: string;
  message: string;
  created_at?: string;
  user_id?: string;
};

type OverriddenByThisBooking = {
  id: string;
  public_id: string;
  start_date: string;
  end_date: string;
  customer_name: string;
};

type BookingPrivateDocRow = {
  document_type: string;
};

type PromoOptionRow = {
  id: string;
  code: string;
  is_active: boolean;
  discount_type: "PERCENT" | "FIXED";
  discount_value: string | number;
  start_at: string | null;
  end_at: string | null;
  max_redemptions: number | null;
  redemption_count: number;
};

type BookingActionPromoOption = {
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

type InsurancePlanOptionRow = {
  id: string;
  is_enabled: boolean;
  price_per_day_cents: number;
};

type BookingActionInsuranceOption = {
  enabled: boolean;
  planId: string | null;
  pricePerDayCents: number;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  const normalizedColumn = column.toLowerCase();
  const escapedColumn = normalizedColumn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const columnPattern = new RegExp(`\\b${escapedColumn}\\b`);
  return code === "42703" && message.includes("does not exist") && columnPattern.test(message);
}

function isAnyUndefinedColumn(error: unknown, columns: string[]) {
  return columns.some((column) => isUndefinedColumn(error, column));
}

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

function readPaymentMetadataText(
  metadata: PaymentRow["metadata_json"],
  key: string,
): string | null {
  const value = metadata?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function formatTimeNoSeconds(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return normalized.replace(/:(\d{2})(?:\.\d+)?$/, "");
}

function readStructuredLocationLines(entry: {
  values: Record<string, string | null>;
  fieldLabels: Record<string, string>;
}) {
  return Object.entries(entry.values)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key, value]) => ({
      key,
      label: entry.fieldLabels[key] ?? key,
      value: value as string,
    }));
}

export default async function AdminBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    notFound();
  }

  const session = await getSessionFromRequest();
  const normalizedRole = String(session?.role ?? "")
    .trim()
    .toUpperCase();
  const canAdmin = normalizedRole === "ADMIN" || normalizedRole === "DEVELOPER";
  let requireRestoreReason = true;

  if (canAdmin) {
    const { settings } = await loadAdminSettings();
    requireRestoreReason = settings.requireRestoreReason;
  }

  let bookingResult;
  try {
    bookingResult = await dbQuery<BookingDetails>(
      "select b.id, b.public_id, b.start_date, b.end_date, b.start_at, b.end_at, b.pickup_time::text as pickup_time, b.dropoff_time::text as dropoff_time, b.pickup_location, b.dropoff_location, b.pickup_location_text_snapshot, b.dropoff_location_text_snapshot, b.vehicle_id, b.insurance_selected, b.insurance_price_per_day_cents, b.insurance_total_cents, b.payment_option, b.custom_payment_amount_cents, b.drivers_license_number, b.drivers_license_expiration_date::text as drivers_license_expiration_date, b.status, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, c.legal_id_type as customer_legal_id_type, c.legal_id_number as customer_legal_id_number, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
      [id],
    );
  } catch (error) {
    if (
      !isAnyUndefinedColumn(error, [
        "legal_id_type",
        "start_at",
        "end_at",
        "pickup_time",
        "dropoff_time",
        "dropoff_location",
        "pickup_location_text_snapshot",
        "dropoff_location_text_snapshot",
        "insurance_selected",
        "insurance_price_per_day_cents",
        "insurance_total_cents",
        "payment_option",
        "custom_payment_amount_cents",
        "drivers_license_number",
        "drivers_license_expiration_date",
        "public_id",
      ])
    ) {
      throw error;
    }
    const legacyBooking = await dbQuery<
      Omit<
        BookingDetails,
        | "start_at"
        | "end_at"
        | "pickup_time"
        | "dropoff_time"
        | "dropoff_location"
        | "pickup_location_text_snapshot"
        | "dropoff_location_text_snapshot"
        | "vehicle_id"
        | "insurance_selected"
        | "insurance_price_per_day_cents"
        | "insurance_total_cents"
        | "payment_option"
        | "custom_payment_amount_cents"
        | "drivers_license_number"
        | "drivers_license_expiration_date"
        | "customer_legal_id_type"
        | "customer_legal_id_number"
      >
    >(
      "select b.id, b.id as public_id, b.start_date, b.end_date, b.pickup_location, b.status, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
      [id],
    );
    bookingResult = {
      ...legacyBooking,
      rows: legacyBooking.rows.map(
        (
          row: Omit<
            BookingDetails,
            | "start_at"
            | "end_at"
            | "pickup_time"
            | "dropoff_time"
            | "dropoff_location"
            | "pickup_location_text_snapshot"
            | "dropoff_location_text_snapshot"
            | "vehicle_id"
            | "insurance_selected"
            | "insurance_price_per_day_cents"
            | "insurance_total_cents"
            | "payment_option"
            | "custom_payment_amount_cents"
            | "drivers_license_number"
            | "drivers_license_expiration_date"
            | "customer_legal_id_type"
            | "customer_legal_id_number"
          >,
        ) => ({
        ...row,
        start_at: null,
        end_at: null,
        pickup_time: null,
        dropoff_time: null,
        dropoff_location: null,
        pickup_location_text_snapshot: row.pickup_location,
        dropoff_location_text_snapshot: row.pickup_location,
        vehicle_id: "",
        insurance_selected: null,
        insurance_price_per_day_cents: null,
        insurance_total_cents: null,
        payment_option: null,
        custom_payment_amount_cents: null,
        drivers_license_number: null,
        drivers_license_expiration_date: null,
        customer_legal_id_type: null,
        customer_legal_id_number: null,
        }),
      ),
    };
  }

  const booking = bookingResult.rows[0];
  if (!booking) {
    notFound();
  }

  let payments: { rows: PaymentRow[]; rowCount: number };
  try {
    payments = await dbQuery<PaymentRow>(
      "select id, public_id, provider, status, deposit_amount_cents, currency, created_at, metadata_json, deleted_at, deleted_reason from payments where booking_id = $1 order by created_at desc",
      [id],
    );
  } catch (error) {
    // Graceful fallback if the DB hasn't been migrated yet.
    if (isAnyUndefinedColumn(error, ["deleted_at", "public_id"])) {
      payments = await dbQuery<PaymentRow>(
        "select id, id as public_id, provider, status, deposit_amount_cents, currency, created_at, metadata_json from payments where booking_id = $1 order by created_at desc",
        [id],
      );
    } else {
      throw error;
    }
  }

  let privateDocs: { rows: BookingPrivateDocRow[]; rowCount: number } = { rows: [], rowCount: 0 };
  try {
    privateDocs = await dbQuery<BookingPrivateDocRow>(
      "select distinct document_type from booking_private_files where booking_id = $1",
      [id],
    );
  } catch (error) {
    if (!isUndefinedColumn(error, "booking_private_files")) {
      throw error;
    }
  }
  const hasDriversLicenseDoc = privateDocs.rows.some(
    (row: BookingPrivateDocRow) => row.document_type === "DRIVERS_LICENSE",
  );
  const hasSignatureDoc = privateDocs.rows.some(
    (row: BookingPrivateDocRow) => row.document_type === "SIGNATURE",
  );

  const pricing = booking.pricing_json ?? {};
  const customerNameSnapshot =
    typeof pricing.customer_name_snapshot === "string" && pricing.customer_name_snapshot.trim()
      ? pricing.customer_name_snapshot.trim()
      : booking.customer_name;
  const customerEmailSnapshot =
    typeof pricing.customer_email_snapshot === "string" && pricing.customer_email_snapshot.trim()
      ? pricing.customer_email_snapshot.trim()
      : booking.customer_email;
  const customerPhoneSnapshot =
    typeof pricing.customer_phone_snapshot === "string" && pricing.customer_phone_snapshot.trim()
      ? pricing.customer_phone_snapshot.trim()
      : booking.customer_phone;
  const overrideInfo = readBookingOverrideInfo(pricing);
  const netPaidToDate = await fetchNetPaidToDate(booking.id);
  const summary = computeBookingPricingFromStoredSnapshot({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    pricing,
    fallbackDailyRate: booking.daily_rate_cents,
    fallbackDeposit: booking.deposit_cents,
    netPaidToDate,
  });
  const days = summary.days;
  const total = summary.total;
  const totalBeforePromo = summary.subtotal;
  const paidToDate = summary.netPaidToDate;
  const balanceDue = summary.balanceDue;
  const depositDue = Math.max(0, Math.max(0, summary.deposit) - Math.max(0, paidToDate));
  const isPaidInFull = summary.paymentStatus === "PAID_IN_FULL";
  const refundRequired = summary.refundRequired;
  const isDepositPaid = summary.deposit > 0 ? paidToDate >= summary.deposit : paidToDate > 0;
  const displayStatus = formatBookingStatusLabel(booking.status, summary.paymentStatus).toUpperCase();
  const entitlementState = isEntitledBooking({
    status: booking.status,
    paymentStatus: summary.paymentStatus,
    paidToDate: summary.netPaidToDate,
    depositRequired: summary.depositRequired,
  })
    ? "ENTITLED"
    : "TENTATIVE";
  const pickupDateTimeLabel = booking.start_at
    ? fmtDateNoSeconds(booking.start_at)
    : `${fmtDateOnly(booking.start_date)}, ${formatTimeNoSeconds(booking.pickup_time) || "12:00 AM"}`;
  const dropoffDateTimeLabel = booking.end_at
    ? fmtDateNoSeconds(booking.end_at)
    : `${fmtDateOnly(booking.end_date)}, ${formatTimeNoSeconds(booking.dropoff_time) || "12:00 AM"}`;
  const pickupTimeValue =
    formatTimeNoSeconds(booking.pickup_time) ||
    (booking.start_at ? String(booking.start_at).slice(11, 16) : "11:00");
  const dropoffTimeValue =
    formatTimeNoSeconds(booking.dropoff_time) ||
    (booking.end_at ? String(booking.end_at).slice(11, 16) : "11:00");
  const pickupLocationSnapshot = booking.pickup_location_text_snapshot || booking.pickup_location;
  const dropoffLocationSnapshot =
    booking.dropoff_location_text_snapshot || booking.dropoff_location || booking.pickup_location;
  const bookingLocationDetails = readBookingLocationDetails(pricing, {
    pickupLabel: pickupLocationSnapshot,
    dropoffLabel: dropoffLocationSnapshot,
    pickupLocationId: null,
    dropoffLocationId: null,
  });
  const pickupLocationLines = readStructuredLocationLines(bookingLocationDetails.pickup);
  const dropoffLocationLines = readStructuredLocationLines(bookingLocationDetails.dropoff);
  const pickupLocationBadge = getBookingLocationAdminBadgeLabel(bookingLocationDetails.pickup.type);
  const dropoffLocationBadge = getBookingLocationAdminBadgeLabel(bookingLocationDetails.dropoff.type);
  const customPaymentAmount = Number(
    pricing.custom_payment_amount_cents ?? booking.custom_payment_amount_cents ?? 0,
  );
  const insurancePricePerDayDisplay = Number(
    pricing.insurance_price_per_day_cents ??
      booking.insurance_price_per_day_cents ??
      summary.insurancePricePerDay ??
      0,
  );
  const insuranceTotalDisplay = Number(
    pricing.insurance_total_cents ?? booking.insurance_total_cents ?? summary.insuranceTotal ?? 0,
  );
  const promoTotalDisplay = Math.max(0, summary.promoDiscount);
  const isNonBlocking =
    isNonBlockingBookingHold({
      paymentStatus: summary.paymentStatus,
      amountPaid: summary.netPaidToDate,
      holdMinimumAmount: summary.deposit,
    }) && !["CANCELLED", "RETURNED"].includes(booking.status.toUpperCase());
  const overriddenByBookingId = overrideInfo.overriddenByBookingId;
  const cancellationReasonWhenLost = overrideInfo.isOverridden
    ? overrideInfo.overrideReason || "LOST_TO_FIRST_DEPOSIT"
    : null;

  const notesRaw = (pricing as { admin_notes?: AdminNote[] }).admin_notes;
  const notes = Array.isArray(notesRaw) ? [...notesRaw] : [];
  const paymentNotes: AdminNote[] = payments.rows.flatMap((payment) => {
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
  notes.sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });

  const refundedOriginalIds = new Set<string>();
  for (const payment of payments.rows) {
    const paymentType = payment.metadata_json?.payment_type;
    const originalPaymentId = payment.metadata_json?.original_payment_id;
    if (paymentType === "refund" && typeof originalPaymentId === "string" && originalPaymentId) {
      refundedOriginalIds.add(originalPaymentId);
    }
  }

  const overriddenByThis = await dbQuery<OverriddenByThisBooking>(
    "select b.id, b.public_id, b.start_date, b.end_date, c.full_name as customer_name from bookings b join customers c on c.id = b.customer_id where coalesce(b.pricing_json->>'overridden_by_booking_id', '') = $1 order by b.updated_at desc",
    [booking.id],
  );
  const overriddenByThisRows = overriddenByThis.rows as OverriddenByThisBooking[];
  const bookingPublicId = String(booking.public_id ?? "").trim() || booking.id;
  let vehicleInspectionTablesUnavailable = false;
  let vehicleInspections = createEmptyBookingVehicleInspectionSummaries({
    bookingId: booking.id,
    bookingPublicId,
    vehicleId: booking.vehicle_id,
  });
  try {
    const loadedVehicleInspections = await loadBookingVehicleInspectionSummaries(booking.id);
    if (loadedVehicleInspections) {
      vehicleInspections = loadedVehicleInspections;
    }
  } catch (error) {
    if (!isBookingVehicleInspectionMissingTableError(error)) {
      throw error;
    }
    vehicleInspectionTablesUnavailable = true;
  }
  const bookingIncidents = await loadBookingIncidents(booking.id);
  let promoOptions: BookingActionPromoOption[] = [];
  try {
    promoOptions = (
      await dbQuery<PromoOptionRow>(
        "select p.id, p.code, p.is_active, p.discount_type, p.discount_value, p.start_at, p.end_at, p.max_redemptions, count(r.id)::int as redemption_count from promo_codes p left join promo_redemptions r on r.promo_code_id = p.id where p.is_active = true group by p.id, p.code, p.is_active, p.discount_type, p.discount_value, p.start_at, p.end_at, p.max_redemptions order by p.created_at desc",
      )
    ).rows.map((row: PromoOptionRow) => ({
      id: row.id,
      code: row.code,
      discountType: row.discount_type,
      discountValue: Number(row.discount_value ?? 0),
      startAt: row.start_at,
      endAt: row.end_at,
      maxRedemptions: row.max_redemptions,
      redemptionCount: Number(row.redemption_count ?? 0),
      remainingRedemptions:
        row.max_redemptions === null
          ? null
          : Math.max(0, Number(row.max_redemptions) - Number(row.redemption_count ?? 0)),
    })) as BookingActionPromoOption[];
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (
      !(
        code === "42P01" ||
        isUndefinedColumn(error, "promo_codes") ||
        isUndefinedColumn(error, "promo_redemptions") ||
        isUndefinedColumn(error, "public_id")
      )
    ) {
      throw error;
    }
  }
  let insuranceOption: BookingActionInsuranceOption = {
    enabled: false,
    planId: null,
    pricePerDayCents: 0,
  };
  try {
    let planResult = await dbQuery<InsurancePlanOptionRow>(
      "select id, is_enabled, price_per_day_cents from insurance_plans where vehicle_id = $1 and is_enabled = true order by updated_at desc limit 1",
      [booking.vehicle_id],
    );
    if (planResult.rowCount === 0) {
      planResult = await dbQuery<InsurancePlanOptionRow>(
        "select id, is_enabled, price_per_day_cents from insurance_plans where is_global_default = true and is_enabled = true order by updated_at desc limit 1",
      );
    }
    const plan = planResult.rows[0];
    if (plan?.is_enabled) {
      insuranceOption = {
        enabled: true,
        planId: plan.id,
        pricePerDayCents: Math.max(0, Number(plan.price_per_day_cents ?? 0)),
      };
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (
      !(
        code === "42P01" ||
        isUndefinedColumn(error, "insurance_plans") ||
        isUndefinedColumn(error, "is_global_default")
      )
    ) {
      throw error;
    }
  }
  const overriddenByBookingPublicId = overriddenByBookingId
    ? (
        await dbQuery<{ public_id: string }>(
          "select public_id from bookings where id = $1 limit 1",
          [overriddenByBookingId],
        )
      ).rows[0]?.public_id ?? overriddenByBookingId
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <RefundRequiredToast refundRequired={refundRequired} />
      <Link href="/admin/bookings" className="text-sm font-semibold text-[var(--ccr-text)]">
        Back to bookings
      </Link>

      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Booking</span>
          <span
            data-testid="booking-public-id"
            className="font-mono text-lg font-bold leading-none text-[var(--ccr-text)] md:text-xl"
          >
            {bookingPublicId}
          </span>
          <span
            data-testid="booking-status-badge"
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusBadge(
              displayStatus,
            )}`}
          >
            {displayStatus.replace(/_/g, " ")}
          </span>
          <span
            data-testid="booking-pickup-type-badge"
            className="inline-flex items-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]"
          >
            Pickup: {pickupLocationBadge}
          </span>
          <span
            data-testid="booking-dropoff-type-badge"
            className="inline-flex items-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]"
          >
            Dropoff: {dropoffLocationBadge}
          </span>
          {isNonBlocking ? <InfoTooltipIcon message="UNPAID - Not holding vehicle" /> : null}
          {overrideInfo.isOverridden ? (
            <span className="inline-flex items-center rounded-full border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-status-danger-text)]">
              OVERRIDDEN
            </span>
          ) : null}
        </div>

        <div className="w-full pt-1">
          <BookingActions
            bookingId={booking.id}
            bookingPublicId={bookingPublicId}
            bookingStatus={booking.status}
            isPaidInFull={isPaidInFull}
            isDepositPaid={isDepositPaid}
            canAdmin={canAdmin}
            vehicleId={booking.vehicle_id}
            vehicleLabel={`${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim()}
            promoOptions={promoOptions}
            insuranceOption={insuranceOption}
            initialPromoCode={summary.promoCode}
            initialInsuranceSelected={summary.insuranceSelected}
            bookingChangesContent={
              <BookingUpdateForm
                bookingId={booking.id}
                startDate={booking.start_date}
                endDate={booking.end_date}
                pickupTime={pickupTimeValue}
                dropoffTime={dropoffTimeValue}
                customerName={customerNameSnapshot}
                customerEmail={customerEmailSnapshot}
                customerPhone={customerPhoneSnapshot}
                pickupLocationTypeKey={bookingLocationDetails.pickup.typeKey}
                dropoffLocationTypeKey={bookingLocationDetails.dropoff.typeKey}
                pickupLocationValues={bookingLocationDetails.pickup.values}
                dropoffLocationValues={bookingLocationDetails.dropoff.values}
                disabled={["RETURNED", "CANCELLED"].includes(booking.status.toUpperCase())}
              />
            }
            inspectionContent={
              <BookingVehicleInspectionPanel
                bookingId={booking.id}
                bookingStatus={booking.status}
                bookingPublicId={bookingPublicId}
                inspections={vehicleInspections}
                tablesUnavailable={vehicleInspectionTablesUnavailable}
                canCorrectOdometer={canAdmin}
              />
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
                <dd className="font-semibold text-[var(--ccr-text)]">{displayStatus.replace(/_/g, " ")}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Entitlement</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">{entitlementState}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Payment Option</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">
                  {summary.paymentOption.replace(/_/g, " ")}
                </dd>
              </div>
              {summary.paymentOption === "CUSTOM" ? (
                <div className="min-w-0">
                  <dt className="text-xs uppercase tracking-wide">Custom Amount</dt>
                  <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(customPaymentAmount)}</dd>
                </div>
              ) : null}
              {cancellationReasonWhenLost ? (
                <div className="min-w-0">
                  <dt className="text-xs uppercase tracking-wide">Cancellation Reason</dt>
                  <dd className="font-semibold text-[var(--ccr-text)]">{cancellationReasonWhenLost}</dd>
                </div>
              ) : null}
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Vehicle</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">
                  {booking.vehicle_year} {booking.vehicle_make} {booking.vehicle_model}
                </dd>
              </div>
            </div>

            <div className="space-y-3">
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Pickup Date & Time</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">
                  <DateTimeInline value={pickupDateTimeLabel} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Dropoff Date & Time</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">
                  <DateTimeInline value={dropoffDateTimeLabel} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Pickup Location Snapshot</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">{pickupLocationSnapshot}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide">Dropoff Location Snapshot</dt>
                <dd className="font-semibold text-[var(--ccr-text)]">{dropoffLocationSnapshot}</dd>
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
                    <p className="font-semibold text-[var(--ccr-text)]">{bookingLocationDetails.pickup.label}</p>
                    {pickupLocationLines.map((line) => (
                      <p key={`pickup-${line.key}`} className="text-[var(--ccr-muted)]">
                        {line.label}: {line.value}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Dropoff
                    </p>
                    <p className="font-semibold text-[var(--ccr-text)]">{bookingLocationDetails.dropoff.label}</p>
                    {dropoffLocationLines.map((line) => (
                      <p key={`dropoff-${line.key}`} className="text-[var(--ccr-muted)]">
                        {line.label}: {line.value}
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
              <p className="font-semibold text-[var(--ccr-text)]">{customerNameSnapshot}</p>
              <p className="text-[var(--ccr-muted)]">{customerEmailSnapshot}</p>
              <p className="text-[var(--ccr-muted)]">{customerPhoneSnapshot}</p>
              <p className="mt-2 text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                Driver&apos;s License Number
              </p>
              <p className="font-semibold text-[var(--ccr-text)]">
                {booking.drivers_license_number || booking.customer_legal_id_number || "Not provided"}
              </p>
              {hasDriversLicenseDoc || hasSignatureDoc ? (
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-semibold">
                  {hasDriversLicenseDoc ? (
                    <a
                      href={`/admin/bookings/${booking.id}/private-files/DRIVERS_LICENSE`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--ccr-accent)] transition-colors hover:text-[var(--ccr-text)]"
                    >
                      View ID
                    </a>
                  ) : null}
                  {hasSignatureDoc ? (
                    <a
                      href={`/admin/bookings/${booking.id}/private-files/SIGNATURE`}
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
              <p className="font-semibold text-[var(--ccr-text)]">
                {booking.vehicle_year} {booking.vehicle_make} {booking.vehicle_model}
              </p>
            </div>
          </div>
        </section>
      </div>

      <BookingIncidentsCard incidents={bookingIncidents} />

      <section
        data-testid="booking-charges-summary"
        className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Charges Summary</h2>
          <div className="flex flex-wrap items-center gap-2">
            {!isPaidInFull && total > 0 ? (
              <span className="rounded-full border border-[var(--ccr-accent)]/40 bg-[var(--ccr-accent)]/15 px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
                Payment incomplete
              </span>
            ) : null}
            {refundRequired ? (
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
              <span className="font-semibold text-[var(--ccr-text)]">{days}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Paid to date</span>
              <span data-testid="booking-summary-paid-to-date" className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(paidToDate)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Total of Booking</span>
              <span data-testid="booking-summary-total" className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(totalBeforePromo)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Insurance selected</span>
              <span className="font-semibold text-[var(--ccr-text)]">
                {summary.insuranceSelected ? "Yes" : "No"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Payment option (stored)</span>
              <span className="font-semibold text-[var(--ccr-text)]">{summary.paymentOption}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Payment status</span>
              <span data-testid="booking-summary-payment-status" className="font-semibold text-[var(--ccr-text)]">
                {summary.paymentStatus.replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <div className="space-y-3 border-t border-[var(--ccr-border)] pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex items-center justify-between">
              <span>Daily Rate</span>
              <span className="font-semibold text-[var(--ccr-text)]">{formatJmd(summary.dailyRate)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Insurance price/day</span>
              <span className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(insurancePricePerDayDisplay)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Insurance total</span>
              <span className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(insuranceTotalDisplay)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Promo total{summary.promoCode ? ` (${summary.promoCode})` : ""}</span>
              <span className="font-semibold text-[var(--ccr-text)]">
                {promoTotalDisplay > 0 ? `-${formatJmd(promoTotalDisplay)}` : formatJmd(0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Deposit due</span>
              <span className="font-semibold text-[var(--ccr-text)]">{formatJmd(depositDue)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Balance due</span>
              <span data-testid="booking-summary-balance-due" className="font-semibold text-[var(--ccr-text)]">
                {formatJmd(balanceDue)}
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
            href={`/admin/payments?bookingId=${booking.id}`}
            data-testid="booking-view-in-payments"
            className="text-sm font-semibold text-[var(--ccr-text)]"
          >
            View in Payments
          </Link>
        </div>
        <ManualPaymentForm
          bookingId={booking.id}
          bookingPublicId={bookingPublicId}
          total={total}
          paidToDate={paidToDate}
          balanceDue={balanceDue}
        />
        {payments.rows.length === 0 ? (
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
                {payments.rows.map((payment: PaymentRow) => {
                  const paymentReference = readPaymentMetadataText(payment.metadata_json, "reference");
                  const paymentNote = readPaymentMetadataText(payment.metadata_json, "note");

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
                          isRefunded={refundedOriginalIds.has(payment.id)}
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
        <BookingNotes bookingId={booking.id} notes={notes} />
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[var(--ccr-text)]">Override info</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm text-[var(--ccr-muted)]">
          <div className="min-w-0">
            <dt className="text-xs uppercase tracking-wide">Current state</dt>
            <dd className="font-semibold text-[var(--ccr-text)]">
              {overrideInfo.isOverridden ? "Overridden" : "Active"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs uppercase tracking-wide">Overridden by</dt>
            <dd className="font-semibold text-[var(--ccr-text)]">
              {overriddenByBookingId ? (
                <Link
                  href={`/admin/bookings/${overriddenByBookingId}`}
                  className="break-all underline underline-offset-2"
                >
                  {overriddenByBookingPublicId ?? overriddenByBookingId}
                </Link>
              ) : (
                "N/A"
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs uppercase tracking-wide">Overridden at</dt>
            <dd className="font-semibold text-[var(--ccr-text)]">
              {overrideInfo.overriddenAt ? <DateTimeInline value={overrideInfo.overriddenAt} /> : "N/A"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs uppercase tracking-wide">Reason</dt>
            <dd className="break-words font-semibold text-[var(--ccr-text)]">
              {overrideInfo.overrideReason ?? "N/A"}
            </dd>
          </div>
        </dl>

        <div className="mt-5">
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Bookings overridden by this booking</p>
          {overriddenByThis.rowCount === 0 ? (
            <p className="mt-2 text-sm text-[var(--ccr-muted)]">None.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {overriddenByThisRows.map((item: OverriddenByThisBooking) => (
                <li key={item.id} className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2">
                  <Link href={`/admin/bookings/${item.id}`} className="font-mono text-xs text-[var(--ccr-text)] underline underline-offset-2">
                    {item.public_id}
                  </Link>
                  <p className="mt-1 text-[var(--ccr-text)]">{item.customer_name}</p>
                  <p className="text-[var(--ccr-muted)]">
                    <InlineDateTimeRange
                      startLabel={fmtDate(item.start_date)}
                      endLabel={fmtDate(item.end_date)}
                    />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
