import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildPdfMonkeyInvoiceDocumentPayload,
  buildPdfMonkeyInvoiceTemplateSampleData,
  buildPdfMonkeyRentalAgreementDocumentPayload,
  generateInvoicePdfWithDeps,
  generateRentalAgreementPdfWithDeps,
  renderPdfMonkeyRentalAgreementTemplateBody,
  renderPdfMonkeyInvoiceTemplateBody,
  resolveInvoicePdfProvider,
  resolveRentalAgreementPdfProvider,
} from "@/lib/pdfmonkey";
import { getInvoiceProvider } from "@/lib/env";
import { handleAdminBookingInvoiceDocumentGet } from "@/app/api/admin/bookings/[id]/invoice-document/route";
import { handleAdminBookingAgreementDocumentGet } from "@/app/api/admin/bookings/[id]/agreement-document/route";
import { loadBookingRentalAgreementPayload } from "@/lib/agreements/rentalAgreementPayload";
import type { RequireAdminApiSessionResult } from "@/lib/auth/adminGuards";

function authorizedStaffResult(): RequireAdminApiSessionResult {
  return {
    ok: true,
    actor: {
      userId: "admin-user-id",
      role: "ADMIN",
      appRole: "ADMIN",
      authSource: "legacy",
      clerkUserId: null,
      issuedAt: 0,
      expiresAt: 0,
    },
    session: {
      userId: "admin-user-id",
      role: "ADMIN",
      issuedAt: 0,
      expiresAt: 0,
      source: "legacy",
      clerkUserId: null,
    },
  };
}

function sampleInvoicePayload() {
  return {
    booking: {
      id: "11111111-1111-4111-8111-111111111111",
      public_id: "BK000334",
      reference: "BK000334",
      invoice_number: "BK000334",
      status: "CONFIRMED",
      pickup_location: "166 old hope road",
      start_date: "2026-03-15T05:00:00.000Z",
      end_date: "2026-03-17T05:00:00.000Z",
    },
    customer: {
      name: "Damian Thompson",
      email: "damian.ay.thompson@gmail.com",
      phone: "8765447059",
      address: "1 Test Lane, Kingston",
    },
    vehicle: {
      make: "Honda",
      model: "Fit",
      year: 2020,
      daily_rate: 6200,
    },
    charges: {
      total: 18600,
      deposit: 1860,
      base_total: 18600,
      insurance_total: 0,
      promo_discount: 0,
      promo_code: null,
      paid_to_date: 1860,
      balance_due: 16740,
    },
    payments: [
      {
        provider: "MANUAL",
        status: "DEPOSIT_PAID",
        amount: 1860,
        date: "2026-03-15T01:48:41.966Z",
      },
    ],
    issued_at: "2026-03-15T03:21:51.903Z",
  };
}

function sampleRentalAgreementPayload() {
  return {
    booking: {
      id: "11111111-1111-4111-8111-111111111111",
      reference: "BK000334",
      status: "CONFIRMED",
      pickup_location: "166 old hope road",
      return_location: "166 old hope road",
      start_date: "2026-03-15T05:00:00.000Z",
      end_date: "2026-03-17T05:00:00.000Z",
    },
    customer: {
      name: "Damian Thompson",
      email: "damian.ay.thompson@gmail.com",
      phone: "8765447059",
      address: "42 Limestone Crescent, Phoenix Park, Spanish Town, St. Catherine, Jamaica",
    },
    vehicle: {
      make: "Honda",
      model: "Fit",
      year: 2020,
      daily_rate: 6200,
    },
    charges: {
      total: 18600,
      deposit: 1860,
      paid_to_date: 1860,
      balance_due: 16740,
      payment_method: "Cash",
    },
    signature: {
      image_data_url:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx7kAAAAASUVORK5CYII=",
      signed_at: "2026-03-15T03:21:51.903Z",
    },
    issued_at: "2026-03-15T03:21:51.903Z",
  };
}

