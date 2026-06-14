import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminQuotePatch } from "@/app/api/admin/quotes/[id]/route";
import { handleAdminQuotesGet, handleAdminQuotesPost } from "@/app/api/admin/quotes/route";
import {
  AdminQuoteError,
  assertAdminQuoteMutable,
  quoteWindowsOverlap,
  type AdminQuoteDetailItem,
  type FetchAdminQuotesInput,
  type UpdateAdminQuoteInput,
} from "@/lib/quotes/adminQuotes";
import { computeBookingPricing } from "@/lib/payments/pricing";

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: 999999999,
    issuedAt: 999999000,
  };
}

function buildQuoteFixture(): AdminQuoteDetailItem {
  const pricing = computeBookingPricing({
    bookingId: "quote-test",
    bookingStatus: "DRAFT",
    startAt: "2026-03-10T10:00:00.000Z",
    endAt: "2026-03-12T10:00:00.000Z",
    dailyRate: 12000,
    deposit: 8000,
    paymentOption: "DEPOSIT",
    netPaidToDate: 0,
    insuranceSelected: true,
    insurancePricePerDay: 1200,
    promoCode: "SAVE10",
    promoDiscount: 1000,
  });

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
    pickupLocationText: "Montego Bay Airport",
    dropoffLocationText: "Montego Bay Airport",
    vehicleId: "6f11f0cf-cedf-4db3-a5fd-64bfe7fded1e",
    vehicleLabel: "Nissan X-Trail",
    vehicleClass: "SUV",
    pricingJson: {
      total_cents: pricing.total,
      subtotal_cents: pricing.subtotal,
      promo_discount_cents: pricing.discountTotal,
      insurance_total_cents: pricing.insuranceTotal,
    },
    baseTotalCents: pricing.baseTotal,
    insuranceTotalCents: pricing.insuranceTotal,
    discountTotalCents: pricing.discountTotal,
    subtotalCents: pricing.subtotal,
    totalCents: pricing.total,
    depositRequiredCents: pricing.depositRequired,
    amountDueCents: pricing.amountDue,
    promoCode: pricing.promoCode,
    insurancePlanId: "54df55bc-d8f3-4951-8f5a-4fd5fee8ff76",
    insuranceEnabled: true,
    tags: ["vip"],
    comments: "Client requested written quote",
    commissionPartnerName: null,
    clientPaysAtPartner: false,
    rackPriceCents: pricing.baseTotal,
    createdByAdminUserId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    lastEmailedAt: null,
    lastEmailedTo: null,
    convertedBookingId: null,
  };
}

test("admin quotes API: POST create quote success", async () => {
  const fixture = buildQuoteFixture();

  const response = await handleAdminQuotesPost(
    new Request("http://localhost/api/admin/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        csrfToken: "token",
        customer_full_name: fixture.customerFullName,
        customer_email: fixture.customerEmail,
        start_at: fixture.startAt,
        end_at: fixture.endAt,
        pickup_location_text: fixture.pickupLocationText,
        dropoff_location_text: fixture.dropoffLocationText,
        vehicle_id: fixture.vehicleId,
      }),
    }),
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      fetchPage: async () => ({ items: [], nextCursor: null, hasMore: false, totalCount: 0, limit: 20 }),
      createQuote: async () => fixture,
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    item: {
      status: string;
      pricingJson: Record<string, unknown>;
      totalCents: number;
      subtotalCents: number;
      discountTotalCents: number;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.item.status, "DRAFT");
  assert.equal(typeof body.item.pricingJson, "object");
  assert.equal(body.item.totalCents, fixture.totalCents);
  assert.equal(body.item.subtotalCents, fixture.subtotalCents);
  assert.equal(body.item.discountTotalCents, fixture.discountTotalCents);
});

test("admin quotes API: POST create quote rejects invalid window", async () => {
  const response = await handleAdminQuotesPost(
    new Request("http://localhost/api/admin/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        csrfToken: "token",
      }),
    }),
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      fetchPage: async () => ({ items: [], nextCursor: null, hasMore: false, totalCount: 0, limit: 20 }),
      createQuote: async () => {
        throw new AdminQuoteError(
          "INVALID_WINDOW",
          "Return date and time must be later than pickup date and time.",
          400,
        );
      },
    },
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as { ok: boolean; code: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "INVALID_WINDOW");
});

