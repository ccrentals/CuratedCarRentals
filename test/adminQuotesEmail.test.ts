import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminQuoteEmailPost } from "@/app/api/admin/quotes/[id]/email/implementation";
import { updateQuoteLastEmailed } from "@/lib/quotes/quoteOps";

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: 999999999,
    issuedAt: 999999000,
  };
}

function quoteFixture() {
  return {
    id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2",
    publicId: "QU000123",
    createdAt: "2026-02-22T12:00:00.000Z",
    updatedAt: "2026-02-22T12:00:00.000Z",
    status: "DRAFT",
    expiresAt: "2026-03-01T00:00:00.000Z",
    customerFullName: "Damian Thompson",
    customerEmail: "damian@example.com",
    customerPhone: "+1 876 555 0144",
    startAt: "2026-03-10T10:00:00.000Z",
    endAt: "2026-03-12T10:00:00.000Z",
    pickupLocationId: null,
    dropoffLocationId: null,
    pickupLocationText: "Norman Manley Airport",
    dropoffLocationText: "Norman Manley Airport",
    bookingLocationDetails: {
      pickup: {
        type: "AIRPORT",
        typeKey: "AIRPORT",
        label: "Norman Manley Airport",
        locationId: null,
        values: {
          flight_arrival_date: "2026-03-10",
          flight_arrival_time: "09:30",
          flight_number: "BW101",
          airline: "Caribbean Airlines",
        },
        fieldLabels: {
          flight_arrival_date: "Flight Arrival Date",
          flight_arrival_time: "Flight Arrival Time",
          flight_number: "Flight Number",
          airline: "Airline",
        },
        address: null,
        flightDate: "2026-03-10",
        flightTime: "09:30",
        flightNumber: "BW101",
        airline: "Caribbean Airlines",
      },
      dropoff: {
        type: "AIRPORT",
        typeKey: "AIRPORT",
        label: "Norman Manley Airport",
        locationId: null,
        values: {
          flight_departure_date: "2026-03-12",
          flight_departure_time: "13:00",
          flight_number: "BW102",
          airline: "Caribbean Airlines",
        },
        fieldLabels: {
          flight_departure_date: "Flight Departure Date",
          flight_departure_time: "Flight Departure Time",
          flight_number: "Flight Number",
          airline: "Airline",
        },
        address: null,
        flightDate: "2026-03-12",
        flightTime: "13:00",
        flightNumber: "BW102",
        airline: "Caribbean Airlines",
      },
    },
    vehicleId: "6f11f0cf-cedf-4db3-a5fd-64bfe7fded1e",
    vehicleLabel: "Nissan X-Trail",
    vehicleClass: "SUV",
    pricingJson: {},
    baseTotalCents: 24000,
    insuranceTotalCents: 2400,
    discountTotalCents: 1000,
    subtotalCents: 26400,
    totalCents: 25400,
    depositRequiredCents: 8000,
    amountDueCents: 25400,
    promoCode: "SAVE10",
    insurancePlanId: null,
    insuranceEnabled: true,
    tags: [],
    comments: null,
    commissionPartnerName: null,
    clientPaysAtPartner: false,
    rackPriceCents: 24000,
    createdByAdminUserId: null,
    lastEmailedAt: null,
    lastEmailedTo: null,
    convertedBookingId: null,
  };
}

test("admin quotes email API: sends email and writes event/email logs", async () => {
  const logs: Array<{ type: string; payload: unknown }> = [];

  const response = await handleAdminQuoteEmailPost(
    new Request("http://localhost/api/admin/quotes/c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ csrfToken: "token", message: "Thanks for considering us." }),
    }),
    { params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      nowMs: () => 1_700_000_000_000,
      getQuote: async () => quoteFixture(),
      consumeRateLimitCheck: async ({ limit }) => ({
        count: 1,
        limit,
        allowed: true,
        remaining: Math.max(0, limit - 1),
        resetAt: "2026-02-22T01:00:00.000Z",
      }),
      buildPdf: () => Buffer.from("%PDF-1.4\nmock", "utf8"),
      sendEmail: async () => ({ ok: true, providerMessageId: "resend-message-id" }),
      updateQuoteLastEmailedAt: async (payload) => {
        logs.push({ type: "update", payload });
      },
      logQuoteEvent: async (payload) => {
        logs.push({ type: "event", payload });
      },
      logQuoteEmail: async (payload) => {
        logs.push({ type: "email", payload });
      },
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; toEmail?: string };
  assert.equal(body.ok, true);
  assert.equal(body.toEmail, "damian@example.com");

  assert.equal(logs.some((entry) => entry.type === "update"), true);
  assert.equal(logs.some((entry) => entry.type === "event"), true);
  assert.equal(logs.some((entry) => entry.type === "email"), true);

  const statusEvent = logs.find(
    (entry) =>
      entry.type === "event" &&
      (entry.payload as { eventType?: string }).eventType === "STATUS_CHANGED",
  ) as { payload: { meta?: { fromStatus?: string; toStatus?: string } } } | undefined;
  assert.equal(statusEvent?.payload.meta?.fromStatus, "DRAFT");
  assert.equal(statusEvent?.payload.meta?.toStatus, "SENT");

  const emailLog = logs.find((entry) => entry.type === "email") as
    | { type: string; payload: { status?: string } }
    | undefined;
  assert.equal(emailLog?.payload?.status, "SENT");
});

