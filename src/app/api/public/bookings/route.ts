import { NextResponse } from "next/server";

import { sendBookingCreatedEmail } from "@/lib/notifications/email";
import { dbQuery, getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";
import { isEmail, isISODate, isNonEmptyString } from "@/lib/validators";
import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";

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

    const availability = await client.query(
      "select id from bookings where vehicle_id = $1 and status in ('CONFIRMED','PICKED_UP') and not ($3 < start_date or $2 > end_date) for update",
      [vehicleId, startDate, endDate],
    );

    if (availability.rowCount > 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Vehicle unavailable for selected dates" }, { status: 409 });
    }

    const customerResult = await client.query(
      "select id from customers where email = $1 limit 1",
      [email.trim().toLowerCase()],
    );

    let customerId = customerResult.rows[0]?.id;
    if (!customerId) {
      const insertedCustomer = await client.query(
        "insert into customers (full_name, email, phone) values ($1, $2, $3) returning id",
        [fullName.trim(), email.trim().toLowerCase(), phone.trim()],
      );
      customerId = insertedCustomer.rows[0].id;
    }

    const dailyRate = vehicleResult.rows[0].daily_rate_cents as number;
    const depositCents = vehicleResult.rows[0].deposit_cents as number;
    const subtotalCents = dailyRate * days;

    const pricing = {
      daily_rate_cents: dailyRate,
      deposit_cents: depositCents,
      days,
      subtotal_cents: subtotalCents,
    };

    const bookingInsert = await client.query(
      "insert into bookings (vehicle_id, customer_id, start_date, end_date, pickup_location, status, pricing_json) values ($1, $2, $3, $4, $5, 'PENDING_PAYMENT', $6) returning id, status",
      [vehicleId, customerId, startDate, endDate, pickupLocation.trim(), pricing],
    );

    await client.query("commit");

    try {
      const vehicle = vehicleResult.rows[0];
      await sendBookingCreatedEmail({
        bookingId: bookingInsert.rows[0].id,
        customerEmail: email.trim().toLowerCase(),
        customerName: fullName.trim(),
        vehicleLabel: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
        startDate,
        endDate,
        pickupLocation: pickupLocation.trim(),
        dailyRate,
        deposit: depositCents,
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
