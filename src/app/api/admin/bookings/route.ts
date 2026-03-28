import { NextResponse } from "next/server";

import { requireAdminRole, requireAdminAccess } from "@/lib/auth/adminGuards";
import { getSessionFromRequest } from "@/lib/auth/session";
import { fetchAdminBookingsPage } from "@/lib/bookings/adminBookingsList";
import {
  buildAdminCreateBookingWindow,
  computeAdminCreateBookingPricingPreview,
  getAdminCreateBookingVehicleById,
} from "@/lib/bookings/adminCreateBooking";
import { getDbPool } from "@/lib/db";
import { sendBookingCreatedEmail } from "@/lib/notifications/email";
import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";
import { isVehicleUnavailableEntitlementBased } from "@/lib/availability/entitlement";
import { requireCsrf } from "@/lib/security/csrf";
import { isEmail, isISODate, isNonEmptyString } from "@/lib/validators";
import { logError } from "@/lib/log";
import { CustomerBlockedError, upsertCustomerForBooking } from "@/lib/customers";
import { normalizePromoInputCode, validatePromoForBooking } from "@/lib/promos";
import { writeAuditLog } from "@/lib/audit";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  return handleAdminBookingsGet(request);
}

export type AdminBookingsGetRouteDeps = {
  getSession: () => Promise<Awaited<ReturnType<typeof getSessionFromRequest>>>;
  fetchPage: typeof fetchAdminBookingsPage;
};

const DEFAULT_BOOKINGS_GET_DEPS: AdminBookingsGetRouteDeps = {
  getSession: () => getSessionFromRequest(),
  fetchPage: fetchAdminBookingsPage,
};

export async function handleAdminBookingsGet(
  request: Request,
  deps: AdminBookingsGetRouteDeps = DEFAULT_BOOKINGS_GET_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const page = await deps.fetchPage({
    status: searchParams.get("status"),
    scope: searchParams.get("scope"),
    pickupDay: searchParams.get("pickupDay"),
    sortBy: searchParams.get("sortBy"),
    sortDir: searchParams.get("sortDir"),
    q: searchParams.get("q"),
    dateFrom: searchParams.get("dateFrom"),
    dateTo: searchParams.get("dateTo"),
    archived: searchParams.get("archived"),
    limit: searchParams.get("limit"),
    cursor: searchParams.get("cursor"),
  });

  return NextResponse.json(page);
}

export async function POST(request: Request) {
  return handleAdminBookingsPost(request);
}

export type AdminBookingsPostRouteDeps = {
  requireAdmin: typeof requireAdminRole;
  requireCsrfToken: typeof requireCsrf;
  getPool: typeof getDbPool;
  isVehicleUnavailable: typeof isVehicleUnavailableEntitlementBased;
  upsertCustomer: typeof upsertCustomerForBooking;
  validatePromo: typeof validatePromoForBooking;
  writeAudit: typeof writeAuditLog;
  sendCreatedEmail: typeof sendBookingCreatedEmail;
  log: typeof logError;
};

const DEFAULT_BOOKINGS_POST_DEPS: AdminBookingsPostRouteDeps = {
  requireAdmin: requireAdminRole,
  requireCsrfToken: requireCsrf,
  getPool: getDbPool,
  isVehicleUnavailable: isVehicleUnavailableEntitlementBased,
  upsertCustomer: upsertCustomerForBooking,
  validatePromo: validatePromoForBooking,
  writeAudit: writeAuditLog,
  sendCreatedEmail: sendBookingCreatedEmail,
  log: logError,
};

