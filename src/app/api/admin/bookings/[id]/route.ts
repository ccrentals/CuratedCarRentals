import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { isAdminRole, isDeveloperRole } from "@/lib/auth/roles";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery, getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import {
  getInternalNotesRecipient,
  sendBookingNoteEmail,
  sendPickupConfirmedEmail,
} from "@/lib/notifications/email";
import { logWarn } from "@/lib/log";
import {
  isNonBlockingPricing,
  readBookingOverrideInfo,
} from "@/lib/bookings/holds";
import {
  buildAdminBookingDateTimeLabel,
  buildAdminBookingDetailView,
  buildAdminBookingNotes,
  type AdminBookingNote,
  type AdminBookingPaymentRow,
} from "@/lib/bookings/adminBookingDetailView";
import { bookingDateTimeToUtcIso } from "@/lib/bookings/bookingDateTime";
import {
  appendBookingLocationNote,
  readBookingLocationDetails,
} from "@/lib/bookings/bookingLocations";
import {
  listActiveBookingLocationConfigs,
  toBookingLocationConfigSchemaError,
} from "@/lib/bookings/bookingLocationConfigStore";
import {
  buildBookingLocationSelectionPayload,
  normalizeBookingLocationFieldValuesInput,
  validateBookingLocationSelection,
} from "@/lib/bookings/locationConfigRuntime";
import {
  hasCompletedBookingVehicleInspection,
  isBookingVehicleInspectionMissingTableError,
} from "@/lib/bookings/vehicleInspection";
import {
  syncPromoRedemptionStateForBooking,
  validatePromoForBooking,
} from "@/lib/promos";
import {
  computeBookingPricing,
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
  isNonBlockingBookingHold,
  readPaymentOption,
  readPromoPricingFields,
} from "@/lib/payments/pricing";
import { formatBookingStatusLabel } from "@/lib/bookings/formatBookingStatusLabel";
import { isEntitledBooking, isVehicleUnavailableEntitlementBased } from "@/lib/availability/entitlement";
import { requireCsrf } from "@/lib/security/csrf";
import { synchronizeCustomerContact } from "@/lib/customers/customerContactSync";

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`"${column}"`) && message.includes("does not exist");
}

function normalizeNoteTarget(value: unknown): "none" | "customer" | "internal" | "both" {
  if (typeof value !== "string") return "none";
  if (value === "customer" || value === "internal" || value === "both" || value === "none") {
    return value;
  }
  return "none";
}

function normalizeNoteSendMode(value: unknown): "immediate" | "scheduled" {
  if (typeof value === "string" && value === "scheduled") return "scheduled";
  return "immediate";
}

function normalizeDateInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeTimeInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)) return null;
  return trimmed.slice(0, 5);
}

function buildDateTimeIso(date: string, time: string) {
  return bookingDateTimeToUtcIso(date, time);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mapSummaryForResponse(summary: ReturnType<typeof computeBookingPricing>) {
  return {
    days: summary.days,
    subtotal: summary.subtotal,
    total: summary.total,
    deposit: summary.deposit,
    netPaidToDate: summary.netPaidToDate,
    balanceDue: summary.balanceDue,
    promoCode: summary.promoCode,
    promoDiscount: summary.promoDiscount,
    insuranceSelected: summary.insuranceSelected,
    insurancePricePerDay: summary.insurancePricePerDay,
    insuranceTotal: summary.insuranceTotal,
    paymentStatus: summary.paymentStatus,
    paymentOption: summary.paymentOption,
  };
}

function buildPricingSnapshot(
  existingPricing: Record<string, unknown> | null,
  summary: ReturnType<typeof computeBookingPricing>,
  promoCodeId: string | null,
) {
  return {
    ...(existingPricing ?? {}),
    daily_rate_cents: summary.dailyRate,
    deposit_cents: summary.deposit,
    days: summary.days,
    subtotal_cents: summary.subtotal,
    base_total_cents: summary.baseTotal,
    extra_fees_cents: summary.extraFeesTotal,
    insurance_selected: summary.insuranceSelected,
    insurance_price_per_day_cents: summary.insurancePricePerDay,
    insurance_total_cents: summary.insuranceTotal,
    promo_code: summary.promoCode,
    promo_code_id: promoCodeId,
    promo_discount_cents: summary.promoDiscount,
    discount_total_cents: summary.discountTotal,
    total_cents: summary.total,
    total_amount: summary.total,
    amount_due_cents: summary.amountDue,
    amount_paid: summary.netPaidToDate,
    balance_due: summary.balanceDue,
    payment_status: summary.paymentStatus,
    payment_option_selected: summary.paymentOption,
    refund_required: summary.refundRequired,
    currency: "JMD",
  };
}

type DbClientLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
};

async function resolveValidatedPromoForBookingUpdate(input: {
  client: DbClientLike;
  existingPromoCode: string | null;
  vehicleId: string;
  startDate: string;
  endDate: string;
  subtotalCents: number;
  baseTotalCents: number;
  customerId: string;
  customerEmail: string;
}) {
  if (!input.existingPromoCode) {
    return {
      promoCode: null,
      promoDiscount: 0,
      promoId: null,
    };
  }

  const promoValidation = await validatePromoForBooking({
    code: input.existingPromoCode,
    vehicleId: input.vehicleId,
    startDate: input.startDate,
    endDate: input.endDate,
    subtotalCents: input.subtotalCents,
    baseTotalCents: input.baseTotalCents,
    customerId: input.customerId,
    customerEmail: input.customerEmail,
    client: input.client,
  });

  if (!promoValidation.ok) {
    return {
      promoCode: null,
      promoDiscount: 0,
      promoId: null,
    };
  }

  return {
    promoCode: promoValidation.code,
    promoDiscount: promoValidation.discountAmountCents,
    promoId: promoValidation.promoId,
  };
}

function buildWindowFromDates(
  startDate: string,
  endDate: string,
  pickupTime = "11:00",
  dropoffTime = "11:00",
) {
  const startAt = bookingDateTimeToUtcIso(startDate, pickupTime);
  const endAt = bookingDateTimeToUtcIso(endDate, dropoffTime);
  if (!startAt || !endAt || endAt <= startAt) return null;
  return {
    startAt,
    endAt,
  };
}

type BookingByIdRouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminBookingByIdGetDeps = {
  getSession: () => Promise<AdminSession | null>;
};

const DEFAULT_BOOKING_BY_ID_GET_DEPS: AdminBookingByIdGetDeps = {
  getSession: () => getSessionFromRequest(),
};

