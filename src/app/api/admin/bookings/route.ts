import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { fetchAdminBookingsPage } from "@/lib/bookings/adminBookingsList";
import { getDbPool } from "@/lib/db";
import { sendBookingCreatedEmail } from "@/lib/notifications/email";
import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";
import { findOverlappingBlockingBookingIds } from "@/lib/bookings/holds";
import { requireCsrf } from "@/lib/security/csrf";
import { isEmail, isISODate, isNonEmptyString } from "@/lib/validators";
import { logError } from "@/lib/log";
import { upsertCustomerForBooking } from "@/lib/customers";
import { normalizePromoInputCode, upsertPromoRedemption, validatePromoForBooking } from "@/lib/promos";
import { writeAuditLog } from "@/lib/audit";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isAdminRole(role: string | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase() === "ADMIN";
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = await fetchAdminBookingsPage({
    status: searchParams.get("status"),
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
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await requireCsrf(request))) {
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

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const vehicleResult = await client.query(
      "select id, make, model, year, daily_rate_cents, deposit_cents from vehicles where id = $1 and status <> 'INACTIVE'",
      [vehicleId],
    );

    if (vehicleResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    const blockingOverlaps = await findOverlappingBlockingBookingIds(client, {
      vehicleId,
      startDate,
      endDate,
      forUpdate: true,
    });

    if (blockingOverlaps.length > 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Vehicle unavailable for selected dates" }, { status: 409 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const customerUpsert = await upsertCustomerForBooking(
      {
        customerId: typeof customerId === "string" ? customerId : undefined,
        fullName: String(fullName).trim(),
        email: normalizedEmail,
        phone: String(phone).trim(),
        bookedAt: new Date().toISOString(),
      },
      { client },
    );

    const vehicle = vehicleResult.rows[0];
    const dailyRate = Number(vehicle.daily_rate_cents || 0);
    const depositAmount = Number(vehicle.deposit_cents || 0);
    const subtotalAmount = dailyRate * days;

    const promoCode = typeof promoCodeRaw === "string" ? normalizePromoInputCode(promoCodeRaw) : "";
    let promoDiscount = 0;
    let promoId: string | null = null;

    if (promoCode) {
      const promoValidation = await validatePromoForBooking({
        code: promoCode,
        vehicleId,
        startDate: String(startDate),
        endDate: String(endDate),
        subtotalCents: subtotalAmount,
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

    const totalAmount = Math.max(0, subtotalAmount - promoDiscount);

    const pricing = {
      daily_rate_cents: dailyRate,
      deposit_cents: depositAmount,
      days,
      subtotal_cents: subtotalAmount,
      promo_code: promoCode || null,
      promo_code_id: promoId,
      promo_discount_cents: promoDiscount,
      total_amount: totalAmount,
      total_cents: totalAmount,
      amount_paid: 0,
      balance_due: totalAmount,
      payment_status: "UNPAID",
      payment_option_selected: "DEPOSIT",
      currency: "JMD",
    };

    const bookingInsert = await client.query(
      "insert into bookings (vehicle_id, customer_id, start_date, end_date, pickup_location, status, pricing_json) values ($1, $2, $3, $4, $5, 'PENDING_PAYMENT', $6) returning id, status",
      [vehicleId, customerUpsert.customerId, startDate, endDate, String(pickupLocation).trim(), pricing],
    );

    if (promoId && promoDiscount > 0) {
      await upsertPromoRedemption({
        bookingId: bookingInsert.rows[0].id as string,
        promoId,
        customerId: customerUpsert.customerId,
        customerEmail: normalizedEmail,
        discountAmountCents: promoDiscount,
        client,
      });
    }

    await client.query("commit");

    await writeAuditLog({
      userId: session.userId,
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

    try {
      await sendBookingCreatedEmail({
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
      logError("admin_booking_email_failed", error, {
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
    logError("admin_booking_create_failed", error, {
      vehicleId: String(vehicleId ?? ""),
      startDate: String(startDate ?? ""),
      endDate: String(endDate ?? ""),
    });
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  } finally {
    client.release();
  }
}
