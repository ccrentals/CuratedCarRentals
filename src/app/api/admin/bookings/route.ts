import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery, getDbPool } from "@/lib/db";
import { sendBookingCreatedEmail } from "@/lib/notifications/email";
import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";
import { requireCsrf } from "@/lib/security/csrf";
import { isEmail, isISODate, isNonEmptyString } from "@/lib/validators";
import { logError } from "@/lib/log";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const query = status
    ? {
        text:
          "select b.id, b.start_date, b.end_date, b.status, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.status = $1 order by b.created_at desc",
        values: [status],
      }
    : {
        text:
          "select b.id, b.start_date, b.end_date, b.status, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id order by b.created_at desc",
        values: [],
      };

  const result = await dbQuery(query.text, query.values);
  return NextResponse.json({ bookings: result.rows });
}

export async function POST(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    const normalizedEmail = String(email).trim().toLowerCase();
    const customerResult = await client.query(
      "select id from customers where email = $1 limit 1",
      [normalizedEmail],
    );

    let customerId = customerResult.rows[0]?.id;
    if (!customerId) {
      const insertedCustomer = await client.query(
        "insert into customers (full_name, email, phone) values ($1, $2, $3) returning id",
        [String(fullName).trim(), normalizedEmail, String(phone).trim()],
      );
      customerId = insertedCustomer.rows[0].id;
    }

    const vehicle = vehicleResult.rows[0];
    const dailyRate = Number(vehicle.daily_rate_cents || 0);
    const depositAmount = Number(vehicle.deposit_cents || 0);
    const totalAmount = dailyRate * days;

    const pricing = {
      daily_rate_cents: dailyRate,
      deposit_cents: depositAmount,
      days,
      subtotal_cents: totalAmount,
      total_amount: totalAmount,
      amount_paid: 0,
      balance_due: totalAmount,
      payment_status: "UNPAID",
      payment_option_selected: "DEPOSIT",
      currency: "JMD",
    };

    const bookingInsert = await client.query(
      "insert into bookings (vehicle_id, customer_id, start_date, end_date, pickup_location, status, pricing_json) values ($1, $2, $3, $4, $5, 'PENDING_PAYMENT', $6) returning id, status",
      [vehicleId, customerId, startDate, endDate, String(pickupLocation).trim(), pricing],
    );

    await client.query("commit");

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
      });
    } catch (error) {
      logError("admin_booking_email_failed", error, {
        bookingId: bookingInsert.rows[0]?.id,
        vehicleId,
      });
    }

    return NextResponse.json({
      bookingId: bookingInsert.rows[0].id,
      status: bookingInsert.rows[0].status,
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
