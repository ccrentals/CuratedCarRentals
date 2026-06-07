import Link from "next/link";
import { notFound } from "next/navigation";

import { dbQuery } from "@/lib/db";
import { AdminBookingDetailClient } from "@/components/admin/AdminBookingDetailClient";
import { BookingIncidentsCard } from "@/components/admin/BookingIncidentsCard";
import { BookingVehicleInspectionPanel } from "@/components/admin/BookingVehicleInspectionPanel";
import { RefundRequiredToast } from "@/components/admin/RefundRequiredToast";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { InlineDateTimeRange } from "@/components/shared/InlineDateTimeRange";
import { loadAdminSettings } from "@/lib/adminSettings";
import { getSessionFromRequest } from "@/lib/auth/session";
import { fmtDate } from "@/lib/dateFormat";
import {
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
  isNonBlockingBookingHold,
} from "@/lib/payments/pricing";
import { readBookingOverrideInfo } from "@/lib/bookings/holds";
import { formatBookingStatusLabel } from "@/lib/bookings/formatBookingStatusLabel";
import { isEntitledBooking } from "@/lib/availability/entitlement";
import { readBookingLocationDetails } from "@/lib/bookings/bookingLocations";
import {
  buildAdminBookingDateTimeLabel,
  buildAdminBookingDetailView,
  buildAdminBookingNotes,
} from "@/lib/bookings/adminBookingDetailView";
import {
  createEmptyBookingVehicleInspectionSummaries,
  isBookingVehicleInspectionMissingTableError,
  loadBookingVehicleInspectionSummaries,
} from "@/lib/bookings/vehicleInspection";
import { loadBookingIncidents } from "@/lib/bookings/bookingIncidents";
import { loadMediaAuditHistory } from "@/lib/uploads/mediaAudit";

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
  const pickupDateTimeLabel = buildAdminBookingDateTimeLabel({
    date: booking.start_date,
    time: booking.pickup_time,
    at: booking.start_at,
  });
  const dropoffDateTimeLabel = buildAdminBookingDateTimeLabel({
    date: booking.end_date,
    time: booking.dropoff_time,
    at: booking.end_at,
  });
  const pickupTimeValue =
    String(booking.pickup_time ?? "").trim().replace(/:(\d{2})(?:\.\d+)?$/, "") ||
    (booking.start_at ? String(booking.start_at).slice(11, 16) : "11:00");
  const dropoffTimeValue =
    String(booking.dropoff_time ?? "").trim().replace(/:(\d{2})(?:\.\d+)?$/, "") ||
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
  const notes = buildAdminBookingNotes(Array.isArray(notesRaw) ? [...notesRaw] : [], payments.rows);

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
  const isPickupInspectionComplete = vehicleInspections.pickup.recordStatus === "COMPLETED";
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
      "select id, is_enabled, price_per_day_cents from insurance_plans where is_global_default = true and is_enabled = true order by updated_at desc limit 1",
    );
    if (planResult.rowCount === 0) {
      planResult = await dbQuery<InsurancePlanOptionRow>(
        "select id, is_enabled, price_per_day_cents from insurance_plans where vehicle_id = $1 and is_enabled = true order by updated_at desc limit 1",
        [booking.vehicle_id],
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
  const initialDetail = buildAdminBookingDetailView({
    versionKey: [
      booking.id,
      booking.start_date,
      booking.end_date,
      pickupTimeValue,
      dropoffTimeValue,
      customerNameSnapshot,
      customerEmailSnapshot,
      customerPhoneSnapshot,
      pickupLocationSnapshot,
      dropoffLocationSnapshot,
      summary.total,
      summary.paymentStatus,
      notes.length,
    ].join("|"),
    bookingId: booking.id,
    bookingPublicId,
    bookingStatus: booking.status,
    displayStatus,
    isNonBlocking,
    isOverridden: overrideInfo.isOverridden,
    isPaidInFull,
    isDepositPaid,
    isPickupInspectionComplete,
    vehicleId: booking.vehicle_id,
    vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
    initialPromoCode: summary.promoCode,
    initialInsuranceSelected: summary.insuranceSelected,
    entitlement: entitlementState,
    paymentOptionLabel: summary.paymentOption.replace(/_/g, " "),
    customPaymentAmountCents: summary.paymentOption === "CUSTOM" ? customPaymentAmount : null,
    cancellationReason: cancellationReasonWhenLost,
    pickupDateTimeLabel,
    dropoffDateTimeLabel,
    pickupLocationSnapshot,
    dropoffLocationSnapshot,
    bookingLocationDetails,
    customerName: customerNameSnapshot,
    customerEmail: customerEmailSnapshot,
    customerPhone: customerPhoneSnapshot,
    driversLicenseNumber: booking.drivers_license_number || booking.customer_legal_id_number,
    hasDriversLicenseDoc,
    hasSignatureDoc,
    days,
    paidToDate,
    totalBeforePromo,
    total,
    insuranceSelected: summary.insuranceSelected,
    paymentOption: summary.paymentOption,
    paymentStatus: summary.paymentStatus,
    dailyRate: summary.dailyRate,
    insurancePricePerDay: insurancePricePerDayDisplay,
    insuranceTotal: insuranceTotalDisplay,
    promoCode: summary.promoCode,
    promoTotal: promoTotalDisplay,
    depositDue,
    balanceDue,
    refundRequired,
    notes,
    form: {
      startDate: booking.start_date,
      endDate: booking.end_date,
      pickupTime: pickupTimeValue,
      dropoffTime: dropoffTimeValue,
      customerName: customerNameSnapshot,
      customerEmail: customerEmailSnapshot,
      customerPhone: customerPhoneSnapshot,
      pickupLocationTypeKey: bookingLocationDetails.pickup.typeKey,
      dropoffLocationTypeKey: bookingLocationDetails.dropoff.typeKey,
      pickupLocationValues: bookingLocationDetails.pickup.values,
      dropoffLocationValues: bookingLocationDetails.dropoff.values,
      disabled: ["RETURNED", "CANCELLED"].includes(booking.status.toUpperCase()),
    },
  });

  const mediaActivities = await loadMediaAuditHistory({
    entityType: "booking",
    entityId: booking.id,
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <RefundRequiredToast refundRequired={refundRequired} />
      <Link href="/admin/bookings" className="text-sm font-semibold text-[var(--ccr-text)]">
        Back to bookings
      </Link>
      <AdminBookingDetailClient
        initialDetail={initialDetail}
        canAdmin={canAdmin}
        requireRestoreReason={requireRestoreReason}
        promoOptions={promoOptions}
        insuranceOption={insuranceOption}
        inspectionContent={
          <BookingVehicleInspectionPanel
            bookingId={booking.id}
            bookingStatus={booking.status}
            bookingPublicId={bookingPublicId}
            inspections={vehicleInspections}
            mediaActivities={mediaActivities}
            tablesUnavailable={vehicleInspectionTablesUnavailable}
            canCorrectOdometer={canAdmin}
          />
        }
        payments={payments.rows}
        refundedOriginalIds={[...refundedOriginalIds]}
      >
        <BookingIncidentsCard incidents={bookingIncidents} />
      </AdminBookingDetailClient>

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-sm">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-5 text-lg font-bold text-[var(--ccr-text)] transition-colors hover:text-[var(--ccr-accent)] [&::-webkit-details-marker]:hidden">
            <span>Override info</span>
            <span
              aria-hidden="true"
              className="text-base leading-none text-[var(--ccr-accent)] transition-transform group-open:rotate-180"
            >
              ^
            </span>
          </summary>
          <div className="border-t border-[var(--ccr-border)] px-6 pb-6 pt-5">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm text-[var(--ccr-muted)] sm:grid-cols-2">
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
          </div>
        </details>
      </section>
    </div>
  );
}
