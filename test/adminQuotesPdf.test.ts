import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminQuoteDocumentGet } from "@/app/api/admin/quotes/[id]/pdf-document/route";
import { handleAdminQuotePdfGet } from "@/app/api/admin/quotes/[id]/pdf/route";
import {
  buildPdfMonkeyQuoteDocumentPayload,
  buildPdfMonkeyQuoteTemplateSampleData,
  buildQuotePdfPayload,
  generateQuotePdfDocument,
  renderPdfMonkeyQuoteTemplateBody,
  resolveQuotePdfProvider,
} from "@/lib/quotes/quotePdf";
import type { QuoteOpsQuote } from "@/lib/quotes/quoteOps";

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: 999999999,
    issuedAt: 999999000,
  };
}

function sampleBookingLocationDetails() {
  return {
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
  };
}

function sampleQuote(): QuoteOpsQuote {
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
    bookingLocationDetails: sampleBookingLocationDetails(),
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

function withPdfMonkeyApiKey<T>(run: () => Promise<T> | T) {
  const originalApiKey = process.env.PDFMONKEY_API_KEY;
  process.env.PDFMONKEY_API_KEY = "test-pdfmonkey-key";

  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (originalApiKey === undefined) {
        delete process.env.PDFMONKEY_API_KEY;
      } else {
        process.env.PDFMONKEY_API_KEY = originalApiKey;
      }
    });
}

test("admin quotes PDF API: returns PDF response for authorized admin", async () => {
  const quote = sampleQuote();
  const response = await handleAdminQuotePdfGet(
    new Request("http://localhost/api/admin/quotes/quote-id/pdf"),
    { params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }) },
    {
      getSession: async () => adminSession(),
      getQuote: async () => quote,
      buildPdf: () => Buffer.from("%PDF-1.4\nmock", "utf8"),
      recordEvent: async () => undefined,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  const disposition = response.headers.get("content-disposition") ?? "";
  assert.equal(disposition.includes("Quote-QU000123.pdf"), true);
});

test("quote PDF payload builder normalizes display fields for provider reuse", () => {
  const payload = buildQuotePdfPayload(sampleQuote());

  assert.equal(payload.displayQuoteId, "QU000123");
  assert.equal(payload.customer.fullName, "Damian Thompson");
  assert.equal(payload.rental.pickupLocationText, "Norman Manley Airport");
  assert.deepEqual(payload.rental.pickupLocationLines, [
    "Norman Manley Airport",
    "Flight Arrival Date: 2026-03-10",
    "Flight Arrival Time: 09:30",
    "Flight Number: BW101",
    "Airline: Caribbean Airlines",
  ]);
  assert.equal(payload.vehicle.className, "SUV");
  assert.equal(payload.display.promoCode, "SAVE10");
  assert.match(payload.pricing.displayBaseTotal, /24,000\.00/);
  assert.match(payload.pricing.displayAmountDue, /25,400\.00/);
  assert.equal(payload.pricingRows.length, 6);
  assert.equal(payload.pricingRows[5]?.highlight, true);
});

test("quote PDF provider defaults to native and PDFMonkey override is allowed", () => {
  assert.equal(resolveQuotePdfProvider(), "native");
  assert.equal(resolveQuotePdfProvider("native"), "native");
  assert.equal(resolveQuotePdfProvider("pdfmonkey"), "pdfmonkey");
});

test("quote PDF document generation returns data URLs for native provider", async () => {
  const quote = sampleQuote();
  const result = await generateQuotePdfDocument({
    quoteId: quote.id,
    quotePublicId: quote.publicId,
    quote,
    payload: buildQuotePdfPayload(quote),
  });

  assert.equal(result.provider, "native");
  assert.equal(result.providerStatus, "SUCCESS");
  assert.equal(result.documentId, null);
  assert.match(result.previewUrl ?? "", /^data:application\/pdf;base64,/);
  assert.equal(result.previewUrl, result.downloadUrl);
});

test("quote PDF document generation safely skips PDFMonkey when template is not configured", async () => {
  const quote = sampleQuote();
  const originalApiKey = process.env.PDFMONKEY_API_KEY;
  const originalTemplateId = process.env.PDFMONKEY_QUOTE_TEMPLATE_ID;
  process.env.PDFMONKEY_API_KEY = "";
  delete process.env.PDFMONKEY_QUOTE_TEMPLATE_ID;

  try {
    const result = await generateQuotePdfDocument(
      {
        quoteId: quote.id,
        quotePublicId: quote.publicId,
        quote,
        payload: buildQuotePdfPayload(quote),
      },
      { provider: "pdfmonkey" },
    );

    assert.equal(result.provider, "pdfmonkey");
    assert.equal(result.providerStatus, "SKIPPED");
    assert.equal(result.previewUrl, null);
    assert.equal(result.downloadUrl, null);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.PDFMONKEY_API_KEY;
    } else {
      process.env.PDFMONKEY_API_KEY = originalApiKey;
    }
    if (originalTemplateId === undefined) {
      delete process.env.PDFMONKEY_QUOTE_TEMPLATE_ID;
    } else {
      process.env.PDFMONKEY_QUOTE_TEMPLATE_ID = originalTemplateId;
    }
  }
});