test("admin quotes API: GET list forwards status/search/created filters", async () => {
  let captured: FetchAdminQuotesInput = {};

  const response = await handleAdminQuotesGet(
    new Request(
      "http://localhost/api/admin/quotes?status=SENT&q=damian@example.com&createdFrom=2026-02-01&createdTo=2026-02-28",
    ),
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      createQuote: async () => buildQuoteFixture(),
      fetchPage: async (input: FetchAdminQuotesInput) => {
        captured = input;
        return { items: [], nextCursor: null, hasMore: false, totalCount: 0, limit: 20 };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(captured.status, "SENT");
  assert.equal(captured.q, "damian@example.com");
  assert.equal(captured.createdFrom, "2026-02-01");
  assert.equal(captured.createdTo, "2026-02-28");
});

test("admin quotes API: rental overlap predicate includes spanning windows and excludes non-overlap", () => {
  assert.equal(
    quoteWindowsOverlap({
      quoteStartAt: "2026-02-20T00:00:00.000Z",
      quoteEndAt: "2026-02-24T00:00:00.000Z",
      rentalFrom: "2026-02-22T00:00:00.000Z",
      rentalTo: "2026-02-22T23:59:59.999Z",
    }),
    true,
  );

  assert.equal(
    quoteWindowsOverlap({
      quoteStartAt: "2026-03-01T00:00:00.000Z",
      quoteEndAt: "2026-03-03T00:00:00.000Z",
      rentalFrom: "2026-02-22T00:00:00.000Z",
      rentalTo: "2026-02-22T23:59:59.999Z",
    }),
    false,
  );
});

test("admin quotes API: availability rejection returns 409", async () => {
  const response = await handleAdminQuotesPost(
    new Request("http://localhost/api/admin/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        csrfToken: "token",
      }),
    }),
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      fetchPage: async () => ({ items: [], nextCursor: null, hasMore: false, totalCount: 0, limit: 20 }),
      createQuote: async () => {
        throw new AdminQuoteError(
          "VEHICLE_UNAVAILABLE",
          "Vehicle unavailable for the selected rental window.",
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

test("admin quotes API: PATCH forwards status and repricing fields", async () => {
  let capturedPatchInput: UpdateAdminQuoteInput = { id: "" };
  const fixture = buildQuoteFixture();

  const response = await handleAdminQuotePatch(
    new Request(`http://localhost/api/admin/quotes/${fixture.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        csrfToken: "token",
        status: "SENT",
        start_at: "2026-03-11T10:00:00.000Z",
        end_at: "2026-03-13T10:00:00.000Z",
      }),
    }),
    {
      params: Promise.resolve({ id: fixture.id }),
    },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getQuote: async () => fixture,
      patchQuote: async (input) => {
        capturedPatchInput = input;
        return {
          ...fixture,
          status: "SENT",
          startAt: "2026-03-11T10:00:00.000Z",
          endAt: "2026-03-13T10:00:00.000Z",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedPatchInput.status, "SENT");
  assert.equal(capturedPatchInput.startAt, "2026-03-11T10:00:00.000Z");
  assert.equal(capturedPatchInput.endAt, "2026-03-13T10:00:00.000Z");

  const body = (await response.json()) as { ok: boolean; item: { status: string } };
  assert.equal(body.ok, true);
  assert.equal(body.item.status, "SENT");
});

test("admin quotes API: converted quotes are immutable", () => {
  assert.throws(
    () =>
      assertAdminQuoteMutable({
        status: "CONVERTED",
        convertedBookingId: "f37f8ec6-0996-4143-b3e5-6fc06b6de99f",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AdminQuoteError);
      assert.equal(error.code, "QUOTE_IMMUTABLE");
      assert.equal(error.status, 409);
      return true;
    },
  );
});
