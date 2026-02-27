import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminQuoteConvertPost } from "@/app/api/admin/quotes/[id]/convert-to-booking/route";
import { QuoteOpsError } from "@/lib/quotes/quoteOps";

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: 999999999,
    issuedAt: 999999000,
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
        publicId: "Q000123",
        createdAt: "2026-02-22T12:00:00.000Z",
        updatedAt: "2026-02-22T12:00:00.000Z",
        status: "SENT",
        expiresAt: "2030-01-01T00:00:00.000Z",
        customerFullName: "Damian Thompson",
        customerEmail: "damian@example.com",
        customerPhone: "+1 876 555 0144",
        startAt: "2026-03-10T10:00:00.000Z",
        endAt: "2026-03-12T10:00:00.000Z",
        pickupLocationId: null,
        dropoffLocationId: null,
        pickupLocationText: "Montego Bay Airport",
        dropoffLocationText: "Montego Bay Airport",
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
        publicId: "Q000123",
        createdAt: "2026-02-22T12:00:00.000Z",
        updatedAt: "2026-02-22T12:00:00.000Z",
        status: "SENT",
        expiresAt: "2030-01-01T00:00:00.000Z",
        customerFullName: "Damian Thompson",
        customerEmail: "damian@example.com",
        customerPhone: "+1 876 555 0144",
        startAt: "2026-03-10T10:00:00.000Z",
        endAt: "2026-03-12T10:00:00.000Z",
        pickupLocationId: null,
        dropoffLocationId: null,
        pickupLocationText: "Montego Bay Airport",
        dropoffLocationText: "Montego Bay Airport",
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
        publicId: "Q000123",
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
        pickupLocationText: "Montego Bay Airport",
        dropoffLocationText: "Montego Bay Airport",
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