test("invoice PDF generation: explicit PDFMonkey override stores ledger metadata", async () => {
  const ledgerUpdates: Array<Record<string, unknown>> = [];
  let syncedTemplate = false;
  let receivedPayload: Record<string, unknown> | null = null;

  const result = await generateInvoicePdfWithDeps(
    sampleInvoicePayload(),
    "11111111-1111-4111-8111-111111111111",
    {
      provider: "pdfmonkey",
      source: "ADMIN_INTERNAL_INVOICE",
    },
    {
      getOrCreateLedgerRow: async () => ({
        id: "ledger-1",
        bookingId: "11111111-1111-4111-8111-111111111111",
        payloadHash: "payload-hash",
      }),
      markLedgerInfo: async (input) => {
        ledgerUpdates.push(input as Record<string, unknown>);
      },
      syncPdfMonkeyTemplate: async () => {
        syncedTemplate = true;
      },
      createGotenbergDocument: async () => {
        throw new Error("Gotenberg should not be used for explicit PDFMonkey invoice generation");
      },
      createPdfMonkeyDocument: async (payload) => {
        receivedPayload = payload;
        return {
          id: "pdfmonkey-doc-1",
          status: "success",
          download_url: "https://pdfmonkey.example.com/download/1",
          preview_url: "https://pdfmonkey.example.com/preview/1",
        };
      },
      fetchPdfMonkeyDocument: async () => null,
      logErrorFn: () => undefined,
      getTemplateIdFn: () => "template-1",
    },
  );

  assert.equal(result.provider, "pdfmonkey");
  assert.equal(result.providerStatus, "success");
  assert.equal(result.documentId, "pdfmonkey-doc-1");
  assert.equal(result.previewUrl, "https://pdfmonkey.example.com/preview/1");
  assert.equal(result.downloadUrl, "https://pdfmonkey.example.com/download/1");
  assert.equal(syncedTemplate, true);
  const typedPayload = receivedPayload as {
    booking?: { display_public_id?: string };
    vehicle?: { display_label?: string };
    charges?: { display_balance_due?: string };
    payments?: Array<{ amount_display?: string }>;
  } | null;
  assert.equal(typedPayload?.booking?.display_public_id, "BK000334");
  assert.equal(typedPayload?.vehicle?.display_label, "Honda Fit");
  assert.match(typedPayload?.charges?.display_balance_due ?? "", /16,740\.00/);
  assert.match(typedPayload?.payments?.[0]?.amount_display ?? "", /1,860\.00/);
  assert.deepEqual(ledgerUpdates[0], {
    ledgerId: "ledger-1",
    providerDocumentId: "pdfmonkey-doc-1",
    providerStatus: "success",
    downloadUrl: "https://pdfmonkey.example.com/download/1",
  });
});

test("invoice PDF generation: PDFMonkey skips cleanly when internal test path is not configured", async () => {
  const ledgerUpdates: Array<Record<string, unknown>> = [];

  const result = await generateInvoicePdfWithDeps(
    { booking: { id: "booking-1" } },
    "11111111-1111-4111-8111-111111111111",
    {
      provider: "pdfmonkey",
    },
    {
      getOrCreateLedgerRow: async () => ({
        id: "ledger-1",
        bookingId: "11111111-1111-4111-8111-111111111111",
        payloadHash: "payload-hash",
      }),
      markLedgerInfo: async (input) => {
        ledgerUpdates.push(input as Record<string, unknown>);
      },
      createPdfMonkeyDocument: async () => null,
      syncPdfMonkeyTemplate: async () => undefined,
      fetchPdfMonkeyDocument: async () => null,
      logErrorFn: () => undefined,
      getTemplateIdFn: () => null,
    },
  );

  assert.equal(result.provider, "pdfmonkey");
  assert.equal(result.providerStatus, "SKIPPED");
  assert.equal(result.previewUrl, undefined);
  assert.equal(result.downloadUrl, undefined);
  assert.deepEqual(ledgerUpdates[0], {
    ledgerId: "ledger-1",
    providerStatus: "SKIPPED",
  });
});

test("invoice default provider now resolves to PDFMonkey even if legacy PDF_PROVIDER is gotenberg", () => {
  const previousInvoiceProvider = process.env.INVOICE_PDF_PROVIDER;
  const previousSharedProvider = process.env.PDF_PROVIDER;

  process.env.INVOICE_PDF_PROVIDER = "";
  process.env.PDF_PROVIDER = "gotenberg";

  try {
    assert.equal(getInvoiceProvider(), "pdfmonkey");
    assert.equal(resolveInvoicePdfProvider(), "pdfmonkey");
  } finally {
    if (previousInvoiceProvider === undefined) {
      delete process.env.INVOICE_PDF_PROVIDER;
    } else {
      process.env.INVOICE_PDF_PROVIDER = previousInvoiceProvider;
    }

    if (previousSharedProvider === undefined) {
      delete process.env.PDF_PROVIDER;
    } else {
      process.env.PDF_PROVIDER = previousSharedProvider;
    }
  }
});

