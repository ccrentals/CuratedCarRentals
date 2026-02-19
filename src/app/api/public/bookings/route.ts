import { NextResponse } from "next/server";

import { sendBookingCreatedEmail } from "@/lib/notifications/email";
import { getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";
import { findOverlappingBlockingBookingIds } from "@/lib/bookings/holds";
import { isEmail, isISODate, isNonEmptyString } from "@/lib/validators";
import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";
import { CustomerBlockedError, upsertCustomerForBooking } from "@/lib/customers";
import { normalizeLegalIdType } from "@/lib/customers/legalId";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const vehicleId = body?.vehicleId;
  const fullName = body?.fullName;
  const email = body?.email;
  const phone = body?.phone;
  const startDate = body?.startDate;
  const endDate = body?.endDate;
  const pickupLocation = body?.pickupLocation;
  const legalIdType = normalizeLegalIdType(body?.legalIdType);
  const legalIdNumber = typeof body?.legalIdNumber === "string" ? body.legalIdNumber.trim() : "";
  const legalIdImageUrl = typeof body?.legalIdImageUrl === "string" ? body.legalIdImageUrl.trim() : "";

  if (!UUID_REGEX.test(vehicleId ?? "")) {
    return NextResponse.json({ error: "Invalid vehicleId" }, { status: 400 });
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
  if (!legalIdType) {
    return NextResponse.json({ error: "Valid legalIdType is required" }, { status: 400 });
  }
  if (!isNonEmptyString(legalIdNumber, 4)) {
    return NextResponse.json({ error: "Valid legalIdNumber is required" }, { status: 400 });
  }
  if (legalIdImageUrl && !/^https?:\/\//i.test(legalIdImageUrl)) {
    return NextResponse.json({ error: "Invalid legalIdImageUrl" }, { status: 400 });
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

  // Pricing/UI treats end_date as inclusive (e.g. 3/19 -> 3/20 is 2 days).
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

    const normalizedEmail = email.trim().toLowerCase();
    const customerInput = {
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: phone.trim(),
      legalIdType,
      legalIdNumber,
      bookedAt: new Date().toISOString(),
    } as const;
    let customerUpsert;
    try {
      customerUpsert = await upsertCustomerForBooking(
        legalIdImageUrl
          ? {
              ...customerInput,
              legalIdImageUrl,
            }
          : customerInput,
        { client },
      );
    } catch (error) {
      if (error instanceof CustomerBlockedError) {
        await client.query("rollback");
        return NextResponse.json(
          { error: "This customer profile is blocked from booking. Please contact support." },
          { status: 403 },
        );
      }
      throw error;
    }

    const dailyRate = vehicleResult.rows[0].daily_rate_cents as number;
    const depositCents = vehicleResult.rows[0].deposit_cents as number;
    const subtotalCents = dailyRate * days;
    const totalAfterDiscount = subtotalCents;

    const pricing = {
      daily_rate_cents: dailyRate,
      deposit_cents: depositCents,
      days,
      subtotal_cents: subtotalCents,
      promo_code: null,
      promo_code_id: null,
      promo_discount_cents: 0,
      total_cents: totalAfterDiscount,
      total_amount: totalAfterDiscount,
      amount_paid: 0,
      balance_due: totalAfterDiscount,
      payment_status: "UNPAID",
      payment_option_selected: "DEPOSIT",
      currency: "JMD",
    };

    const bookingInsert = await client.query(
      "insert into bookings (vehicle_id, customer_id, start_date, end_date, pickup_location, status, pricing_json) values ($1, $2, $3, $4, $5, 'PENDING_PAYMENT', $6) returning id, status",
      [vehicleId, customerUpsert.customerId, startDate, endDate, pickupLocation.trim(), pricing],
    );

    await client.query("commit");

    try {
      const vehicle = vehicleResult.rows[0];
      await sendBookingCreatedEmail({
        bookingId: bookingInsert.rows[0].id,
        customerEmail: normalizedEmail,
        customerName: fullName.trim(),
        vehicleLabel: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
        startDate,
        endDate,
        pickupLocation: pickupLocation.trim(),
        dailyRate,
        deposit: depositCents,
        promoCode: null,
        promoDiscount: 0,
      });
    } catch (error) {
      logError("public_booking_email_failed", error, {
        bookingId: bookingInsert.rows[0]?.id,
        vehicleId,
        startDate,
        endDate,
      });
    }

    return NextResponse.json({
      bookingId: bookingInsert.rows[0].id,
      status: bookingInsert.rows[0].status,
      promoApplied: false,
    });
  } catch (error) {
    await client.query("rollback");
    logError("public_booking_create_failed", error, {
      vehicleId,
      startDate,
      endDate,
    });
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  } finally {
    client.release();
  }
}
