import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminQuoteConvertPost } from "@/app/api/admin/quotes/[id]/convert-to-booking/implementation";
import {
  buildQuoteConversionPricingSnapshot,
  QuoteOpsError,
  type QuoteOpsQuote,
} from "@/lib/quotes/quoteOps";

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: 999999999,
    issuedAt: 999999000,
  };
}

function bookingLocationDetails() {
  return {
    pickup: {
      type: "AIRPORT",
      typeKey: "AIRPORT",
      label: "Norman Manley Airport",
      locationId: null,
      values: {
        flight_arrival_date: "2026-03-10",
        flight_arrival_time: "09:30",
      },
      fieldLabels: {
        flight_arrival_date: "Flight Arrival Date",
        flight_arrival_time: "Flight Arrival Time",
      },
      address: null,
      flightDate: "2026-03-10",
      flightTime: "09:30",
      flightNumber: null,
      airline: null,
    },
    dropoff: {
      type: "AIRPORT",
      typeKey: "AIRPORT",
      label: "Norman Manley Airport",
      locationId: null,
      values: {
        flight_departure_date: "2026-03-12",
        flight_departure_time: "13:00",
      },
      fieldLabels: {
        flight_departure_date: "Flight Departure Date",
        flight_departure_time: "Flight Departure Time",
      },
      address: null,
      flightDate: "2026-03-12",
      flightTime: "13:00",
      flightNumber: null,
      airline: null,
    },
  };
}