test("invoice default provider can still be set to Gotenberg explicitly", () => {
  const previousInvoiceProvider = process.env.INVOICE_PDF_PROVIDER;

  process.env.INVOICE_PDF_PROVIDER = "gotenberg";

  try {
    assert.equal(getInvoiceProvider(), "gotenberg");
    assert.equal(resolveInvoicePdfProvider(), "gotenberg");
    assert.equal(resolveInvoicePdfProvider("pdfmonkey"), "pdfmonkey");
  } finally {
    if (previousInvoiceProvider === undefined) {
      delete process.env.INVOICE_PDF_PROVIDER;
    } else {
      process.env.INVOICE_PDF_PROVIDER = previousInvoiceProvider;
    }
  }
});

test("shared rental agreement payload loader normalizes booking, payment, and signature context", async () => {
  const result = await loadBookingRentalAgreementPayload(
    "11111111-1111-4111-8111-111111111111",
    {
      loadBooking: async () => ({
        id: "11111111-1111-4111-8111-111111111111",
        public_id: "BK000334",
        start_date: "2026-03-15T05:00:00.000Z",
        end_date: "2026-03-17T05:00:00.000Z",
        pickup_location: "166 old hope road",
        dropoff_location: null,
        status: "CONFIRMED",
        pricing_json: {
          booking_location_details: {
            pickup: {
              typeKey: "AIRPORT",
              label: "Norman Manley Airport",
              values: {
                flight_arrival_date: "2026-03-15",
                flight_arrival_time: "08:45",
                flight_number: "BW101",
                airline: "Caribbean Airlines",
              },
              fieldLabels: {
                flight_arrival_date: "Flight Arrival Date",
                flight_arrival_time: "Flight Arrival Time",
                flight_number: "Flight Number",
                airline: "Airline",
              },
            },
            dropoff: {
              typeKey: "CUSTOM_ADDRESS",
              label: "Return Address",
              values: {
                return_address: "1 Test Lane, Kingston",
              },
              fieldLabels: {
                return_address: "Return Address",
              },
            },
          },
          daily_rate_cents: 6200,
          deposit_cents: 1860,
          base_total_cents: 18600,
          total_cents: 18600,
          amount_due_cents: 18600,
        },
        customer_name: "Damian Thompson",
        customer_email: "damian.ay.thompson@gmail.com",
        customer_phone: "8765447059",
        customer_address: null,
        customer_street: "42 Limestone Crescent",
        customer_street2: "Phoenix Park",
        customer_city: "Spanish Town",
        customer_state: "St. Catherine",
        customer_country: "Jamaica",
        vehicle_make: "Honda",
        vehicle_model: "Fit",
        vehicle_year: 2020,
        daily_rate_cents: 6200,
        deposit_cents: 1860,
      }),
      loadPayments: async () => [
        {
          provider: "MANUAL",
          status: "DEPOSIT_PAID",
          deposit_amount_cents: 1860,
          created_at: "2026-03-15T01:48:41.966Z",
          metadata_json: { method_label: "Cash", payment_type: "deposit" },
        },
      ],
      loadSignature: async () => ({
        signatureDataUrl: "data:image/png;base64,Zm9v",
        signedAt: "2026-03-15T03:21:51.903Z",
      }),
      fetchNetPaidToDateFn: async () => 1860,
    },
  );

  assert.equal(result?.bookingPublicId, "BK000334");
  assert.equal(result?.paymentMethod, "Cash");
  assert.equal(result?.paymentCount, 1);
  assert.equal(result?.payload.booking.reference, "BK000334");
  assert.equal(result?.payload.customer.name, "Damian Thompson");
  assert.equal(result?.payload.signature.image_data_url, "data:image/png;base64,Zm9v");
  assert.equal(result?.payload.signature.signed_at, "2026-03-15T03:21:51.903Z");
  assert.equal(result?.payload.charges.payment_method, "Cash");
  assert.equal(result?.payload.charges.paid_to_date, 1860);
  assert.equal(result?.payload.charges.balance_due, 16740);
  assert.match(String(result?.payload.booking.pickup_location ?? ""), /Norman Manley Airport/);
  assert.match(String(result?.payload.booking.pickup_location ?? ""), /Flight Number: BW101/);
  assert.match(String(result?.payload.booking.return_location ?? ""), /Return Address/);
});