export async function handleAdminBookingsPost(
  request: Request,
  deps: AdminBookingsPostRouteDeps = DEFAULT_BOOKINGS_POST_DEPS,
) {
  const auth = await deps.requireAdmin();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  if (!(await deps.requireCsrfToken(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);

  const vehicleId = body?.vehicleId;
  const fullName = body?.fullName;
  const email = body?.email;
  const phone = body?.phone;
  const startDate = body?.startDate;
  const endDate = body?.endDate;
  const pickupLocation = body?.pickupLocation;
  const customerId = body?.customerId;
  const promoCodeRaw = body?.promoCode;

  if (!UUID_REGEX.test(vehicleId ?? "")) {
    return NextResponse.json({ error: "Invalid vehicleId" }, { status: 400 });
  }
  if (customerId && !UUID_REGEX.test(customerId ?? "")) {
    return NextResponse.json({ error: "Invalid customerId" }, { status: 400 });
  }
  if (!isNonEmptyString(fullName, 2)) {
    return NextResponse.json({ error: "Invalid fullName" }, { status: 400 });
  }
  if (!isEmail(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!isNonEmptyString(phone, 7)) {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }
  if (!isISODate(startDate) || !isISODate(endDate)) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  if (!isNonEmptyString(pickupLocation, 3)) {
    return NextResponse.json({ error: "Invalid pickupLocation" }, { status: 400 });
  }

  const start = dateOnlyUtc(startDate);
  const end = dateOnlyUtc(endDate);
  const today = dateOnlyUtc(new Date());

  if (!start || !end || !today) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  if (start < today) {
    return NextResponse.json({ error: "startDate must be today or later" }, { status: 400 });
  }
  if (!(end > start)) {
    return NextResponse.json({ error: "endDate must be after startDate" }, { status: 400 });
  }

  const days = calcDaysInclusive(start, end);
  if (days <= 0) {
    return NextResponse.json({ error: "Invalid rental duration" }, { status: 400 });
  }

  const pool = deps.getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const vehicle = await getAdminCreateBookingVehicleById(vehicleId, { client });
    if (!vehicle) {
      await client.query("rollback");
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    const availabilityWindow = buildAdminCreateBookingWindow(startDate, endDate);
    if (!availabilityWindow) {
      await client.query("rollback");
      return NextResponse.json({ error: "Invalid booking dates." }, { status: 400 });
    }

    const isUnavailable = await deps.isVehicleUnavailable(
      vehicleId,
      availabilityWindow,
      { client },
    );
    if (isUnavailable) {
      await client.query("rollback");
      return NextResponse.json({ error: "Vehicle unavailable for selected dates" }, { status: 409 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    let customerUpsert;
    try {
      customerUpsert = await deps.upsertCustomer(
        {
          customerId: typeof customerId === "string" ? customerId : undefined,
          fullName: String(fullName).trim(),
          email: normalizedEmail,
          phone: String(phone).trim(),
          bookedAt: new Date().toISOString(),
        },
        { client },
      );
    } catch (error) {
      if (error instanceof CustomerBlockedError) {
        await client.query("rollback");
        return NextResponse.json(
          {
            error:
              "Customer is blocked from booking. Unblock this customer in Customers before creating a booking.",
          },
          { status: 409 },
        );
      }
      throw error;
    }

    const dailyRate = Number(vehicle.dailyRateCents || 0);
    const depositAmount = Number(vehicle.depositCents || 0);
    const subtotalAmount = dailyRate * days;

    const promoCode = typeof promoCodeRaw === "string" ? normalizePromoInputCode(promoCodeRaw) : "";
    let promoDiscount = 0;
    let promoId: string | null = null;

    if (promoCode) {
      const promoValidation = await deps.validatePromo({
        code: promoCode,
        vehicleId,
        startDate: String(startDate),
        endDate: String(endDate),
        subtotalCents: subtotalAmount,
        baseTotalCents: subtotalAmount,
        customerId: customerUpsert.customerId,
        customerEmail: normalizedEmail,
        client,
      });
      if (!promoValidation.ok) {
        await client.query("rollback");
        return NextResponse.json({ error: promoValidation.message }, { status: 400 });
      }
      promoDiscount = promoValidation.discountAmountCents;
      promoId = promoValidation.promoId;
    }

    const pricingPreview = computeAdminCreateBookingPricingPreview({
      dailyRateCents: dailyRate,
      depositCents: depositAmount,
      startDate: String(startDate),
      endDate: String(endDate),
      promoDiscountCents: promoDiscount,
    });
    const totalAmount = pricingPreview?.totalCents ?? Math.max(0, subtotalAmount - promoDiscount);

    const pricing = {
      daily_rate_cents: dailyRate,
      deposit_cents: depositAmount,
      days: pricingPreview?.days ?? days,
      customer_name_snapshot: String(fullName).trim(),
      customer_email_snapshot: normalizedEmail,
      customer_phone_snapshot: String(phone).trim(),
      subtotal_cents: pricingPreview?.subtotalCents ?? subtotalAmount,
      promo_code: promoCode || null,
      promo_code_id: promoId,
      promo_discount_cents: promoDiscount,
      total_amount: totalAmount,
      total_cents: totalAmount,
      amount_paid: 0,
      balance_due: totalAmount,
      payment_status: "UNPAID",
      payment_option_selected: "DEPOSIT",
      currency: pricingPreview?.currency ?? "JMD",
    };

    const bookingInsert = await client.query(
      "insert into bookings (vehicle_id, customer_id, start_date, end_date, pickup_location, status, pricing_json) values ($1, $2, $3, $4, $5, 'PENDING_PAYMENT', $6) returning id, status",
      [vehicleId, customerUpsert.customerId, startDate, endDate, String(pickupLocation).trim(), pricing],
    );

    await client.query("commit");

    try {
      await deps.writeAudit({
        userId: actor.userId,
        action: "BOOKING_CREATED_BY_ADMIN",
        entityType: "booking",
        entityId: bookingInsert.rows[0].id,
        details: {
          customer_id: customerUpsert.customerId,
          created_on_behalf: Boolean(customerId),
          customer_created: customerUpsert.created,
          vehicle_id: vehicleId,
          start_date: String(startDate),
          end_date: String(endDate),
          promo_code: promoCode || null,
          promo_discount_cents: promoDiscount,
        },
      });
    } catch (error) {
      deps.log("admin_booking_create_audit_failed", error, {
        userId: actor.userId,
        bookingId: bookingInsert.rows[0]?.id,
        vehicleId,
        customerId: customerUpsert.customerId,
      });
    }

    try {
      await deps.sendCreatedEmail({
        bookingId: bookingInsert.rows[0].id,
        customerEmail: normalizedEmail,
        customerName: String(fullName).trim(),
        vehicleLabel: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
        startDate: String(startDate),
        endDate: String(endDate),
        pickupLocation: String(pickupLocation).trim(),
        dailyRate,
        deposit: depositAmount,
        promoCode: promoCode || null,
        promoDiscount,
      });
    } catch (error) {
      deps.log("admin_booking_email_failed", error, {
        bookingId: bookingInsert.rows[0]?.id,
        vehicleId,
        customerId: customerUpsert.customerId,
      });
    }

    return NextResponse.json({
      bookingId: bookingInsert.rows[0].id,
      status: bookingInsert.rows[0].status,
      promoApplied: promoId ? true : false,
    });
  } catch (error) {
    await client.query("rollback");
    deps.log("admin_booking_create_failed", error, {
      userId: actor.userId,
      vehicleId: String(vehicleId ?? ""),
      startDate: String(startDate ?? ""),
      endDate: String(endDate ?? ""),
    });
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  } finally {
    client.release();
  }
}
