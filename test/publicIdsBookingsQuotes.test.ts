import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { config as loadEnv } from "dotenv";

import { handleAdminBookingsGet } from "@/app/api/admin/bookings/route";
import { handleAdminQuoteGet } from "@/app/api/admin/quotes/[id]/route";
import { handleAdminQuotesGet } from "@/app/api/admin/quotes/route";
import { fetchAdminBookingsPage } from "@/lib/bookings/adminBookingsList";
import { dbQuery } from "@/lib/db";
import { fetchAdminQuoteById, fetchAdminQuotesPage } from "@/lib/quotes/adminQuotes";

loadEnv({ path: ".env.local" });
loadEnv();

type CreatedBooking = {
  id: string;
  public_id: string;
};

type CreatedQuote = {
  id: string;
  public_id: string;
};

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: Date.now() + 60_000,
    issuedAt: Date.now(),
  };
}

function requireDatabaseOrSkip(t: TestContext) {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not set; skipping DB-backed public id tests.");
  }
}

async function insertVehicle(runTag: string) {
  const result = await dbQuery<{ id: string }>(
    "insert into vehicles (make, model, year, daily_rate_cents, deposit_cents, status) values ($1, $2, $3, $4, $5, 'ACTIVE') returning id",
    [`Test Make ${runTag}`, `Model ${runTag}`, 2030, 12000, 8000],
  );
  return result.rows[0].id;
}

async function insertCustomer(runTag: string) {
  const result = await dbQuery<{ id: string }>(
    "insert into customers (full_name, email, phone) values ($1, $2, $3) returning id",
    [`Customer ${runTag}`, `${runTag}@example.com`, "+18765550144"],
  );
  return result.rows[0].id;
}

async function insertBooking(input: { vehicleId: string; customerId: string; runTag: string }) {
  const result = await dbQuery<CreatedBooking>(
    "insert into bookings (vehicle_id, customer_id, start_date, end_date, pickup_location, status, pricing_json) values ($1::uuid, $2::uuid, $3::date, $4::date, $5, 'PENDING_PAYMENT', $6::jsonb) returning id, public_id",
    [
      input.vehicleId,
      input.customerId,
      "2031-01-10",
      "2031-01-12",
      `Airport ${input.runTag}`,
      JSON.stringify({
        total_cents: 24000,
        subtotal_cents: 24000,
        deposit_cents: 8000,
        amount_paid: 0,
        balance_due: 24000,
        payment_status: "UNPAID",
      }),
    ],
  );
  return result.rows[0];
}

async function insertQuote(runTag: string) {
  const result = await dbQuery<CreatedQuote>(
    "insert into quotes (status, expires_at, customer_full_name, customer_email, start_at, end_at, pickup_location_text, dropoff_location_text, vehicle_label, pricing_json, base_total_cents, insurance_total_cents, discount_total_cents, subtotal_cents, total_cents, deposit_required_cents, amount_due_cents, insurance_enabled, tags) values ('SENT', $1::timestamptz, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18::text[]) returning id, public_id",
    [
      "2035-01-01T00:00:00.000Z",
      `Quote ${runTag}`,
      `${runTag}.quote@example.com`,
      "2031-02-10T10:00:00.000Z",
      "2031-02-12T10:00:00.000Z",
      `Pickup ${runTag}`,
      `Dropoff ${runTag}`,
      `Vehicle ${runTag}`,
      JSON.stringify({
        total_cents: 26000,
        subtotal_cents: 26000,
        deposit_required_cents: 9000,
        amount_due_cents: 26000,
      }),
      26000,
      0,
      0,
      26000,
      26000,
      9000,
      26000,
      false,
      [],
    ],
  );
  return result.rows[0];
}