test("shared rental agreement payload loader remains safe when signature is missing", async () => {
  const result = await loadBookingRentalAgreementPayload(
    "11111111-1111-4111-8111-111111111111",
    {
      loadBooking: async () => ({
        id: "11111111-1111-4111-8111-111111111111",
        public_id: "BK000334",
        start_date: "2026-03-15",
        end_date: "2026-03-17",
        pickup_location: "166 old hope road",
        dropoff_location: "166 old hope road",
        status: "PENDING_PAYMENT",
        pricing_json: {
          booking_location_details: {
            pickup: {
              typeKey: "OFFICE",
              label: "168 1/2 Old Hope Road, Kingston Jamaica",
              values: {},
              fieldLabels: {},
            },
            dropoff: {
              typeKey: "OFFICE",
              label: "168 1/2 Old Hope Road, Kingston Jamaica",
              values: {},
              fieldLabels: {},
            },
          },
          daily_rate_cents: 6200,
          deposit_cents: 1860,
          total_cents: 18600,
          amount_due_cents: 18600,
        },
        customer_name: "Damian Thompson",
        customer_email: "damian.ay.thompson@gmail.com",
        customer_phone: "8765447059",
        customer_address: "1 Test Lane, Kingston",
        customer_street: null,
        customer_street2: null,
        customer_city: null,
        customer_state: null,
        customer_country: null,
        vehicle_make: "Honda",
        vehicle_model: "Fit",
        vehicle_year: 2020,
        daily_rate_cents: 6200,
        deposit_cents: 1860,
      }),
      loadPayments: async () => [],
      loadSignature: async () => ({
        signatureDataUrl: null,
        signedAt: "",
      }),
      fetchNetPaidToDateFn: async () => 0,
    },
  );

  assert.equal(result?.payload.signature.image_data_url, "");
  assert.equal(result?.payload.charges.payment_method, "Not specified");
});

test("rental agreement PDF generation stays on Gotenberg", async () => {
  let requestedDocumentType: string | undefined;

  const result = await generateRentalAgreementPdfWithDeps(
    { booking: { id: "booking-1" } },
    {},
    {
      createGotenbergDocument: async (_payload, options) => {
        requestedDocumentType = options?.documentType;
        return {
          downloadUrl: "https://gotenberg.example.com/agreement.pdf",
          previewUrl: "https://gotenberg.example.com/agreement-preview.pdf",
          documentId: "gotenberg-doc-1",
        };
      },
    },
  );

  assert.equal(result.provider, "gotenberg");
  assert.equal(result.providerStatus, "SUCCESS");
  assert.equal(requestedDocumentType, "rental_agreement");
});

test("rental agreement default provider stays on Gotenberg but explicit PDFMonkey override is allowed", () => {
  assert.equal(resolveRentalAgreementPdfProvider(), "gotenberg");
  assert.equal(resolveRentalAgreementPdfProvider("pdfmonkey"), "pdfmonkey");
});

test("rental agreement PDFMonkey override skips cleanly when no agreement template is configured", async () => {
  const result = await generateRentalAgreementPdfWithDeps(
    { booking: { id: "booking-1", reference: "BK000334" } },
    {
      provider: "pdfmonkey",
    },
    {
      getTemplateIdFn: () => null,
      createPdfMonkeyDocument: async () => {
        throw new Error("createPdfMonkeyDocument should not run without a template id");
      },
    },
  );

  assert.equal(result.provider, "pdfmonkey");
  assert.equal(result.providerStatus, "SKIPPED");
});

