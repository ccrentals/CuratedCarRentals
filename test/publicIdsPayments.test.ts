import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { config as loadEnv } from "dotenv";

import { handleAdminBookingByIdGet } from "@/app/api/admin/bookings/[id]/implementation";
import { dbQuery } from "@/lib/db";

loadEnv({ path: ".env.local" });
loadEnv();

type CreatedVehicle = {
  id: string;
};

type CreatedCustomer = {
  id: string;
};

type CreatedBooking = {
  id: string;
};

type CreatedPayment = {
  id: string;
  public_id: string;
};

function requireDatabaseOrSkip(t: TestContext) {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not set; skipping DB-backed payments public id tests.");
  }
}

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: Date.now() + 60_000,
    issuedAt: Date.now(),
  };
}

async function insertVehicle(runTag: string) {
  const result = await dbQuery<CreatedVehicle>(
    "insert into vehicles (make, model, year, seat_count, daily_rate_cents, deposit_cents, status, image_urls_json, features_json) values ($1, $2, $3, $4, $5, $6, 'AVAILABLE', $7::jsonb, $8::jsonb) returning id",
    [
      `Payment ID Make ${runTag}`,
      `Payment ID Model ${runTag}`,
      2033,
      5,
      11000,
      60000,
      JSON.stringify([]),
      JSON.stringify({ source: "test", runTag }),
    ],
  );
  return result.rows[0].id;
}

async function insertCustomer(runTag: string) {
  const result = await dbQuery<CreatedCustomer>(
    "insert into customers (full_name, email, phone) values ($1, $2, $3) returning id",
    [`Payment ID Customer ${runTag}`, `${runTag}.payments@example.com`, "+18765550188"],
  );
  return result.rows[0].id;
}

async function insertBooking(input: { vehicleId: string; customerId: string; runTag: string }) {
  const result = await dbQuery<CreatedBooking>(
    "insert into bookings (vehicle_id, customer_id, start_date, end_date, pickup_location, status, pricing_json) values ($1::uuid, $2::uuid, $3::date, $4::date, $5, 'PENDING_PAYMENT', $6::jsonb) returning id",
    [
      input.vehicleId,
      input.customerId,
      "2036-03-10",
      "2036-03-13",
      `Airport ${input.runTag}`,
      JSON.stringify({
        total_cents: 33000,
        subtotal_cents: 33000,
        deposit_cents: 11000,
        amount_paid: 0,
        balance_due: 33000,
        payment_status: "UNPAID",
      }),
    ],
  );
  return result.rows[0].id;
}

async function insertPayment(input: {
  bookingId: string;
  runTag: string;
  amountCents?: number;
  publicId?: string;
}) {
  const result = await dbQuery<CreatedPayment>(
    "insert into payments (booking_id, provider, deposit_amount_cents, currency, status, provider_ref, metadata_json, public_id) values ($1::uuid, 'MANUAL', $2, 'JMD', 'DEPOSIT_PAID', $3, $4::jsonb, $5) returning id, public_id",
    [
      input.bookingId,
      input.amountCents ?? 5000,
      `PAYMENT_TEST_${input.runTag}_${randomUUID().slice(0, 8)}`,
      JSON.stringify({ source: "test", runTag: input.runTag }),
      input.publicId ?? null,
    ],
  );
  return result.rows[0];
}

async function cleanup(input: {
  paymentIds: string[];
  bookingIds: string[];
  customerIds: string[];
  vehicleIds: string[];
}) {
  if (input.paymentIds.length > 0) {
    await dbQuery("delete from payments where id = any($1::uuid[])", [input.paymentIds]);
  }
  if (input.bookingIds.length > 0) {
    await dbQuery("delete from bookings where id = any($1::uuid[])", [input.bookingIds]);
  }
  if (input.customerIds.length > 0) {
    await dbQuery("delete from customers where id = any($1::uuid[])", [input.customerIds]);
  }
  if (input.vehicleIds.length > 0) {
    await dbQuery("delete from vehicles where id = any($1::uuid[])", [input.vehicleIds]);
  }
}

test("payments insert auto-generates PA public_id", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `pa-public-id-${randomUUID().slice(0, 8)}`;
  const paymentIds: string[] = [];
  const bookingIds: string[] = [];
  const customerIds: string[] = [];
  const vehicleIds: string[] = [];

  try {
    const vehicleId = await insertVehicle(runTag);
    vehicleIds.push(vehicleId);
    const customerId = await insertCustomer(runTag);
    customerIds.push(customerId);
    const bookingId = await insertBooking({ vehicleId, customerId, runTag });
    bookingIds.push(bookingId);

    const payment = await insertPayment({ bookingId, runTag });
    paymentIds.push(payment.id);

    assert.match(payment.public_id, /^PA\d{6,}$/);
  } finally {
    await cleanup({ paymentIds, bookingIds, customerIds, vehicleIds });
  }
});

test("payments public_id unique index rejects duplicates", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `pa-public-id-uniq-${randomUUID().slice(0, 8)}`;
  const paymentIds: string[] = [];
  const bookingIds: string[] = [];
  const customerIds: string[] = [];
  const vehicleIds: string[] = [];

  try {
    const vehicleId = await insertVehicle(runTag);
    vehicleIds.push(vehicleId);
    const customerId = await insertCustomer(runTag);
    customerIds.push(customerId);
    const bookingId = await insertBooking({ vehicleId, customerId, runTag });
    bookingIds.push(bookingId);

    const payment = await insertPayment({ bookingId, runTag, amountCents: 5500 });
    paymentIds.push(payment.id);

    await assert.rejects(
      () =>
        insertPayment({
          bookingId,
          runTag,
          amountCents: 6500,
          publicId: payment.public_id,
        }),
      (error: unknown) => {
        const code = (error as { code?: string } | null)?.code;
        return code === "23505";
      },
    );
  } finally {
    await cleanup({ paymentIds, bookingIds, customerIds, vehicleIds });
  }
});

test("booking detail API includes payment public_id", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `pa-public-id-api-${randomUUID().slice(0, 8)}`;
  const paymentIds: string[] = [];
  const bookingIds: string[] = [];
  const customerIds: string[] = [];
  const vehicleIds: string[] = [];

  try {
    const vehicleId = await insertVehicle(runTag);
    vehicleIds.push(vehicleId);
    const customerId = await insertCustomer(runTag);
    customerIds.push(customerId);
    const bookingId = await insertBooking({ vehicleId, customerId, runTag });
    bookingIds.push(bookingId);

    const payment = await insertPayment({ bookingId, runTag, amountCents: 7000 });
    paymentIds.push(payment.id);

    const response = await handleAdminBookingByIdGet(
      new Request(`http://localhost/api/admin/bookings/${bookingId}`),
      { params: Promise.resolve({ id: bookingId }) },
      { getSession: async () => adminSession() },
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      payments: Array<{ id: string; public_id?: string }>;
    };
    const paymentRow = payload.payments.find((row) => row.id === payment.id);
    assert.ok(paymentRow);
    assert.equal(paymentRow?.public_id, payment.public_id);
  } finally {
    await cleanup({ paymentIds, bookingIds, customerIds, vehicleIds });
  }
});