export async function handleAdminBookingByIdGet(
  _request: Request,
  { params }: BookingByIdRouteContext,
  deps: AdminBookingByIdGetDeps = DEFAULT_BOOKING_BY_ID_GET_DEPS,
) {
  const auth = await requireOperationsAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const bookingResult = await dbQuery(
    "select b.*, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [id],
  );

  if (bookingResult.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const paymentsResult = await (async () => {
    try {
      return await dbQuery(
        "select id, public_id, provider, status, deposit_amount_cents, currency, created_at from payments where booking_id = $1 order by created_at desc",
        [id],
      );
    } catch (error) {
      if (isUndefinedColumn(error, "public_id")) {
        return dbQuery(
          "select id, id as public_id, provider, status, deposit_amount_cents, currency, created_at from payments where booking_id = $1 order by created_at desc",
          [id],
        );
      }
      throw error;
    }
  })();

  const booking = bookingResult.rows[0];
  const pricing = (booking.pricing_json ?? {}) as Record<string, unknown>;
  const netPaidToDate = await fetchNetPaidToDate(booking.id);
  const paymentSummary = computeBookingPricingFromStoredSnapshot({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    pricing,
    fallbackDailyRate: booking.daily_rate_cents,
    fallbackDeposit: booking.deposit_cents,
    netPaidToDate,
  });
  const overrideInfo = readBookingOverrideInfo(pricing);

  return NextResponse.json({
    booking: {
      id: booking.id,
      public_id: booking.public_id ?? null,
      start_date: booking.start_date,
      end_date: booking.end_date,
      pickup_location: booking.pickup_location,
      status: booking.status,
      pricing_json: booking.pricing_json,
      payment_option: paymentSummary.paymentOption,
      payment_status: paymentSummary.paymentStatus,
      amount_paid: paymentSummary.netPaidToDate,
      balance_due: paymentSummary.balanceDue,
      non_blocking: isNonBlockingPricing(pricing),
      overridden_by_booking_id: overrideInfo.overriddenByBookingId,
      overridden_at: overrideInfo.overriddenAt,
      override_reason: overrideInfo.overrideReason,
    },
    customer: {
      full_name: booking.customer_name,
      email: booking.customer_email,
      phone: booking.customer_phone,
    },
    vehicle: {
      make: booking.vehicle_make,
      model: booking.vehicle_model,
      year: booking.vehicle_year,
    },
    payments: paymentsResult.rows,
  });
}

export async function GET(request: Request, context: BookingByIdRouteContext) {
  return handleAdminBookingByIdGet(request, context);
}

type PickupActionBookingRow = {
  status: string;
  start_date: string;
  end_date: string;
  pickup_location: string;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  pricing_json: Record<string, unknown> | null;
  daily_rate_cents: number;
  deposit_cents: number;
};

export type AdminBookingPickupActionDeps = {
  query: typeof dbQuery;
  fetchNetPaid: typeof fetchNetPaidToDate;
  hasCompletedPickupInspection: typeof hasCompletedBookingVehicleInspection;
  writeAudit: typeof writeAuditLog;
  sendPickupConfirmed: typeof sendPickupConfirmedEmail;
};

const DEFAULT_BOOKING_PICKUP_ACTION_DEPS: AdminBookingPickupActionDeps = {
  query: dbQuery,
  fetchNetPaid: fetchNetPaidToDate,
  hasCompletedPickupInspection: hasCompletedBookingVehicleInspection,
  writeAudit: writeAuditLog,
  sendPickupConfirmed: sendPickupConfirmedEmail,
};

export async function handleAdminBookingPickupAction(
  bookingId: string,
  session: AdminSession,
  deps: Partial<AdminBookingPickupActionDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_BOOKING_PICKUP_ACTION_DEPS, ...deps };
  const bookingResult = await resolvedDeps.query<PickupActionBookingRow>(
    "select b.status, b.start_date, b.end_date, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [bookingId],
  );

  if (bookingResult.rowCount === 0) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const booking = bookingResult.rows[0];
  const statusUpper = booking.status.toUpperCase();

  if (statusUpper === "PICKED_UP") {
    return NextResponse.json({ ok: true, message: "Booking is already marked as picked up." });
  }

  if (statusUpper !== "CONFIRMED") {
    return NextResponse.json(
      { error: "Only confirmed bookings can be marked as picked up." },
      { status: 400 },
    );
  }

  const pricing = booking.pricing_json ?? {};
  const netPaidToDate = await resolvedDeps.fetchNetPaid(bookingId);
  const paymentSummary = computeBookingPricingFromStoredSnapshot({
    bookingId,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    pricing,
    fallbackDailyRate: booking.daily_rate_cents,
    fallbackDeposit: booking.deposit_cents,
    netPaidToDate,
  });

  if (paymentSummary.paymentStatus !== "PAID_IN_FULL" || paymentSummary.balanceDue > 0) {
    return NextResponse.json(
      { error: "Booking must be fully paid before pickup." },
      { status: 400 },
    );
  }

  const hasCompletedInspection = await resolvedDeps.hasCompletedPickupInspection(
    bookingId,
    "PICKUP",
  );
  if (!hasCompletedInspection) {
    return NextResponse.json(
      { error: "Complete the pickup inspection in Vehicle Inspection before confirming pickup." },
      { status: 400 },
    );
  }

  await resolvedDeps.query("update bookings set status = 'PICKED_UP', updated_at = now() where id = $1", [
    bookingId,
  ]);

  await resolvedDeps.writeAudit({
    userId: session.userId,
    action: "BOOKING_PICKED_UP",
    entityType: "booking",
    entityId: bookingId,
    details: {
      previous_status: booking.status,
      net_paid_to_date: paymentSummary.netPaidToDate,
      balance_due: paymentSummary.balanceDue,
      pickup_inspection_completed: true,
    },
  });

  const pickupEmailResult = await resolvedDeps.sendPickupConfirmed({
    bookingId,
    customerEmail: booking.customer_email,
    customerName: booking.customer_name,
    vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
    startDate: booking.start_date,
    endDate: booking.end_date,
    pickupLocation: booking.pickup_location,
    paidToDate: paymentSummary.netPaidToDate,
    balanceDue: paymentSummary.balanceDue,
    dispatch: {
      triggerSource: "admin_pickup",
      metadata: {
        bookingId,
        bookingReference: null,
      },
    },
  });
  if (!pickupEmailResult.ok) {
    logWarn("admin.booking-pickup.email_failed", {
      bookingId,
      recipientEmail: booking.customer_email,
      error: pickupEmailResult.error ?? "delivery failed",
    });
  }

  return NextResponse.json({ ok: true, message: "Booking marked as picked up." });
}

type CompleteActionBookingRow = {
  status: string;
};

export type AdminBookingCompleteActionDeps = {
  query: typeof dbQuery;
  hasCompletedReturnInspection: typeof hasCompletedBookingVehicleInspection;
  writeAudit: typeof writeAuditLog;
};

const DEFAULT_BOOKING_COMPLETE_ACTION_DEPS: AdminBookingCompleteActionDeps = {
  query: dbQuery,
  hasCompletedReturnInspection: hasCompletedBookingVehicleInspection,
  writeAudit: writeAuditLog,
};