test("rental agreement PDFMonkey override syncs template and uses parity payload", async () => {
  let syncedTemplateId: string | null = null;
  let receivedTemplateId: string | null = null;
  let receivedPayload: Record<string, unknown> | null = null;

  const result = await generateRentalAgreementPdfWithDeps(
    sampleRentalAgreementPayload(),
    {
      provider: "pdfmonkey",
    },
    {
      getTemplateIdFn: () => "agreement-template-1",
      syncPdfMonkeyTemplate: async (templateId) => {
        syncedTemplateId = templateId;
      },
      createPdfMonkeyDocument: async (payload, _meta, templateId) => {
        receivedPayload = payload;
        receivedTemplateId = templateId;
        return {
          id: "agreement-doc-1",
          status: "success",
          download_url: "https://pdfmonkey.example.com/download/agreement-1",
          preview_url: "https://pdfmonkey.example.com/preview/agreement-1",
        };
      },
      fetchPdfMonkeyDocument: async () => null,
    },
  );

  const typedPayload = receivedPayload as {
    booking?: { display_reference?: string; display_id?: string; display_start_date?: string };
    charges?: { display_total?: string };
    signature?: { has_image?: boolean };
    condition?: { has_image?: boolean };
  } | null;

  assert.equal(result.provider, "pdfmonkey");
  assert.equal(result.providerStatus, "success");
  assert.equal(result.documentId, "agreement-doc-1");
  assert.equal(syncedTemplateId, "agreement-template-1");
  assert.equal(receivedTemplateId, "agreement-template-1");
  assert.equal(typedPayload?.booking?.display_reference, "BK000334");
  assert.equal(typedPayload?.booking?.display_id, "BK000334");
  assert.equal(typedPayload?.booking?.display_start_date, "15 Mar 2026");
  assert.match(typedPayload?.charges?.display_total ?? "", /18,600\.00/);
  assert.equal(typedPayload?.signature?.has_image, true);
  assert.equal(typedPayload?.condition?.has_image, true);
});

test("PDFMonkey invoice parity helpers keep core invoice structure and labels aligned", async () => {
  const payload = await buildPdfMonkeyInvoiceDocumentPayload(sampleInvoicePayload());
  const templateBody = renderPdfMonkeyInvoiceTemplateBody();

  assert.equal(payload.booking.display_public_id, "BK000334");
  assert.equal(payload.booking.display_start_date, "15 Mar 2026");
  assert.equal(payload.booking.display_end_date, "17 Mar 2026");
  assert.match(payload.vehicle.display_daily_rate, /6,200\.00/);
  assert.match(payload.charges.display_base_total, /18,600\.00/);
  assert.match(payload.charges.display_deposit, /0\.00/);
  assert.match(payload.charges.display_paid_to_date, /1,860\.00/);
  assert.match(payload.charges.display_balance_due, /16,740\.00/);
  assert.match(templateBody, /Invoice Details/);
  assert.match(templateBody, /Balance due on pickup/);
  assert.match(templateBody, /Payment Method/);
});

test("PDFMonkey invoice template sample data stays display-ready for dashboard preview", async () => {
  const sample = await buildPdfMonkeyInvoiceTemplateSampleData();

  assert.equal(sample.booking.display_public_id, "BK000334");
  assert.equal(sample.booking.display_invoice_number, "BK000334");
  assert.equal(sample.booking.display_start_date, "15 Mar 2026");
  assert.equal(sample.booking.display_due_date, "15 Mar 2026");
  assert.equal(sample.booking.display_pickup_location, "166 old hope road");
  assert.match(sample.charges.display_base_total, /18,600\.00/);
  assert.match(sample.charges.display_paid_to_date, /1,860\.00/);
  assert.equal(sample.payments[0].provider_label, "MANUAL");
  assert.equal(sample.payments[0].status_label, "DEPOSIT_PAID");
});

test("PDFMonkey rental agreement parity helpers keep core agreement structure and labels aligned", async () => {
  const payload = await buildPdfMonkeyRentalAgreementDocumentPayload(sampleRentalAgreementPayload());
  const templateBody = renderPdfMonkeyRentalAgreementTemplateBody();

  assert.equal(payload.booking.display_reference, "BK000334");
  assert.equal(payload.booking.display_id, "BK000334");
  assert.equal(payload.booking.display_start_date, "15 Mar 2026");
  assert.equal(payload.booking.display_end_date, "17 Mar 2026");
  assert.equal(payload.vehicle.display_label, "Honda Fit");
  assert.match(payload.vehicle.display_daily_rate, /6,200\.00/);
  assert.equal(payload.vehicle.display_rental_days, "3");
  assert.match(payload.charges.display_total, /18,600\.00/);
  assert.match(payload.charges.display_balance_due, /16,740\.00/);
  assert.equal(payload.signature.has_image, true);
  assert.match(payload.condition.image_data_url, /^data:image\/jpeg/);
  assert.match(templateBody, /Rental Agreement/);
  assert.match(templateBody, /Vehicle Condition Diagram/);
  assert.match(templateBody, /Terms & Conditions/);
  assert.match(templateBody, /Signature/);
});