async function cleanup(input: {
  quoteIds: string[];
  bookingIds: string[];
  customerIds: string[];
  vehicleIds: string[];
}) {
  if (input.quoteIds.length > 0) {
    await dbQuery("delete from quotes where id = any($1::uuid[])", [input.quoteIds]);
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

test("public_id trigger generation: bookings + quotes receive formatted IDs", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `public-id-gen-${randomUUID().slice(0, 8)}`;
  const quoteIds: string[] = [];
  const bookingIds: string[] = [];
  const customerIds: string[] = [];
  const vehicleIds: string[] = [];

  try {
    const vehicleId = await insertVehicle(runTag);
    vehicleIds.push(vehicleId);

    const customerId = await insertCustomer(runTag);
    customerIds.push(customerId);

    const booking = await insertBooking({ vehicleId, customerId, runTag });
    bookingIds.push(booking.id);

    const quote = await insertQuote(runTag);
    quoteIds.push(quote.id);

    assert.match(booking.public_id, /^BK\d{6,}$/);
    assert.match(quote.public_id, /^QU\d{6,}$/);
  } finally {
    await cleanup({ quoteIds, bookingIds, customerIds, vehicleIds });
  }
});

test("search by public_id works for admin bookings + quotes list fetch", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `public-id-search-${randomUUID().slice(0, 8)}`;
  const quoteIds: string[] = [];
  const bookingIds: string[] = [];
  const customerIds: string[] = [];
  const vehicleIds: string[] = [];

  try {
    const vehicleId = await insertVehicle(runTag);
    vehicleIds.push(vehicleId);

    const customerId = await insertCustomer(runTag);
    customerIds.push(customerId);

    const booking = await insertBooking({ vehicleId, customerId, runTag });
    bookingIds.push(booking.id);

    const quote = await insertQuote(runTag);
    quoteIds.push(quote.id);

    const bookingPage = await fetchAdminBookingsPage({
      q: booking.public_id.toLowerCase(),
      limit: "20",
    });
    const bookingRow = bookingPage.bookings.find((row) => row.id === booking.id);
    assert.ok(bookingRow);
    assert.equal(bookingRow?.publicId, booking.public_id);

    const quotePage = await fetchAdminQuotesPage({
      q: quote.public_id.toLowerCase(),
      limit: "20",
    });
    const quoteRow = quotePage.items.find((row) => row.id === quote.id);
    assert.ok(quoteRow);
    assert.equal(quoteRow?.publicId, quote.public_id);
  } finally {
    await cleanup({ quoteIds, bookingIds, customerIds, vehicleIds });
  }
});

test("admin quote/bookings APIs include public_id in list/detail payloads", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `public-id-api-${randomUUID().slice(0, 8)}`;
  const quoteIds: string[] = [];
  const bookingIds: string[] = [];
  const customerIds: string[] = [];
  const vehicleIds: string[] = [];

  try {
    const vehicleId = await insertVehicle(runTag);
    vehicleIds.push(vehicleId);

    const customerId = await insertCustomer(runTag);
    customerIds.push(customerId);

    const booking = await insertBooking({ vehicleId, customerId, runTag });
    bookingIds.push(booking.id);

    const quote = await insertQuote(runTag);
    quoteIds.push(quote.id);

    const bookingsResponse = await handleAdminBookingsGet(
      new Request(`http://localhost/api/admin/bookings?q=${encodeURIComponent(booking.public_id)}`),
      {
        getSession: async () => adminSession(),
        fetchPage: fetchAdminBookingsPage,
      },
    );
    assert.equal(bookingsResponse.status, 200);
    const bookingsPayload = (await bookingsResponse.json()) as {
      bookings: Array<{ id: string; publicId?: string }>;
    };
    const bookingRow = bookingsPayload.bookings.find((row) => row.id === booking.id);
    assert.ok(bookingRow);
    assert.equal(bookingRow?.publicId, booking.public_id);

    const quotesResponse = await handleAdminQuotesGet(
      new Request(`http://localhost/api/admin/quotes?q=${encodeURIComponent(quote.public_id)}&limit=20`),
      {
        getSession: async () => adminSession(),
        requireCsrfCheck: async () => true,
        fetchPage: fetchAdminQuotesPage,
        createQuote: async () => {
          throw new Error("not used by GET");
        },
      },
    );
    assert.equal(quotesResponse.status, 200);
    const quotesPayload = (await quotesResponse.json()) as {
      ok: boolean;
      items: Array<{ id: string; publicId?: string }>;
    };
    assert.equal(quotesPayload.ok, true);
    const quoteRow = quotesPayload.items.find((row) => row.id === quote.id);
    assert.ok(quoteRow);
    assert.equal(quoteRow?.publicId, quote.public_id);

    const quoteDetailResponse = await handleAdminQuoteGet(
      new Request(`http://localhost/api/admin/quotes/${quote.id}`),
      { params: Promise.resolve({ id: quote.id }) },
      {
        getSession: async () => adminSession(),
        requireCsrfCheck: async () => true,
        getQuote: fetchAdminQuoteById,
        patchQuote: async () => null,
      },
    );
    assert.equal(quoteDetailResponse.status, 200);
    const quoteDetailPayload = (await quoteDetailResponse.json()) as {
      ok: boolean;
      item: { id: string; publicId?: string };
    };
    assert.equal(quoteDetailPayload.ok, true);
    assert.equal(quoteDetailPayload.item.id, quote.id);
    assert.equal(quoteDetailPayload.item.publicId, quote.public_id);
  } finally {
    await cleanup({ quoteIds, bookingIds, customerIds, vehicleIds });
  }
});