export async function handleAdminBookingCompleteAction(
  bookingId: string,
  session: AdminSession,
  deps: Partial<AdminBookingCompleteActionDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_BOOKING_COMPLETE_ACTION_DEPS, ...deps };
  const bookingResult = await resolvedDeps.query<CompleteActionBookingRow>(
    "select status from bookings where id = $1",
    [bookingId],
  );

  if (bookingResult.rowCount === 0) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const booking = bookingResult.rows[0];
  const statusUpper = booking.status.toUpperCase();

  if (statusUpper === "RETURNED") {
    return NextResponse.json({ ok: true, message: "Booking is already marked as completed." });
  }

  if (statusUpper !== "PICKED_UP") {
    return NextResponse.json(
      { error: "Only picked-up bookings can be completed." },
      { status: 400 },
    );
  }

  const hasCompletedInspection = await resolvedDeps.hasCompletedReturnInspection(
    bookingId,
    "RETURN",
  );
  if (!hasCompletedInspection) {
    return NextResponse.json(
      { error: "Complete the return inspection in Vehicle Inspection before completing the booking." },
      { status: 400 },
    );
  }

  try {
    await resolvedDeps.query(
      "update bookings set status = 'RETURNED', archived_at = now(), archived_by_user_id = $2, archived_reason = $3, updated_at = now() where id = $1",
      [bookingId, session.userId, "Completed/Returned"],
    );
  } catch (error) {
    if (isUndefinedColumn(error, "archived_at")) {
      await resolvedDeps.query("update bookings set status = 'RETURNED', updated_at = now() where id = $1", [
        bookingId,
      ]);
    } else {
      throw error;
    }
  }

  await resolvedDeps.writeAudit({
    userId: session.userId,
    action: "BOOKING_COMPLETED",
    entityType: "booking",
    entityId: bookingId,
    details: {
      previous_status: booking.status,
      return_inspection_completed: true,
    },
  });

  await resolvedDeps.writeAudit({
    userId: session.userId,
    action: "BOOKING_ARCHIVED",
    entityType: "booking",
    entityId: bookingId,
    details: { reason: "Completed/Returned" },
  });

  return NextResponse.json({ ok: true, message: "Booking completed." });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }
  const action = typeof body?.action === "string" ? body.action : "";

  if (!action) {
    return NextResponse.json({ error: "Action is required" }, { status: 400 });
  }

  if (action === "confirm") {
    const bookingResult = await dbQuery<{ status: string }>(
      "select status from bookings where id = $1",
      [id],
    );

    if (bookingResult.rowCount === 0) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const status = bookingResult.rows[0].status;
    if (!["PENDING_PAYMENT", "PENDING"].includes(status)) {
      return NextResponse.json({ error: "Booking cannot be confirmed" }, { status: 400 });
    }

    await dbQuery("update bookings set status = 'CONFIRMED', updated_at = now() where id = $1", [
      id,
    ]);

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_CONFIRMED",
      entityType: "booking",
      entityId: id,
      details: { previous_status: status },
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "complete") {
    return handleAdminBookingCompleteAction(id, session);
  }

  if (action === "pickup") {
    return handleAdminBookingPickupAction(id, session);
  }

  if (action === "archive") {
    if (!isAdminRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "Reason is required" }, { status: 400 });
    }

    try {
      await dbQuery(
        "update bookings set archived_at = now(), archived_by_user_id = $2, archived_reason = $3, updated_at = now() where id = $1",
        [id, session.userId, reason],
      );
    } catch (error) {
      if (isUndefinedColumn(error, "archived_at")) {
        return NextResponse.json(
          { error: "ARCHIVE_NOT_CONFIGURED", message: "Archive columns are missing. Apply schema.sql changes." },
          { status: 500 },
        );
      }
      throw error;
    }

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_ARCHIVED",
      entityType: "booking",
      entityId: id,
      details: { reason },
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "unarchive") {
    if (!isAdminRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      await dbQuery(
        "update bookings set archived_at = null, archived_by_user_id = null, archived_reason = null, updated_at = now() where id = $1",
        [id],
      );
    } catch (error) {
      if (isUndefinedColumn(error, "archived_at")) {
        return NextResponse.json(
          { error: "ARCHIVE_NOT_CONFIGURED", message: "Archive columns are missing. Apply schema.sql changes." },
          { status: 500 },
        );
      }
      throw error;
    }

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_UNARCHIVED",
      entityType: "booking",
      entityId: id,
      details: {},
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "hard_delete") {
    if (!isDeveloperRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "Reason is required" }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query("begin");

      const bookingResult = (await client.query(
        "select id, public_id, status, archived_at from bookings where id = $1 for update",
        [id],
      )) as {
        rows: Array<{
          id: string;
          public_id: string | null;
          status: string;
          archived_at: string | null;
        }>;
        rowCount: number;
      };

      if (bookingResult.rowCount === 0) {
        await client.query("rollback");
        return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      }

      const booking = bookingResult.rows[0];
      if (!booking.archived_at) {
        await client.query("rollback");
        return NextResponse.json(
          { error: "Only archived bookings can be hard deleted" },
          { status: 400 },
        );
      }

      await client.query(
        "delete from notification_dispatch_log where entity_type = 'booking' and entity_id = $1",
        [id],
      );
      await client.query(
        "delete from audit_logs where entity_type = 'booking' and entity_id = $1",
        [id],
      );
      await client.query("delete from bookings where id = $1", [id]);

      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "BOOKING_HARD_DELETED",
        entityType: "booking",
        entityId: id,
        details: {
          public_id: booking.public_id,
          previous_status: booking.status,
          reason,
        },
      });

      return NextResponse.json({ ok: true });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  if (action === "update_details") {
    const startDate = normalizeDateInput(body?.startDate);
    const endDate = normalizeDateInput(body?.endDate);
    const pickupTime = normalizeTimeInput(body?.pickupTime) ?? "11:00";
    const dropoffTime = normalizeTimeInput(body?.dropoffTime) ?? "11:00";
    const customerName = typeof body?.customerName === "string" ? body.customerName.trim() : "";
    const customerEmail = typeof body?.customerEmail === "string" ? body.customerEmail.trim() : "";
    const customerPhone = typeof body?.customerPhone === "string" ? body.customerPhone.trim() : "";
    const bookingLocationDetailsRaw = asObject(body?.bookingLocationDetails);
    const pickupLocationDetailsRaw = asObject(bookingLocationDetailsRaw?.pickup);
    const dropoffLocationDetailsRaw = asObject(bookingLocationDetailsRaw?.dropoff);
    const pickupLocationType =
      typeof body?.pickupLocationType === "string" && body.pickupLocationType.trim()
        ? body.pickupLocationType.trim().toUpperCase()
        : "OFFICE";
    const dropoffLocationType =
      typeof body?.dropoffLocationType === "string" && body.dropoffLocationType.trim()
        ? body.dropoffLocationType.trim().toUpperCase()
        : pickupLocationType;
    const pickupLocationId =
      typeof body?.pickupLocationId === "string" && body.pickupLocationId.trim()
        ? body.pickupLocationId.trim()
        : null;
    const dropoffLocationId =
      typeof body?.dropoffLocationId === "string" && body.dropoffLocationId.trim()
        ? body.dropoffLocationId.trim()
        : null;

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "Valid start and end dates are required" }, { status: 400 });
    }

    if (endDate <= startDate) {
      return NextResponse.json({ error: "End date must be after start date" }, { status: 400 });
    }

    if (!customerName) {
      return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
    }

    if (!customerEmail || !customerEmail.includes("@")) {
      return NextResponse.json({ error: "Valid customer email is required" }, { status: 400 });
    }

    if (!customerPhone) {
      return NextResponse.json({ error: "Customer phone is required" }, { status: 400 });
    }

    if (pickupLocationId && !/^[0-9a-f-]{36}$/i.test(pickupLocationId)) {
      return NextResponse.json({ error: "Invalid pickup location" }, { status: 400 });
    }
    if (dropoffLocationId && !/^[0-9a-f-]{36}$/i.test(dropoffLocationId)) {
      return NextResponse.json({ error: "Invalid dropoff location" }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query("begin");

      const bookingResult = await client.query(
        "select b.id, b.public_id, b.customer_id, b.vehicle_id, b.status, b.start_date, b.end_date, b.start_at, b.end_at, b.pickup_time::text as pickup_time, b.dropoff_time::text as dropoff_time, b.pickup_location, b.dropoff_location, b.pickup_location_id, b.dropoff_location_id, b.pickup_location_text_snapshot, b.dropoff_location_text_snapshot, b.pricing_json, b.drivers_license_number, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, c.legal_id_number as customer_legal_id_number from bookings b join vehicles v on v.id = b.vehicle_id join customers c on c.id = b.customer_id where b.id = $1 for update",
        [id],
      );

      if (bookingResult.rowCount === 0) {
        await client.query("rollback");
        return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      }

      const booking = bookingResult.rows[0] as {
        id: string;
        public_id: string | null;
        customer_id: string;
        vehicle_id: string;
        status: string;
        start_date: string;
        end_date: string;
        start_at: string | null;
        end_at: string | null;
        pickup_time: string | null;
        dropoff_time: string | null;
        pickup_location: string;
        dropoff_location: string | null;
        pickup_location_id: string | null;
        dropoff_location_id: string | null;
        pickup_location_text_snapshot: string | null;
        dropoff_location_text_snapshot: string | null;
        pricing_json: Record<string, unknown> | null;
        drivers_license_number: string | null;
        vehicle_make: string;
        vehicle_model: string;
        vehicle_year: number;
        daily_rate_cents: number;
        deposit_cents: number;
        customer_name: string;
        customer_email: string;
        customer_phone: string;
        customer_legal_id_number: string | null;
      };
      if (["RETURNED", "CANCELLED"].includes(booking.status)) {
        await client.query("rollback");
        return NextResponse.json(
          { error: "Cancelled or returned bookings cannot be updated" },
          { status: 400 },
        );
      }

      const startAtIso = buildDateTimeIso(startDate, pickupTime);
      const endAtIso = buildDateTimeIso(endDate, dropoffTime);
      if (!startAtIso || !endAtIso) {
        await client.query("rollback");
        return NextResponse.json({ error: "Valid pickup and dropoff times are required" }, { status: 400 });
      }

      const currentPricing = booking.pricing_json ?? {};
      const currentLocationDetails = readBookingLocationDetails(currentPricing, {
        pickupLabel:
          booking.pickup_location_text_snapshot || booking.pickup_location,
        dropoffLabel:
          booking.dropoff_location_text_snapshot ||
          booking.dropoff_location ||
          booking.pickup_location,
        pickupLocationId: booking.pickup_location_id,
        dropoffLocationId: booking.dropoff_location_id,
      });
      const bookingLocationConfigs = await listActiveBookingLocationConfigs(client);
      const locationSelection = buildBookingLocationSelectionPayload({
        configs: bookingLocationConfigs,
        pickupTypeKey: pickupLocationType || currentLocationDetails.pickup.typeKey,
        dropoffTypeKey: dropoffLocationType || currentLocationDetails.dropoff.typeKey,
        pickupLocationId: pickupLocationId ?? booking.pickup_location_id,
        dropoffLocationId: dropoffLocationId ?? booking.dropoff_location_id,
        pickupValues: normalizeBookingLocationFieldValuesInput(
          pickupLocationDetailsRaw?.values,
          currentLocationDetails.pickup.values,
        ),
        dropoffValues: normalizeBookingLocationFieldValuesInput(
          dropoffLocationDetailsRaw?.values,
          currentLocationDetails.dropoff.values,
        ),
        context: {
          pickupDate: startDate,
          pickupTime,
          dropoffDate: endDate,
          dropoffTime,
        },
      });

      const pickupLocationError = validateBookingLocationSelection(
        locationSelection.pickupConfig,
        "pickup",
        locationSelection.pickupValues,
      );
      if (pickupLocationError) {
        await client.query("rollback");
        return NextResponse.json({ error: pickupLocationError }, { status: 400 });
      }

      const dropoffLocationError = validateBookingLocationSelection(
        locationSelection.dropoffConfig,
        "dropoff",
        locationSelection.dropoffValues,
      );
      if (dropoffLocationError) {
        await client.query("rollback");
        return NextResponse.json({ error: dropoffLocationError }, { status: 400 });
      }

      const availabilityWindow = buildWindowFromDates(
        startDate,
        endDate,
        pickupTime,
        dropoffTime,
      );
      if (!availabilityWindow) {
        await client.query("rollback");
        return NextResponse.json(
          { error: "Vehicle is no longer available for the updated dates" },
          { status: 409 },
        );
      }

      const isUnavailable = await isVehicleUnavailableEntitlementBased(
        booking.vehicle_id,
        availabilityWindow,
        { client, excludeBookingId: booking.id },
      );
      if (isUnavailable) {
        await client.query("rollback");
        return NextResponse.json(
          { error: "Vehicle is no longer available for the updated dates" },
          { status: 409 },
        );
      }

      const dailyRate = Number(currentPricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
      const deposit = Number(currentPricing.deposit_cents ?? booking.deposit_cents ?? 0);
      const paymentOption = readPaymentOption(currentPricing);
      const { promoCode: existingPromoCode } = readPromoPricingFields(currentPricing);
      const netPaidToDate = await fetchNetPaidToDate(booking.id, { client });
      const provisionalSummary = computeBookingPricing({
        bookingId: booking.id,
        bookingStatus: booking.status,
        startDate,
        endDate,
        dailyRate,
        deposit,
        paymentOption,
        netPaidToDate,
        promoCode: null,
        promoDiscount: 0,
      });
      const validatedPromo = await resolveValidatedPromoForBookingUpdate({
        client,
        existingPromoCode,
        vehicleId: booking.vehicle_id,
        startDate,
        endDate,
        subtotalCents: provisionalSummary.subtotal,
        baseTotalCents: provisionalSummary.baseTotal,
        customerId: booking.customer_id,
        customerEmail,
      });
      const pricingSummary = computeBookingPricing({
        bookingId: booking.id,
        bookingStatus: booking.status,
        startDate,
        endDate,
        dailyRate,
        deposit,
        paymentOption,
        netPaidToDate,
        promoCode: validatedPromo.promoCode,
        promoDiscount: validatedPromo.promoDiscount,
      });

      const nextLocationDetails = locationSelection.details;
      const nextPricingBase = {
        ...currentPricing,
        customer_name_snapshot: customerName,
        customer_email_snapshot: customerEmail,
        customer_phone_snapshot: customerPhone,
        booking_location_details: nextLocationDetails,
        days: pricingSummary.days,
        daily_rate_cents: pricingSummary.dailyRate,
        deposit_cents: pricingSummary.deposit,
        subtotal_cents: pricingSummary.subtotal,
        promo_code: pricingSummary.promoCode,
        promo_code_id: validatedPromo.promoId,
        promo_discount_cents: pricingSummary.promoDiscount,
        total_cents: pricingSummary.total,
        total_amount: pricingSummary.total,
        paid_to_date: pricingSummary.netPaidToDate,
        amount_paid: pricingSummary.netPaidToDate,
        balance_due: pricingSummary.balanceDue,
        payment_status: pricingSummary.paymentStatus,
        payment_option_selected: pricingSummary.paymentOption,
        refund_required: pricingSummary.refundRequired,
      };
      const locationDetailsChanged =
        JSON.stringify(currentLocationDetails) !== JSON.stringify(nextLocationDetails);
      const nextPricing = locationDetailsChanged
        ? appendBookingLocationNote(nextPricingBase, nextLocationDetails)
        : nextPricingBase;

      const customerSyncResult = await synchronizeCustomerContact(client, booking.customer_id, {
        fullName: customerName,
        email: customerEmail,
        phone: customerPhone,
      });

      await client.query(
        "update bookings set start_date = $2, end_date = $3, pickup_time = $4::time, dropoff_time = $5::time, start_at = $6::timestamptz, end_at = $7::timestamptz, pickup_location = $8, dropoff_location = $9, pickup_location_id = $10::uuid, dropoff_location_id = $11::uuid, pickup_location_text_snapshot = $12, dropoff_location_text_snapshot = $13, pricing_json = $14::jsonb, updated_at = now() where id = $1",
        [
          booking.id,
          startDate,
          endDate,
          pickupTime,
          dropoffTime,
          startAtIso,
          endAtIso,
          locationSelection.pickupLocationTextSnapshot,
          locationSelection.dropoffLocationTextSnapshot,
          locationSelection.pickupConfig?.id ?? booking.pickup_location_id,
          locationSelection.dropoffConfig?.id ?? booking.dropoff_location_id,
          locationSelection.pickupLocationTextSnapshot,
          locationSelection.dropoffLocationTextSnapshot,
          JSON.stringify(nextPricing),
        ],
      );
      await syncPromoRedemptionStateForBooking(booking.id, {
        client,
        source: "admin_booking_update_details",
      });

      let privateDocs: { rows: Array<{ document_type: string }>; rowCount: number } = {
        rows: [],
        rowCount: 0,
      };
      try {
        privateDocs = (await client.query(
          "select distinct document_type from booking_private_files where booking_id = $1",
          [booking.id],
        )) as { rows: Array<{ document_type: string }>; rowCount: number };
      } catch (privateDocsError) {
        const code = (privateDocsError as { code?: string } | null)?.code;
        if (!(code === "42P01" || isUndefinedColumn(privateDocsError, "booking_private_files"))) {
          throw privateDocsError;
        }
      }

      let paymentsResult;
      try {
        paymentsResult = await client.query(
          "select id, public_id, provider, status, deposit_amount_cents, currency, created_at, metadata_json, deleted_at, deleted_reason from payments where booking_id = $1 order by created_at desc",
          [booking.id],
        );
      } catch (paymentsError) {
        if (isUndefinedColumn(paymentsError, "deleted_at") || isUndefinedColumn(paymentsError, "public_id")) {
          paymentsResult = await client.query(
            "select id, id as public_id, provider, status, deposit_amount_cents, currency, created_at, metadata_json from payments where booking_id = $1 order by created_at desc",
            [booking.id],
          );
        } else {
          throw paymentsError;
        }
      }

      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "BOOKING_UPDATED",
        entityType: "booking",
        entityId: id,
        details: {
          previous_start_date: booking.start_date,
          previous_end_date: booking.end_date,
          previous_pickup_time: booking.pickup_time,
          previous_dropoff_time: booking.dropoff_time,
          previous_pickup_location:
            booking.pickup_location_text_snapshot || booking.pickup_location,
          previous_dropoff_location:
            booking.dropoff_location_text_snapshot ||
            booking.dropoff_location ||
            booking.pickup_location,
          previous_customer_name: booking.customer_name,
          previous_customer_email: booking.customer_email,
          previous_customer_phone: booking.customer_phone,
          next_start_date: startDate,
          next_end_date: endDate,
          next_pickup_time: pickupTime,
          next_dropoff_time: dropoffTime,
          next_pickup_location: locationSelection.pickupLocationTextSnapshot,
          next_dropoff_location: locationSelection.dropoffLocationTextSnapshot,
          next_customer_name: customerName,
          next_customer_email: customerEmail,
          next_customer_phone: customerPhone,
          synchronized_booking_count: customerSyncResult.synchronizedBookingCount,
          total: pricingSummary.total,
          balance_due: pricingSummary.balanceDue,
          refund_required: pricingSummary.refundRequired,
        },
      });

      const payments = paymentsResult.rows as AdminBookingPaymentRow[];
      const hasDriversLicenseDoc = privateDocs.rows.some(
        (row) => row.document_type === "DRIVERS_LICENSE",
      );
      const hasSignatureDoc = privateDocs.rows.some((row) => row.document_type === "SIGNATURE");
      const nextDisplayStatus = formatBookingStatusLabel(
        booking.status,
        pricingSummary.paymentStatus,
      ).toUpperCase();
      const nextEntitlementState = isEntitledBooking({
        status: booking.status,
        paymentStatus: pricingSummary.paymentStatus,
        paidToDate: pricingSummary.netPaidToDate,
        depositRequired: pricingSummary.depositRequired,
      })
        ? "ENTITLED"
        : "TENTATIVE";
      const nextPickupDateTimeLabel = buildAdminBookingDateTimeLabel({
        date: startDate,
        time: pickupTime,
        at: startAtIso,
      });
      const nextDropoffDateTimeLabel = buildAdminBookingDateTimeLabel({
        date: endDate,
        time: dropoffTime,
        at: endAtIso,
      });
      const nextDepositDue = Math.max(
        0,
        Math.max(0, pricingSummary.deposit) - Math.max(0, pricingSummary.netPaidToDate),
      );
      const nextIsPaidInFull = pricingSummary.paymentStatus === "PAID_IN_FULL";
      const nextIsDepositPaid =
        pricingSummary.deposit > 0
          ? pricingSummary.netPaidToDate >= pricingSummary.deposit
          : pricingSummary.netPaidToDate > 0;
      const nextOverrideInfo = readBookingOverrideInfo(nextPricing);
      const nextIsNonBlocking =
        isNonBlockingBookingHold({
          paymentStatus: pricingSummary.paymentStatus,
          amountPaid: pricingSummary.netPaidToDate,
          holdMinimumAmount: pricingSummary.deposit,
        }) && !["CANCELLED", "RETURNED"].includes(booking.status.toUpperCase());
      const nextNotes = buildAdminBookingNotes(
        Array.isArray((nextPricing as { admin_notes?: AdminBookingNote[] }).admin_notes)
          ? [...((nextPricing as { admin_notes: AdminBookingNote[] }).admin_notes as AdminBookingNote[])]
          : [],
        payments,
      );
      const nextCustomPaymentAmount = Number(
        (nextPricing as Record<string, unknown>).custom_payment_amount_cents ?? 0,
      );
      const nextInsurancePricePerDay = Number(
        (nextPricing as Record<string, unknown>).insurance_price_per_day_cents ?? 0,
      );
      const nextInsuranceTotal = Number(
        (nextPricing as Record<string, unknown>).insurance_total_cents ?? 0,
      );
      let isPickupInspectionComplete = false;
      try {
        isPickupInspectionComplete = await hasCompletedBookingVehicleInspection(booking.id, "PICKUP");
      } catch (error) {
        if (!isBookingVehicleInspectionMissingTableError(error)) {
          throw error;
        }
      }
      const bookingPublicId = String(booking.public_id ?? "").trim() || booking.id;
      const vehicleLabel = `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim();
      const bookingDetail = buildAdminBookingDetailView({
        versionKey: `${booking.id}:${Date.now()}`,
        bookingId: booking.id,
        bookingPublicId,
        bookingStatus: booking.status,
        displayStatus: nextDisplayStatus,
        isNonBlocking: nextIsNonBlocking,
        isOverridden: nextOverrideInfo.isOverridden,
        isPaidInFull: nextIsPaidInFull,
        isDepositPaid: nextIsDepositPaid,
        isPickupInspectionComplete,
        vehicleId: booking.vehicle_id,
        vehicleLabel,
        initialPromoCode: pricingSummary.promoCode,
        initialInsuranceSelected: pricingSummary.insuranceSelected,
        entitlement: nextEntitlementState,
        paymentOptionLabel: pricingSummary.paymentOption.replace(/_/g, " "),
        customPaymentAmountCents:
          pricingSummary.paymentOption === "CUSTOM" ? nextCustomPaymentAmount : null,
        cancellationReason: nextOverrideInfo.isOverridden
          ? nextOverrideInfo.overrideReason || "LOST_TO_FIRST_DEPOSIT"
          : null,
        pickupDateTimeLabel: nextPickupDateTimeLabel,
        dropoffDateTimeLabel: nextDropoffDateTimeLabel,
        pickupLocationSnapshot: locationSelection.pickupLocationTextSnapshot,
        dropoffLocationSnapshot: locationSelection.dropoffLocationTextSnapshot,
        bookingLocationDetails: nextLocationDetails,
        customerName,
        customerEmail,
        customerPhone,
        driversLicenseNumber:
          booking.drivers_license_number || booking.customer_legal_id_number,
        hasDriversLicenseDoc,
        hasSignatureDoc,
        days: pricingSummary.days,
        paidToDate: pricingSummary.netPaidToDate,
        totalBeforePromo: pricingSummary.subtotal,
        total: pricingSummary.total,
        insuranceSelected: pricingSummary.insuranceSelected,
        paymentOption: pricingSummary.paymentOption,
        paymentStatus: pricingSummary.paymentStatus,
        dailyRate: pricingSummary.dailyRate,
        insurancePricePerDay: nextInsurancePricePerDay,
        insuranceTotal: nextInsuranceTotal,
        promoCode: pricingSummary.promoCode,
        promoTotal: Math.max(0, pricingSummary.promoDiscount),
        depositDue: nextDepositDue,
        balanceDue: pricingSummary.balanceDue,
        refundRequired: pricingSummary.refundRequired,
        notes: nextNotes,
        form: {
          startDate,
          endDate,
          pickupTime,
          dropoffTime,
          customerName,
          customerEmail,
          customerPhone,
          pickupLocationTypeKey: nextLocationDetails.pickup.typeKey,
          dropoffLocationTypeKey: nextLocationDetails.dropoff.typeKey,
          pickupLocationValues: nextLocationDetails.pickup.values,
          dropoffLocationValues: nextLocationDetails.dropoff.values,
          disabled: ["RETURNED", "CANCELLED"].includes(booking.status.toUpperCase()),
        },
      });

      return NextResponse.json({
        ok: true,
        message: "Booking updated and repriced successfully.",
        bookingDetail,
      });
    } catch (error) {
      await client.query("rollback");
      const schemaError = toBookingLocationConfigSchemaError(error);
      if (schemaError) {
        return NextResponse.json(
          { error: schemaError.message, code: schemaError.code },
          { status: schemaError.status },
        );
      }
      return NextResponse.json({ error: "Failed to update booking details" }, { status: 500 });
    } finally {
      client.release();
    }
  }

  if (action === "set_insurance") {
    const enableInsurance = body?.enabled === true;
    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query("begin");

      const bookingResult = (await client.query(
        "select b.id, b.status, b.vehicle_id, b.customer_id, c.email as customer_email, b.start_date, b.end_date, b.pricing_json, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1 for update",
        [id],
      )) as {
        rowCount: number;
        rows: Array<{
          id: string;
          status: string;
          vehicle_id: string;
          customer_id: string;
          customer_email: string;
          start_date: string;
          end_date: string;
          pricing_json: Record<string, unknown> | null;
          daily_rate_cents: number;
          deposit_cents: number;
        }>;
      };

      if (bookingResult.rowCount === 0) {
        await client.query("rollback");
        return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      }

      const booking = bookingResult.rows[0];
      if (["CANCELLED", "RETURNED"].includes(String(booking.status).toUpperCase())) {
        await client.query("rollback");
        return NextResponse.json(
          { error: "Insurance cannot be changed for this booking." },
          { status: 400 },
        );
      }

      let insurancePlanId: string | null = null;
      let insurancePricePerDay = 0;

      if (enableInsurance) {
        const globalPlanResult = (await client.query(
          "select id, is_enabled, price_per_day_cents from insurance_plans where is_global_default = true and is_enabled = true order by updated_at desc limit 1",
        )) as {
          rows: Array<{
            id: string;
            is_enabled: boolean;
            price_per_day_cents: number;
          }>;
        };
        let resolvedPlan = globalPlanResult.rows[0] ?? null;
        if (!resolvedPlan) {
          const vehiclePlanResult = (await client.query(
            "select id, is_enabled, price_per_day_cents from insurance_plans where vehicle_id = $1 and is_enabled = true order by updated_at desc limit 1",
            [booking.vehicle_id],
          )) as {
            rows: Array<{
              id: string;
              is_enabled: boolean;
              price_per_day_cents: number;
            }>;
          };
          resolvedPlan = vehiclePlanResult.rows[0] ?? null;
        }

        if (!resolvedPlan || !resolvedPlan.is_enabled) {
          await client.query("rollback");
          return NextResponse.json(
            { error: "No active insurance plan is configured for this vehicle." },
            { status: 400 },
          );
        }

        insurancePlanId = resolvedPlan.id;
        insurancePricePerDay = Math.max(0, Number(resolvedPlan.price_per_day_cents ?? 0));
      }

      const currentPricing = booking.pricing_json ?? {};
      const paymentOption = readPaymentOption(currentPricing);
      const { promoCode: existingPromoCode } = readPromoPricingFields(currentPricing);
      const netPaidToDate = await fetchNetPaidToDate(booking.id, { client });

      const provisionalSummary = computeBookingPricingFromStoredSnapshot({
        bookingId: booking.id,
        bookingStatus: booking.status,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pricing: currentPricing,
        fallbackDailyRate: booking.daily_rate_cents,
        fallbackDeposit: booking.deposit_cents,
        paymentOption,
        netPaidToDate,
        promoCode: null,
        promoDiscount: 0,
        insuranceSelected: enableInsurance,
        insurancePricePerDay,
      });

      const validatedPromo = await resolveValidatedPromoForBookingUpdate({
        client,
        existingPromoCode,
        vehicleId: booking.vehicle_id,
        startDate: booking.start_date,
        endDate: booking.end_date,
        subtotalCents: provisionalSummary.subtotal,
        baseTotalCents: provisionalSummary.baseTotal,
        customerId: booking.customer_id,
        customerEmail: booking.customer_email,
      });

      const nextSummary = computeBookingPricingFromStoredSnapshot({
        bookingId: booking.id,
        bookingStatus: booking.status,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pricing: currentPricing,
        fallbackDailyRate: booking.daily_rate_cents,
        fallbackDeposit: booking.deposit_cents,
        paymentOption,
        netPaidToDate,
        promoCode: validatedPromo.promoCode,
        promoDiscount: validatedPromo.promoDiscount,
        insuranceSelected: enableInsurance,
        insurancePricePerDay,
      });

      const nextPricing = buildPricingSnapshot(currentPricing, nextSummary, validatedPromo.promoId);

      await client.query(
        "update bookings set insurance_selected = $2, insurance_plan_id = $3::uuid, insurance_price_per_day_cents = $4, insurance_total_cents = $5, pricing_json = $6, updated_at = now() where id = $1",
        [
          booking.id,
          nextSummary.insuranceSelected,
          insurancePlanId,
          nextSummary.insurancePricePerDay,
          nextSummary.insuranceTotal,
          nextPricing,
        ],
      );
      await syncPromoRedemptionStateForBooking(booking.id, {
        client,
        source: "admin_booking_update_insurance",
      });

      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "BOOKING_INSURANCE_UPDATED",
        entityType: "booking",
        entityId: id,
        details: {
          insurance_selected: nextSummary.insuranceSelected,
          insurance_plan_id: insurancePlanId,
          insurance_price_per_day_cents: nextSummary.insurancePricePerDay,
          insurance_total_cents: nextSummary.insuranceTotal,
          promo_code: nextSummary.promoCode,
          promo_discount_cents: nextSummary.promoDiscount,
          total_cents: nextSummary.total,
          balance_due_cents: nextSummary.balanceDue,
        },
      });

      return NextResponse.json({
        ok: true,
        message: nextSummary.insuranceSelected ? "Insurance applied." : "Insurance removed.",
        summary: mapSummaryForResponse(nextSummary),
      });
    } catch (error) {
      await client.query("rollback");
      const code = (error as { code?: string } | null)?.code;
      if (
        code === "42P01" ||
        isUndefinedColumn(error, "insurance_selected") ||
        isUndefinedColumn(error, "insurance_plans")
      ) {
        return NextResponse.json(
          { error: "Insurance configuration is not available yet in this environment." },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: "Failed to update insurance for this booking." }, { status: 500 });
    } finally {
      client.release();
    }
  }

  if (action === "add_note") {
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!note) {
      return NextResponse.json({ error: "Note is required" }, { status: 400 });
    }

    const noteEmailTarget = normalizeNoteTarget(body?.noteEmailTarget);
    const noteSendMode = noteEmailTarget === "none" ? null : normalizeNoteSendMode(body?.noteSendMode);
    const noteScheduledForRaw =
      noteSendMode === "scheduled" && typeof body?.noteScheduledFor === "string"
        ? body.noteScheduledFor
        : null;
    let noteScheduledFor: string | null = null;
    if (noteSendMode === "scheduled") {
      if (!noteScheduledForRaw) {
        return NextResponse.json(
          { error: "Choose a date/time for the scheduled note email." },
          { status: 400 },
        );
      }
      const scheduledDate = new Date(noteScheduledForRaw);
      if (Number.isNaN(scheduledDate.getTime())) {
        return NextResponse.json({ error: "Invalid scheduled date/time." }, { status: 400 });
      }
      noteScheduledFor = scheduledDate.toISOString();
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query("begin");

      const bookingResult = (await client.query(
        "select b.pricing_json, b.start_date, b.end_date, b.pickup_location, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1 for update",
        [id],
      )) as {
        rows: Array<{
          pricing_json: Record<string, unknown> | null;
          start_date: string;
          end_date: string;
          pickup_location: string;
          customer_name: string;
          customer_email: string;
          vehicle_make: string;
          vehicle_model: string;
          vehicle_year: number;
        }>;
        rowCount: number;
      };

      if (bookingResult.rowCount === 0) {
        await client.query("rollback");
        return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      }

      const booking = bookingResult.rows[0];
      const pricing = booking.pricing_json ?? {};
      const existingNotes = Array.isArray((pricing as { admin_notes?: unknown }).admin_notes)
        ? ((pricing as { admin_notes: unknown[] }).admin_notes as unknown[])
        : [];

      const createdAt = new Date().toISOString();
      const emailErrors: string[] = [];
      const sentTargets: ("customer" | "internal")[] = [];

      const newNote: Record<string, unknown> = {
        note_id: crypto.randomUUID(),
        message: note,
        created_at: createdAt,
        user_id: session.userId,
        email_target: noteEmailTarget,
        email_send_mode: noteSendMode,
        email_scheduled_for: noteScheduledFor,
        email_customer_sent_at: null,
        email_internal_sent_at: null,
        email_cancelled_at: null,
        email_cancelled_by: null,
        email_cancel_reason: null,
        email_last_error: null,
      };

      const vehicleLabel = `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim();

      if (noteEmailTarget !== "none" && noteSendMode === "immediate") {
        if (noteEmailTarget === "customer" || noteEmailTarget === "both") {
          try {
            const customerSend = await sendBookingNoteEmail({
              bookingId: id,
              recipientEmail: booking.customer_email,
              recipientType: "customer",
              customerName: booking.customer_name,
              customerEmail: booking.customer_email,
              vehicleLabel,
              startDate: booking.start_date,
              endDate: booking.end_date,
              pickupLocation: booking.pickup_location,
              noteMessage: note,
              sentByUserId: session.userId,
            });
            if (customerSend.ok) {
              newNote.email_customer_sent_at = new Date().toISOString();
              sentTargets.push("customer");
            } else {
              emailErrors.push(customerSend.error ?? "customer delivery failed");
            }
          } catch {
            emailErrors.push("customer delivery failed");
          }
        }

        if (noteEmailTarget === "internal" || noteEmailTarget === "both") {
          try {
            const internalSend = await sendBookingNoteEmail({
              bookingId: id,
              recipientEmail: getInternalNotesRecipient(),
              recipientType: "internal",
              customerName: booking.customer_name,
              customerEmail: booking.customer_email,
              vehicleLabel,
              startDate: booking.start_date,
              endDate: booking.end_date,
              pickupLocation: booking.pickup_location,
              noteMessage: note,
              sentByUserId: session.userId,
            });
            if (internalSend.ok) {
              newNote.email_internal_sent_at = new Date().toISOString();
              sentTargets.push("internal");
            } else {
              emailErrors.push(internalSend.error ?? "internal delivery failed");
            }
          } catch {
            emailErrors.push("internal delivery failed");
          }
        }

        if (emailErrors.length > 0) {
          newNote.email_last_error = emailErrors.join(" | ").slice(0, 400);
        }
      }

      const updatedPricing = { ...pricing, admin_notes: [...existingNotes, newNote] };

      await client.query("update bookings set pricing_json = $1, updated_at = now() where id = $2", [
        updatedPricing,
        id,
      ]);

      await client.query("commit");

      await writeAuditLog({
        userId: session.userId,
        action: "BOOKING_NOTE_ADDED",
        entityType: "booking",
        entityId: id,
        details: {
          length: note.length,
          note_email_target: noteEmailTarget,
          note_send_mode: noteSendMode,
          note_scheduled_for: noteScheduledFor,
          note_email_sent_targets: sentTargets,
          note_email_error_count: emailErrors.length,
        },
      });

      let message = "Note saved.";
      if (noteEmailTarget !== "none" && noteSendMode === "scheduled") {
        message = "Note saved. Email scheduled.";
      } else if (sentTargets.length > 0 && emailErrors.length === 0) {
        message = "Note saved. Email sent.";
      } else if (sentTargets.length > 0 && emailErrors.length > 0) {
        message = "Note saved. Some emails could not be delivered.";
      } else if (noteEmailTarget !== "none" && emailErrors.length > 0) {
        message = "Note saved. Email delivery failed.";
      }

      return NextResponse.json({ ok: true, message });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  if (action === "cancel_scheduled_note_email") {
    const noteId =
      typeof body?.noteId === "string" && body.noteId.trim() ? body.noteId.trim() : null;
    const noteCreatedAt =
      typeof body?.noteCreatedAt === "string" && body.noteCreatedAt.trim()
        ? body.noteCreatedAt.trim()
        : null;
    const noteMessage =
      typeof body?.noteMessage === "string" && body.noteMessage.trim() ? body.noteMessage.trim() : null;
    const cancelReason =
      typeof body?.cancelReason === "string" && body.cancelReason.trim() ? body.cancelReason.trim() : null;

    if (!noteId && !noteCreatedAt) {
      return NextResponse.json({ error: "Note identifier is required" }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    let auditNoteId: string | null = null;
    let auditNoteCreatedAt: string | null = null;
    let auditNoteEmailTarget: "none" | "customer" | "internal" | "both" = "none";
    let auditNoteScheduledFor: string | null = null;

    try {
      await client.query("begin");

      const bookingResult = (await client.query(
        "select pricing_json from bookings where id = $1 for update",
        [id],
      )) as {
        rows: Array<{ pricing_json: Record<string, unknown> | null }>;
        rowCount: number;
      };

      if (bookingResult.rowCount === 0) {
        await client.query("rollback");
        return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      }

      const pricing = bookingResult.rows[0].pricing_json ?? {};
      const existingNotes = Array.isArray((pricing as { admin_notes?: unknown }).admin_notes)
        ? ((pricing as { admin_notes: unknown[] }).admin_notes as unknown[])
        : [];

      let foundIndex = -1;
      let matchedNote: Record<string, unknown> | null = null;

      for (let index = 0; index < existingNotes.length; index += 1) {
        const entry = asObject(existingNotes[index]);
        if (!entry) continue;

        const entryId =
          typeof entry.note_id === "string" && entry.note_id.trim() ? entry.note_id.trim() : null;
        const entryCreatedAt =
          typeof entry.created_at === "string" && entry.created_at.trim()
            ? entry.created_at.trim()
            : null;
        const entryMessage =
          typeof entry.message === "string" && entry.message.trim() ? entry.message.trim() : null;

        const matchesById = Boolean(noteId && entryId && entryId === noteId);
        const matchesByCreatedAt =
          !noteId &&
          noteCreatedAt &&
          entryCreatedAt === noteCreatedAt &&
          (!noteMessage || noteMessage === entryMessage);

        if (!matchesById && !matchesByCreatedAt) continue;

        foundIndex = index;
        matchedNote = { ...entry };
        break;
      }

      if (!matchedNote || foundIndex < 0) {
        await client.query("rollback");
        return NextResponse.json({ error: "Scheduled note not found" }, { status: 404 });
      }

      const target = normalizeNoteTarget(matchedNote.email_target);
      const sendMode = String(matchedNote.email_send_mode ?? "").toLowerCase();
      if (target === "none" || sendMode !== "scheduled") {
        await client.query("rollback");
        return NextResponse.json({ error: "This note is not scheduled for email." }, { status: 400 });
      }

      if (typeof matchedNote.email_cancelled_at === "string" && matchedNote.email_cancelled_at.trim()) {
        await client.query("rollback");
        return NextResponse.json({ ok: true, message: "Scheduled email already cancelled." });
      }

      const customerOutstanding =
        (target === "customer" || target === "both") && !matchedNote.email_customer_sent_at;
      const internalOutstanding =
        (target === "internal" || target === "both") && !matchedNote.email_internal_sent_at;

      if (!customerOutstanding && !internalOutstanding) {
        await client.query("rollback");
        return NextResponse.json(
          { error: "Scheduled email has already been sent." },
          { status: 400 },
        );
      }

      const nowIso = new Date().toISOString();
      matchedNote.email_cancelled_at = nowIso;
      matchedNote.email_cancelled_by = session.userId;
      matchedNote.email_cancel_reason = cancelReason;
      matchedNote.email_last_error = null;
      auditNoteId = typeof matchedNote.note_id === "string" ? matchedNote.note_id : null;
      auditNoteCreatedAt = typeof matchedNote.created_at === "string" ? matchedNote.created_at : null;
      auditNoteEmailTarget = target;
      auditNoteScheduledFor =
        typeof matchedNote.email_scheduled_for === "string" ? matchedNote.email_scheduled_for : null;

      const nextNotes = [...existingNotes];
      nextNotes[foundIndex] = matchedNote;
      const updatedPricing = { ...pricing, admin_notes: nextNotes };

      await client.query("update bookings set pricing_json = $1, updated_at = now() where id = $2", [
        updatedPricing,
        id,
      ]);

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_NOTE_EMAIL_CANCELLED",
      entityType: "booking",
      entityId: id,
      details: {
        note_id: auditNoteId,
        note_created_at: auditNoteCreatedAt,
        note_email_target: auditNoteEmailTarget,
        note_scheduled_for: auditNoteScheduledFor,
        reason: cancelReason,
      },
    });

    return NextResponse.json({ ok: true, message: "Scheduled note email cancelled." });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