test("admin invoice document route exposes internal metadata without email", async () => {
  let generateOptions: Record<string, unknown> | null = null;

  const response = await handleAdminBookingInvoiceDocumentGet(
    new Request(
      "http://localhost/api/admin/bookings/11111111-1111-4111-8111-111111111111/invoice-document?provider=pdfmonkey",
    ),
    {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      loadInvoicePayload: async () => ({
        bookingId: "11111111-1111-4111-8111-111111111111",
        payload: { booking: { id: "11111111-1111-4111-8111-111111111111" } },
      }),
      generateInvoice: async (_payload, _bookingId, options) => {
        generateOptions = options as Record<string, unknown>;
        return {
          provider: "pdfmonkey",
          providerStatus: "SUCCESS",
          documentId: "pdfmonkey-doc-1",
          previewUrl: "https://pdfmonkey.example.com/preview/1",
          downloadUrl: "https://pdfmonkey.example.com/download/1",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok: boolean;
    provider: string;
    providerStatus: string;
    documentId: string | null;
    previewUrl: string | null;
    downloadUrl: string | null;
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.provider, "pdfmonkey");
  assert.equal(payload.providerStatus, "SUCCESS");
  assert.equal(payload.documentId, "pdfmonkey-doc-1");
  assert.equal(payload.previewUrl, "https://pdfmonkey.example.com/preview/1");
  assert.equal(payload.downloadUrl, "https://pdfmonkey.example.com/download/1");
  assert.equal(generateOptions?.provider, "pdfmonkey");
  assert.equal(generateOptions?.source, "ADMIN_INTERNAL_INVOICE");
});

test("admin invoice document route also supports explicit Gotenberg provider", async () => {
  let generateOptions: Record<string, unknown> | null = null;

  const response = await handleAdminBookingInvoiceDocumentGet(
    new Request(
      "http://localhost/api/admin/bookings/11111111-1111-4111-8111-111111111111/invoice-document?provider=gotenberg",
    ),
    {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      loadInvoicePayload: async () => ({
        bookingId: "11111111-1111-4111-8111-111111111111",
        payload: { booking: { id: "11111111-1111-4111-8111-111111111111" } },
      }),
      generateInvoice: async (_payload, _bookingId, options) => {
        generateOptions = options as Record<string, unknown>;
        return {
          provider: "gotenberg",
          providerStatus: "SUCCESS",
          documentId: null,
          previewUrl: "data:application/pdf;base64,Zm9v",
          downloadUrl: "data:application/pdf;base64,Zm9v",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok: boolean;
    provider: string;
    providerStatus: string;
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.provider, "gotenberg");
  assert.equal(payload.providerStatus, "SUCCESS");
  assert.equal(generateOptions?.provider, "gotenberg");
  assert.equal(generateOptions?.source, "ADMIN_INTERNAL_INVOICE");
});

test("admin invoice document route rejects invalid provider values", async () => {
  const response = await handleAdminBookingInvoiceDocumentGet(
    new Request(
      "http://localhost/api/admin/bookings/11111111-1111-4111-8111-111111111111/invoice-document?provider=invalid",
    ),
    {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      loadInvoicePayload: async () => null,
      generateInvoice: async () => {
        throw new Error("generateInvoice should not run for invalid provider");
      },
    },
  );

  assert.equal(response.status, 400);
});

test("admin invoice document route returns structured provider errors instead of crashing", async () => {
  const response = await handleAdminBookingInvoiceDocumentGet(
    new Request(
      "http://localhost/api/admin/bookings/11111111-1111-4111-8111-111111111111/invoice-document?provider=pdfmonkey",
    ),
    {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      loadInvoicePayload: async () => ({
        bookingId: "11111111-1111-4111-8111-111111111111",
        payload: { booking: { id: "11111111-1111-4111-8111-111111111111" } },
      }),
      generateInvoice: async () => {
        throw new Error("PDFMonkey request failed: HTTP 422: template payload invalid");
      },
    },
  );

  assert.equal(response.status, 502);
  const payload = (await response.json()) as {
    ok: boolean;
    provider: string;
    providerStatus: string;
    error: string;
  };
  assert.equal(payload.ok, false);
  assert.equal(payload.provider, "pdfmonkey");
  assert.equal(payload.providerStatus, "FAILED");
  assert.match(payload.error, /PDFMonkey request failed/i);
});

test("admin invoice document route stays decoupled from email senders", () => {
  const source = readFileSync(
    "/Users/damianthompson/curated-car-rentals/src/app/api/admin/bookings/[id]/invoice-document/route.ts",
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /sendBookingCreatedEmail|sendDepositReceiptEmail|sendPaymentUpdateEmail|sendPaymentCompleteEmail/,
  );
});

test("admin agreement document route exposes internal metadata without email", async () => {
  let generateOptions: Record<string, unknown> | null = null;

  const response = await handleAdminBookingAgreementDocumentGet(
    new Request(
      "http://localhost/api/admin/bookings/11111111-1111-4111-8111-111111111111/agreement-document?provider=pdfmonkey",
    ),
    {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      loadAgreementPayload: async () => ({
        bookingId: "11111111-1111-4111-8111-111111111111",
        bookingPublicId: "BK000334",
        paymentMethod: "Cash",
        paymentCount: 1,
        payload: { booking: { id: "11111111-1111-4111-8111-111111111111" } },
        summary: {
          bookingId: "11111111-1111-4111-8111-111111111111",
        } as never,
        signatureDataUrl: null,
        signedAt: "",
      }),
      generateAgreement: async (_payload, options) => {
        generateOptions = options as Record<string, unknown>;
        return {
          provider: "pdfmonkey",
          providerStatus: "SUCCESS",
          documentId: "pdfmonkey-agreement-1",
          previewUrl: "https://pdfmonkey.example.com/preview/agreement-1",
          downloadUrl: "https://pdfmonkey.example.com/download/agreement-1",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok: boolean;
    bookingPublicId: string;
    provider: string;
    providerStatus: string;
    documentId: string | null;
    previewUrl: string | null;
    downloadUrl: string | null;
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.bookingPublicId, "BK000334");
  assert.equal(payload.provider, "pdfmonkey");
  assert.equal(payload.providerStatus, "SUCCESS");
  assert.equal(payload.documentId, "pdfmonkey-agreement-1");
  assert.equal(payload.previewUrl, "https://pdfmonkey.example.com/preview/agreement-1");
  assert.equal(payload.downloadUrl, "https://pdfmonkey.example.com/download/agreement-1");
  assert.equal(generateOptions?.provider, "pdfmonkey");
});

test("admin agreement document route defaults to Gotenberg", async () => {
  let generateOptions: Record<string, unknown> | null = null;

  const response = await handleAdminBookingAgreementDocumentGet(
    new Request(
      "http://localhost/api/admin/bookings/11111111-1111-4111-8111-111111111111/agreement-document",
    ),
    {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      loadAgreementPayload: async () => ({
        bookingId: "11111111-1111-4111-8111-111111111111",
        bookingPublicId: "BK000334",
        paymentMethod: "Cash",
        paymentCount: 1,
        payload: { booking: { id: "11111111-1111-4111-8111-111111111111" } },
        summary: {
          bookingId: "11111111-1111-4111-8111-111111111111",
        } as never,
        signatureDataUrl: null,
        signedAt: "",
      }),
      generateAgreement: async (_payload, options) => {
        generateOptions = options as Record<string, unknown>;
        return {
          provider: "gotenberg",
          providerStatus: "SUCCESS",
          documentId: null,
          previewUrl: "data:application/pdf;base64,Zm9v",
          downloadUrl: "data:application/pdf;base64,Zm9v",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok: boolean;
    provider: string;
    providerStatus: string;
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.provider, "gotenberg");
  assert.equal(payload.providerStatus, "SUCCESS");
  assert.equal(generateOptions?.provider, undefined);
});

test("admin agreement document route rejects invalid provider values", async () => {
  const response = await handleAdminBookingAgreementDocumentGet(
    new Request(
      "http://localhost/api/admin/bookings/11111111-1111-4111-8111-111111111111/agreement-document?provider=invalid",
    ),
    {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    },
    {
      requireAdminAccess: async () => authorizedStaffResult(),
      loadAgreementPayload: async () => null,
      generateAgreement: async () => {
        throw new Error("generateAgreement should not run for invalid provider");
      },
    },
  );

  assert.equal(response.status, 400);
});

test("admin agreement document route stays decoupled from email senders", () => {
  const source = readFileSync(
    "/Users/damianthompson/curated-car-rentals/src/app/api/admin/bookings/[id]/agreement-document/route.ts",
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /sendBookingCreatedEmail|sendDepositReceiptEmail|sendPaymentUpdateEmail|sendPaymentCompleteEmail/,
  );
});