test("quote email persistence transitions only draft quotes to sent", async () => {
  let capturedSql = "";
  let capturedParams: unknown[] = [];

  await updateQuoteLastEmailed({
    quoteId: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2",
    toEmail: "damian@example.com",
    client: {
      query: async (text, params = []) => {
        capturedSql = text;
        capturedParams = params;
        return { rows: [], rowCount: 1 };
      },
    },
  });

  assert.match(capturedSql, /case when upper\(status\) = 'DRAFT' then 'SENT' else status end/i);
  assert.deepEqual(capturedParams, [
    "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2",
    "damian@example.com",
  ]);
});

test("admin quotes email API: blocks the 4th quote email in an hour", async () => {
  let quoteRateCount = 0;
  let sendAttempts = 0;

  const makeRequest = () =>
    handleAdminQuoteEmailPost(
      new Request("http://localhost/api/admin/quotes/c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
        body: JSON.stringify({ csrfToken: "token" }),
      }),
      { params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }) },
      {
        getSession: async () => adminSession(),
        requireCsrfCheck: async () => true,
        nowMs: () => 1_700_000_000_000,
        getQuote: async () => quoteFixture(),
        consumeRateLimitCheck: async ({ scope, limit }) => {
          if (scope === "QUOTE_EMAIL_QUOTE") {
            quoteRateCount += 1;
            return {
              count: quoteRateCount,
              limit,
              allowed: quoteRateCount <= limit,
              remaining: Math.max(0, limit - quoteRateCount),
              resetAt: "2026-02-22T01:00:00.000Z",
            };
          }
          return {
            count: 1,
            limit,
            allowed: true,
            remaining: Math.max(0, limit - 1),
            resetAt: "2026-02-22T01:00:00.000Z",
          };
        },
        buildPdf: () => Buffer.from("%PDF-1.4\nmock", "utf8"),
        sendEmail: async () => {
          sendAttempts += 1;
          return { ok: true, providerMessageId: "resend-message-id" };
        },
        updateQuoteLastEmailedAt: async () => undefined,
        logQuoteEvent: async () => undefined,
        logQuoteEmail: async () => undefined,
      },
    );

  const first = await makeRequest();
  const second = await makeRequest();
  const third = await makeRequest();
  const fourth = await makeRequest();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
  assert.equal(fourth.status, 429);
  assert.equal(sendAttempts, 3);
});

test("admin quotes email API: blocks expired quote", async () => {
  let sendAttempted = false;

  const response = await handleAdminQuoteEmailPost(
    new Request("http://localhost/api/admin/quotes/c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      nowMs: () => Date.UTC(2026, 3, 1),
      getQuote: async () => ({
        ...quoteFixture(),
        expiresAt: "2026-03-01T00:00:00.000Z",
      }),
      consumeRateLimitCheck: async ({ limit }) => ({
        count: 1,
        limit,
        allowed: true,
        remaining: Math.max(0, limit - 1),
        resetAt: "2026-02-22T01:00:00.000Z",
      }),
      buildPdf: () => Buffer.from("%PDF-1.4\nmock", "utf8"),
      sendEmail: async () => {
        sendAttempted = true;
        return { ok: true, providerMessageId: "resend-message-id" };
      },
      updateQuoteLastEmailedAt: async () => undefined,
      logQuoteEvent: async () => undefined,
      logQuoteEmail: async () => undefined,
    },
  );

  assert.equal(response.status, 409);
  assert.equal(sendAttempted, false);

  const body = (await response.json()) as { ok: boolean; code?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "QUOTE_EXPIRED");
});