test("quote PDFMonkey payload and template sample data preserve display-ready fields", async () => {
  const quote = sampleQuote();
  const payload = buildQuotePdfPayload(quote);
  const pdfMonkeyPayload = await buildPdfMonkeyQuoteDocumentPayload(payload);
  const sampleData = await buildPdfMonkeyQuoteTemplateSampleData();
  const templateBody = renderPdfMonkeyQuoteTemplateBody();

  assert.equal(pdfMonkeyPayload.displayQuoteId, "QU000123");
  assert.equal(pdfMonkeyPayload.customer.phone, "+1 876 555 0144");
  assert.equal(pdfMonkeyPayload.vehicle.className, "SUV");
  assert.equal(sampleData.displayQuoteId, "QU000123");
  assert.equal(sampleData.display.promoCode, "SAVE10");
  assert.match(templateBody, /Quote #\{\{ displayQuoteId \}\}/);
  assert.match(templateBody, /Pricing Summary \(JMD\)/);
});

test("quote PDF document generation returns usable metadata for PDFMonkey provider", async () => {
  const quote = sampleQuote();

  await withPdfMonkeyApiKey(async () => {
    let syncedTemplateId: string | null = null;
    let createdTemplateId: string | null = null;
    let createdPayload: Record<string, unknown> | null = null;
    let createdMeta: Record<string, unknown> | null = null;

    const result = await generateQuotePdfDocument(
      {
        quoteId: quote.id,
        quotePublicId: quote.publicId,
        quote,
        payload: buildQuotePdfPayload(quote),
      },
      { provider: "pdfmonkey" },
      {
        getTemplateIdFn: () => "quote-template-1",
        syncPdfMonkeyTemplate: async (templateId) => {
          syncedTemplateId = templateId;
        },
        createPdfMonkeyDocument: async (payload, meta, templateId) => {
          createdPayload = payload;
          createdMeta = meta;
          createdTemplateId = templateId;
          return {
            id: "quote-doc-1",
            status: "success",
            preview_url: "https://pdfmonkey.example/quote-doc-1/preview",
            download_url: "https://pdfmonkey.example/quote-doc-1/download",
          };
        },
      },
    );

    assert.equal(syncedTemplateId, "quote-template-1");
    assert.equal(createdTemplateId, "quote-template-1");
    assert.equal(createdPayload?.displayQuoteId, "QU000123");
    assert.equal(createdMeta?._filename, "quote-QU000123.pdf");
    assert.equal(result.provider, "pdfmonkey");
    assert.equal(result.providerStatus, "success");
    assert.equal(result.documentId, "quote-doc-1");
    assert.equal(result.previewUrl, "https://pdfmonkey.example/quote-doc-1/preview");
    assert.equal(result.downloadUrl, "https://pdfmonkey.example/quote-doc-1/download");
  });
});

test("admin quote document route returns metadata for native provider without email", async () => {
  const quote = sampleQuote();
  const response = await handleAdminQuoteDocumentGet(
    new Request("http://localhost/api/admin/quotes/c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2/pdf-document"),
    { params: Promise.resolve({ id: quote.id }) },
    {
      requireAdminAccess: async () => ({
        ok: true,
        actor: { userId: "admin-user-id", role: "ADMIN", appRole: "ADMIN", authSource: "legacy" },
        session: { userId: "admin-user-id", role: "ADMIN" },
      }) as never,
      loadQuotePayload: async () => ({
        quoteId: quote.id,
        quotePublicId: quote.publicId,
        quote,
        payload: buildQuotePdfPayload(quote),
      }),
      generateQuoteDocument: async () => ({
        provider: "native",
        providerStatus: "SUCCESS",
        documentId: null,
        previewUrl: "data:application/pdf;base64,bW9jaw==",
        downloadUrl: "data:application/pdf;base64,bW9jaw==",
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.quoteId, quote.id);
  assert.equal(body.quotePublicId, "QU000123");
  assert.equal(body.provider, "native");
});

test("admin quote document route honors PDFMonkey override safely", async () => {
  const quote = sampleQuote();
  const response = await handleAdminQuoteDocumentGet(
    new Request(`http://localhost/api/admin/quotes/${quote.id}/pdf-document?provider=pdfmonkey`),
    { params: Promise.resolve({ id: quote.id }) },
    {
      requireAdminAccess: async () => ({
        ok: true,
        actor: { userId: "admin-user-id", role: "ADMIN", appRole: "ADMIN", authSource: "legacy" },
        session: { userId: "admin-user-id", role: "ADMIN" },
      }) as never,
      loadQuotePayload: async () => ({
        quoteId: quote.id,
        quotePublicId: quote.publicId,
        quote,
        payload: buildQuotePdfPayload(quote),
      }),
      generateQuoteDocument: async (_quote, options) => ({
        provider: options.provider ?? "native",
        providerStatus: "SUCCESS",
        documentId: "quote-doc-1",
        previewUrl: "https://pdfmonkey.example/quote-doc-1/preview",
        downloadUrl: "https://pdfmonkey.example/quote-doc-1/download",
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.provider, "pdfmonkey");
  assert.equal(body.providerStatus, "SUCCESS");
  assert.equal(body.documentId, "quote-doc-1");
});

test("admin quote document route rejects invalid provider values", async () => {
  const response = await handleAdminQuoteDocumentGet(
    new Request("http://localhost/api/admin/quotes/c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2/pdf-document?provider=wat"),
    { params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }) },
    {
      requireAdminAccess: async () => ({
        ok: true,
        actor: { userId: "admin-user-id", role: "ADMIN", appRole: "ADMIN", authSource: "legacy" },
        session: { userId: "admin-user-id", role: "ADMIN" },
      }) as never,
      loadQuotePayload: async () => null,
      generateQuoteDocument: async () => ({
        provider: "native",
        providerStatus: "SUCCESS",
        documentId: null,
        previewUrl: null,
        downloadUrl: null,
      }),
    },
  );

  assert.equal(response.status, 400);
});