test("admin quotes convert API: converts quote and returns booking id", async () => {
  const response = await handleAdminQuoteConvertPost(
    new Request("http://localhost/api/admin/quotes/c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2/convert-to-booking", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getQuote: async () => ({
        id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2",
        publicId: "QU000123",
        createdAt: "2026-02-22T12:00:00.000Z",
        updatedAt: "2026-02-22T12:00:00.000Z",
        status: "ACCEPTED",
        expiresAt: "2030-01-01T00:00:00.000Z",
        customerFullName: "Damian Thompson",
        customerEmail: "damian@example.com",
        customerPhone: "+1 876 555 0144",
        startAt: "2026-03-10T10:00:00.000Z",
        endAt: "2026-03-12T10:00:00.000Z",
        pickupLocationId: null,
        dropoffLocationId: null,
        pickupLocationText: "Norman Manley Airport",
        dropoffLocationText: "Norman Manley Airport",
        bookingLocationDetails: bookingLocationDetails(),
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
      }),
      convertQuote: async () => ({
        bookingId: "f37f8ec6-0996-4143-b3e5-6fc06b6de99f",
        alreadyConverted: false,
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    bookingId: string;
    bookingUrl: string;
  };

  assert.equal(body.ok, true);
  assert.equal(body.bookingId, "f37f8ec6-0996-4143-b3e5-6fc06b6de99f");
  assert.equal(body.bookingUrl, "/admin/bookings/f37f8ec6-0996-4143-b3e5-6fc06b6de99f");
});

test("admin quotes convert API: blocks conversion when vehicle availability fails", async () => {
  const response = await handleAdminQuoteConvertPost(
    new Request("http://localhost/api/admin/quotes/c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2/convert-to-booking", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getQuote: async () => ({
        id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2",
        publicId: "QU000123",
        createdAt: "2026-02-22T12:00:00.000Z",
        updatedAt: "2026-02-22T12:00:00.000Z",
        status: "ACCEPTED",
        expiresAt: "2030-01-01T00:00:00.000Z",
        customerFullName: "Damian Thompson",
        customerEmail: "damian@example.com",
        customerPhone: "+1 876 555 0144",
        startAt: "2026-03-10T10:00:00.000Z",
        endAt: "2026-03-12T10:00:00.000Z",
        pickupLocationId: null,
        dropoffLocationId: null,
        pickupLocationText: "Norman Manley Airport",
        dropoffLocationText: "Norman Manley Airport",
        bookingLocationDetails: bookingLocationDetails(),
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
      }),
      convertQuote: async () => {
        throw new QuoteOpsError(
          "VEHICLE_UNAVAILABLE",
          "Vehicle is no longer available for the selected rental window.",
          409,
        );
      },
    },
  );

  assert.equal(response.status, 409);
  const body = (await response.json()) as { ok: boolean; code: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "VEHICLE_UNAVAILABLE");
});

test("admin quotes convert API: blocks expired quote before conversion", async () => {
  let convertCalled = false;

  const response = await handleAdminQuoteConvertPost(
    new Request("http://localhost/api/admin/quotes/c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2/convert-to-booking", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getQuote: async () => ({
        id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2",
        publicId: "QU000123",
        createdAt: "2026-02-22T12:00:00.000Z",
        updatedAt: "2026-02-22T12:00:00.000Z",
        status: "EXPIRED",
        expiresAt: "2020-01-01T00:00:00.000Z",
        customerFullName: "Damian Thompson",
        customerEmail: "damian@example.com",
        customerPhone: "+1 876 555 0144",
        startAt: "2026-03-10T10:00:00.000Z",
        endAt: "2026-03-12T10:00:00.000Z",
        pickupLocationId: null,
        dropoffLocationId: null,
        pickupLocationText: "Norman Manley Airport",
        dropoffLocationText: "Norman Manley Airport",
        bookingLocationDetails: bookingLocationDetails(),
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
      }),
      convertQuote: async () => {
        convertCalled = true;
        return { bookingId: "ignored", alreadyConverted: false };
      },
    },
  );

  assert.equal(response.status, 409);
  assert.equal(convertCalled, false);

  const body = (await response.json()) as { ok: boolean; code?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "QUOTE_EXPIRED");
});

test("admin quotes convert API: blocks quotes that have not been accepted", async () => {
  let convertCalled = false;
  const quote = {
    ...quoteFixtureForSnapshot(),
    status: "SENT",
  };

  const response = await handleAdminQuoteConvertPost(
    new Request(`http://localhost/api/admin/quotes/${quote.id}/convert-to-booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: quote.id }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getQuote: async () => quote,
      convertQuote: async () => {
        convertCalled = true;
        return { bookingId: "ignored", alreadyConverted: false };
      },
    },
  );

  assert.equal(response.status, 409);
  assert.equal(convertCalled, false);
  const body = (await response.json()) as { code?: string };
  assert.equal(body.code, "QUOTE_NOT_ACCEPTED");
});

function quoteFixtureForSnapshot(): QuoteOpsQuote {
  return {
    id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2",
    publicId: "QU000123",
    createdAt: "2026-02-22T12:00:00.000Z",
    updatedAt: "2026-02-22T12:00:00.000Z",
    status: "ACCEPTED",
    expiresAt: "2030-01-01T00:00:00.000Z",
    customerFullName: "Damian Thompson",
    customerEmail: "damian@example.com",
    customerPhone: "+1 876 555 0144",
    startAt: "2026-03-10T10:00:00.000Z",
    endAt: "2026-03-12T10:00:00.000Z",
    pickupLocationId: null,
    dropoffLocationId: null,
    pickupLocationText: "Norman Manley Airport",
    dropoffLocationText: "Norman Manley Airport",
    bookingLocationDetails: bookingLocationDetails(),
    vehicleId: "6f11f0cf-cedf-4db3-a5fd-64bfe7fded1e",
    vehicleLabel: "Nissan X-Trail",
    vehicleClass: "SUV",
    pricingJson: {
      daily_rate_cents: 12000,
      insurance_price_per_day_cents: 1200,
      delivery_fee_cents: 2500,
      payment_option_selected: "DEPOSIT",
    },
    baseTotalCents: 24000,
    insuranceTotalCents: 2400,
    discountTotalCents: 1000,
    subtotalCents: 28900,
    totalCents: 27900,
    depositRequiredCents: 8000,
    amountDueCents: 8000,
    promoCode: "SAVE10",
    insurancePlanId: null,
    insuranceEnabled: true,
    tags: [],
    comments: null,
    commissionPartnerName: null,
    clientPaysAtPartner: false,
    rackPriceCents: 30000,
    createdByAdminUserId: null,
    lastEmailedAt: null,
    lastEmailedTo: null,
    convertedBookingId: null,
  };
}

test("quote conversion pricing uses the accepted quote snapshot without repricing", () => {
  const quote = quoteFixtureForSnapshot();
  const snapshot = buildQuoteConversionPricingSnapshot(quote);

  assert.deepEqual(snapshot.summary, {
    baseTotalCents: 24000,
    insuranceTotalCents: 2400,
    discountTotalCents: 1000,
    subtotalCents: 28900,
    totalCents: 27900,
    depositRequiredCents: 8000,
    amountDueCents: 8000,
  });
  assert.equal(snapshot.rackPriceCents, 30000);
  assert.equal(snapshot.pricingJson.delivery_fee_cents, 2500);
  assert.equal(snapshot.pricingJson.total_cents, 27900);
});
