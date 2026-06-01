import { siteContent } from "@/data/content";
import { getBookingLocationDetailLines } from "@/lib/bookings/bookingLocations";
import {
  buildQuotePdfBuffer,
  fetchQuoteByIdForOps,
  type QuoteOpsQuote,
} from "@/lib/quotes/quoteOps";

const PDFMONKEY_BASE_URL = "https://api.pdfmonkey.io/api/v1";

type QuoteLookupFn = typeof fetchQuoteByIdForOps;

type PdfMonkeyTemplateHeaderFooter = {
  left?: string | null;
  center?: string | null;
  right?: string | null;
  content?: string | null;
};

type PdfMonkeyTemplateSettings = {
  height?: number | null;
  width?: number | null;
  footer?: PdfMonkeyTemplateHeaderFooter | null;
  header?: PdfMonkeyTemplateHeaderFooter | null;
  inject_javascript?: boolean | null;
  margin?: {
    top?: number | null;
    right?: number | null;
    bottom?: number | null;
    left?: number | null;
  } | null;
  orientation?: string | null;
  paper_format?: string | null;
  paper_height?: number | null;
  paper_width?: number | null;
  transparent_background?: boolean | null;
  use_emojis?: boolean | null;
  use_paged?: boolean | null;
};

type PdfMonkeyDocument = {
  id?: string | null;
  status?: string | null;
  download_url?: string | null;
  preview_url?: string | null;
  failure_cause?: string | null;
};

type PdfMonkeyDocumentTemplate = {
  id?: string;
  body?: string | null;
  body_draft?: string | null;
  scss_style?: string | null;
  scss_style_draft?: string | null;
  edition_mode?: string | null;
  settings?: PdfMonkeyTemplateSettings | null;
  settings_draft?: PdfMonkeyTemplateSettings | null;
  sample_data?: string | Record<string, unknown> | null;
  sample_data_draft?: string | Record<string, unknown> | null;
};

export type QuotePdfProvider = "native" | "pdfmonkey";

export type QuotePdfSummaryRow = {
  label: string;
  value: string;
  highlight?: boolean;
};

export type QuotePdfPayload = {
  quoteId: string;
  quotePublicId: string | null;
  displayQuoteId: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  customer: {
    fullName: string;
    email: string;
    phone: string | null;
  };
  rental: {
    startAt: string;
    endAt: string;
    pickupLocationText: string;
    dropoffLocationText: string;
    pickupLocationLines: string[];
    dropoffLocationLines: string[];
    displayPickupAt: string;
    displayDropoffAt: string;
  };
  vehicle: {
    label: string;
    className: string | null;
  };
  pricing: {
    baseTotalCents: number;
    insuranceTotalCents: number;
    discountTotalCents: number;
    subtotalCents: number;
    totalCents: number;
    depositRequiredCents: number;
    amountDueCents: number;
    displayBaseTotal: string;
    displayInsuranceTotal: string;
    displayDiscountTotal: string;
    displaySubtotal: string;
    displayTotal: string;
    displayDepositRequired: string;
    displayAmountDue: string;
  };
  display: {
    issuedDate: string;
    createdAt: string;
    expiresAt: string;
    promoCode: string;
    brand: string;
    contactLine: string;
    pickupLocation: string;
    reservationNotice: string;
  };
  pricingRows: QuotePdfSummaryRow[];
  meta: {
    insuranceEnabled: boolean;
    promoCode: string | null;
    tags: string[];
    comments: string | null;
    commissionPartnerName: string | null;
    clientPaysAtPartner: boolean;
    rackPriceCents: number | null;
  };
};

export type LoadedQuotePdfPayload = {
  quoteId: string;
  quotePublicId: string | null;
  quote: QuoteOpsQuote;
  payload: QuotePdfPayload;
};

export type GeneratedQuotePdfDocument = {
  provider: QuotePdfProvider;
  providerStatus: string;
  documentId: string | null;
  previewUrl: string | null;
  downloadUrl: string | null;
};

type GenerateQuotePdfDeps = {
  getTemplateIdFn?: () => string | null;
  buildNativePdf?: typeof buildQuotePdfBuffer;
  buildPdfMonkeyPayload?: (payload: QuotePdfPayload) => Promise<Record<string, unknown>>;
  syncPdfMonkeyTemplate?: (templateId: string) => Promise<void>;
  createPdfMonkeyDocument?: (
    payload: Record<string, unknown>,
    meta: Record<string, unknown>,
    templateId: string,
  ) => Promise<PdfMonkeyDocument | null>;
  fetchPdfMonkeyDocument?: (documentId: string) => Promise<PdfMonkeyDocument | null>;
};

function formatAmount(cents: number) {
  return Number(cents || 0).toLocaleString("en-JM", {
    style: "currency",
    currency: "JMD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-JM", {
    timeZone: "America/Jamaica",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-JM", {
    timeZone: "America/Jamaica",
    dateStyle: "medium",
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPdfMonkeyApiKey() {
  return process.env.PDFMONKEY_API_KEY?.trim() || null;
}

function getPdfMonkeyQuoteTemplateId() {
  return process.env.PDFMONKEY_QUOTE_TEMPLATE_ID?.trim() || null;
}

function normalizePdfMonkeyTemplateMarkup(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function normalizePdfMonkeyTemplateSettings(settings: PdfMonkeyTemplateSettings | null | undefined) {
  const margin = settings?.margin ?? {};
  const header = settings?.header ?? {};
  const footer = settings?.footer ?? {};

  return {
    height: settings?.height ?? 500,
    width: settings?.width ?? 500,
    footer: {
      left: footer.left ?? null,
      center: footer.center ?? null,
      right: footer.right ?? null,
      content: footer.content ?? null,
    },
    header: {
      left: header.left ?? null,
      center: header.center ?? null,
      right: header.right ?? null,
      content: header.content ?? null,
    },
    inject_javascript: Boolean(settings?.inject_javascript),
    margin: {
      top: margin.top ?? 0,
      right: margin.right ?? 0,
      bottom: margin.bottom ?? 0,
      left: margin.left ?? 0,
    },
    orientation: settings?.orientation ?? "portrait",
    paper_format: settings?.paper_format ?? "letter",
    paper_height: settings?.paper_height ?? 279.4,
    paper_width: settings?.paper_width ?? 215.9,
    transparent_background: Boolean(settings?.transparent_background),
    use_emojis: Boolean(settings?.use_emojis),
    use_paged: Boolean(settings?.use_paged),
  } satisfies PdfMonkeyTemplateSettings;
}

function normalizePdfMonkeyTemplateSampleData(
  value: string | Record<string, unknown> | null | undefined,
) {
  if (!value) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value.trim();
    }
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function buildPdfMonkeyQuoteTemplateSettings(
  current: PdfMonkeyTemplateSettings | null | undefined,
): PdfMonkeyTemplateSettings {
  const normalized = normalizePdfMonkeyTemplateSettings(current);
  return {
    ...normalized,
    margin: {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    paper_format: "letter",
    paper_width: 215.9,
    paper_height: 279.4,
    orientation: "portrait",
    use_emojis: false,
    inject_javascript: false,
  };
}

export function resolveQuotePdfProvider(
  providerOverride?: QuotePdfProvider | null,
): QuotePdfProvider {
  return providerOverride ?? "native";
}

export function buildQuotePdfPayload(quote: QuoteOpsQuote): QuotePdfPayload {
  const displayQuoteId = quote.publicId || quote.id.slice(0, 8);
  const promoCode = quote.promoCode || "—";
  const pickupLocationLines = [
    quote.bookingLocationDetails.pickup.label || quote.pickupLocationText || "—",
    ...getBookingLocationDetailLines(quote.bookingLocationDetails.pickup),
  ];
  const dropoffLocationLines = [
    quote.bookingLocationDetails.dropoff.label || quote.dropoffLocationText || "—",
    ...getBookingLocationDetailLines(quote.bookingLocationDetails.dropoff),
  ];
  const pricingRows: QuotePdfSummaryRow[] = [
    { label: "Rental subtotal", value: formatAmount(quote.baseTotalCents) },
    { label: "Insurance total", value: formatAmount(quote.insuranceTotalCents) },
    { label: "Promo discount", value: `-${formatAmount(quote.discountTotalCents)}` },
    { label: "Total of booking", value: formatAmount(quote.totalCents) },
    { label: "Deposit required", value: formatAmount(quote.depositRequiredCents) },
    {
      label: "Amount due now",
      value: formatAmount(quote.amountDueCents),
      highlight: true,
    },
  ];

  return {
    quoteId: quote.id,
    quotePublicId: quote.publicId,
    displayQuoteId,
    status: quote.status || "DRAFT",
    createdAt: quote.createdAt,
    expiresAt: quote.expiresAt,
    customer: {
      fullName: quote.customerFullName || "—",
      email: quote.customerEmail || "—",
      phone: quote.customerPhone,
    },
    rental: {
      startAt: quote.startAt,
      endAt: quote.endAt,
      pickupLocationText: quote.pickupLocationText || "—",
      dropoffLocationText: quote.dropoffLocationText || "—",
      pickupLocationLines,
      dropoffLocationLines,
      displayPickupAt: formatDateTime(quote.startAt),
      displayDropoffAt: formatDateTime(quote.endAt),
    },
    vehicle: {
      label: quote.vehicleLabel || "—",
      className: quote.vehicleClass,
    },
    pricing: {
      baseTotalCents: quote.baseTotalCents,
      insuranceTotalCents: quote.insuranceTotalCents,
      discountTotalCents: quote.discountTotalCents,
      subtotalCents: quote.subtotalCents,
      totalCents: quote.totalCents,
      depositRequiredCents: quote.depositRequiredCents,
      amountDueCents: quote.amountDueCents,
      displayBaseTotal: formatAmount(quote.baseTotalCents),
      displayInsuranceTotal: formatAmount(quote.insuranceTotalCents),
      displayDiscountTotal: `-${formatAmount(quote.discountTotalCents)}`,
      displaySubtotal: formatAmount(quote.subtotalCents),
      displayTotal: formatAmount(quote.totalCents),
      displayDepositRequired: formatAmount(quote.depositRequiredCents),
      displayAmountDue: formatAmount(quote.amountDueCents),
    },
    display: {
      issuedDate: formatDate(quote.createdAt),
      createdAt: formatDateTime(quote.createdAt),
      expiresAt: quote.expiresAt ? formatDateTime(quote.expiresAt) : "Not set",
      promoCode,
      brand: siteContent.brand,
      contactLine: `${siteContent.email} | ${siteContent.phone}`,
      pickupLocation: pickupLocationLines[0] || "—",
      reservationNotice:
        "This is a quote. Vehicle is not reserved until deposit/payment is received.",
    },
    pricingRows,
    meta: {
      insuranceEnabled: quote.insuranceEnabled,
      promoCode: quote.promoCode,
      tags: quote.tags,
      comments: quote.comments,
      commissionPartnerName: quote.commissionPartnerName,
      clientPaysAtPartner: quote.clientPaysAtPartner,
      rackPriceCents: quote.rackPriceCents,
    },
  };
}

export async function loadQuotePdfPayload(
  quoteId: string,
  options: { getQuote?: QuoteLookupFn } = {},
): Promise<LoadedQuotePdfPayload | null> {
  const getQuote = options.getQuote ?? fetchQuoteByIdForOps;
  const quote = await getQuote(quoteId);
  if (!quote) return null;

  return {
    quoteId: quote.id,
    quotePublicId: quote.publicId,
    quote,
    payload: buildQuotePdfPayload(quote),
  };
}

export async function buildPdfMonkeyQuoteDocumentPayload(payload: QuotePdfPayload) {
  return {
    ...payload,
    customer: {
      ...payload.customer,
      phone: payload.customer.phone || "—",
    },
    vehicle: {
      ...payload.vehicle,
      className: payload.vehicle.className || "—",
    },
    display: {
      ...payload.display,
      promoCode: payload.display.promoCode || "—",
      expiresAt: payload.display.expiresAt || "Not set",
    },
  };
}

export function buildPdfMonkeyQuoteTemplateSampleData() {
  const sampleQuote: QuoteOpsQuote = {
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

  return buildPdfMonkeyQuoteDocumentPayload(buildQuotePdfPayload(sampleQuote));
}

export function renderPdfMonkeyQuoteTemplateBody() {
  return `{%- assign companyName = display.brand | default: "Curated Car Rentals" -%}
<style>
  :root {
    --ink: #0f172a;
    --muted: #64748b;
    --line: #dbe5f6;
    --surface: #f7faff;
    --brand: #17776f;
    --highlight: #e7f6ef;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 30px;
    color: var(--ink);
    font-family: "Segoe UI", Arial, sans-serif;
    background: #ffffff;
  }
  .sheet {
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
  }
  .header {
    border-top: 8px solid var(--brand);
    padding: 20px 24px 14px;
    display: flex;
    justify-content: space-between;
    gap: 24px;
    align-items: flex-start;
  }
  .doc-title {
    margin: 0;
    font-size: 34px;
    line-height: 1.1;
    letter-spacing: 0.01em;
  }
  .meta {
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  .company {
    text-align: right;
    max-width: 220px;
  }
  .company-name {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--ink);
  }
  .company-line {
    margin: 6px 0 0;
    font-size: 10px;
    color: var(--muted);
    line-height: 1.45;
  }
  .section {
    padding: 0 24px 18px;
  }
  .grid {
    display: flex;
    gap: 14px;
  }
  .grid > * {
    flex: 1;
    min-width: 0;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px;
    background: var(--surface);
    break-inside: avoid-page;
  }
  .card-title {
    margin: 0 0 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .line {
    margin: 4px 0;
    font-size: 13px;
    line-height: 1.45;
  }
  .pricing-card {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px;
    background: #fcfcfe;
  }
  .pricing-row {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    padding: 8px 6px;
    border-radius: 8px;
    font-size: 13px;
  }
  .pricing-row.highlight {
    background: var(--highlight);
    font-weight: 700;
  }
  .notes {
    font-size: 10px;
    color: var(--muted);
    line-height: 1.5;
    padding: 0 24px 22px;
  }
</style>

<main class="sheet">
  <header class="header">
    <div>
      <h1 class="doc-title">Quote</h1>
      <div class="meta">Quote #{{ displayQuoteId }} · Issued {{ display.issuedDate }}</div>
    </div>
    <div class="company">
      <p class="company-name">{{ companyName }}</p>
      <p class="company-line">{{ display.contactLine }}</p>
      <p class="company-line">Pickup: {{ display.pickupLocation }}</p>
    </div>
  </header>

  <section class="section">
    <div class="grid">
      <div class="card">
        <p class="card-title">Customer & Reservation</p>
        <p class="line">Name: {{ customer.fullName }}</p>
        <p class="line">Email: {{ customer.email }}</p>
        <p class="line">Phone: {{ customer.phone }}</p>
        <p class="line">&nbsp;</p>
        <p class="line">Pickup: {{ rental.displayPickupAt }}</p>
        {%- for line in rental.pickupLocationLines -%}
          <p class="line">{{ line }}</p>
        {%- endfor -%}
        <p class="line">&nbsp;</p>
        <p class="line">Dropoff: {{ rental.displayDropoffAt }}</p>
        {%- for line in rental.dropoffLocationLines -%}
          <p class="line">{{ line }}</p>
        {%- endfor -%}
      </div>

      <div class="card">
        <p class="card-title">Quote Details</p>
        <p class="line">Status: {{ status }}</p>
        <p class="line">Created: {{ display.createdAt }}</p>
        <p class="line">Expires: {{ display.expiresAt }}</p>
        <p class="line">&nbsp;</p>
        <p class="line">Vehicle: {{ vehicle.label }}</p>
        <p class="line">Class: {{ vehicle.className }}</p>
        <p class="line">Promo code: {{ display.promoCode }}</p>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="pricing-card">
      <p class="card-title">Pricing Summary (JMD)</p>
      {%- for row in pricingRows -%}
        <div class="pricing-row{% if row.highlight %} highlight{% endif %}">
          <span>{{ row.label }}</span>
          <span>{{ row.value }}</span>
        </div>
      {%- endfor -%}
    </div>
  </section>

  <section class="notes">
    <div>{{ display.reservationNotice }}</div>
    <div style="margin-top: 6px;">Contact: {{ display.contactLine }}</div>
  </section>
</main>`;
}

async function fetchPdfMonkeyTemplate(templateId: string) {
  const apiKey = getPdfMonkeyApiKey();
  if (!apiKey) return null;

  const response = await fetch(`${PDFMONKEY_BASE_URL}/document_templates/${templateId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`PDFMonkey quote template lookup failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { document_template?: PdfMonkeyDocumentTemplate };
  return data.document_template ?? null;
}

async function updatePdfMonkeyTemplate(
  templateId: string,
  template: Partial<PdfMonkeyDocumentTemplate>,
) {
  const apiKey = getPdfMonkeyApiKey();
  if (!apiKey) {
    throw new Error("PDFMonkey API key is not configured.");
  }

  const response = await fetch(`${PDFMONKEY_BASE_URL}/document_templates/${templateId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      document_template: template,
    }),
  });

  if (!response.ok) {
    throw new Error(`PDFMonkey quote template update failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { document_template?: PdfMonkeyDocumentTemplate };
  return data.document_template ?? null;
}

async function ensurePdfMonkeyQuoteTemplateParity(templateId: string) {
  const apiKey = getPdfMonkeyApiKey();
  if (!templateId || !apiKey) return;

  const template = await fetchPdfMonkeyTemplate(templateId);
  if (!template) {
    throw new Error("PDFMonkey quote template could not be loaded.");
  }

  const desiredBody = renderPdfMonkeyQuoteTemplateBody();
  const desiredScss = "";
  const desiredSettings = buildPdfMonkeyQuoteTemplateSettings(
    template.settings_draft ?? template.settings,
  );
  const desiredSampleData = JSON.stringify(await buildPdfMonkeyQuoteTemplateSampleData());

  const currentBody = normalizePdfMonkeyTemplateMarkup(template.body);
  const currentBodyDraft = normalizePdfMonkeyTemplateMarkup(template.body_draft);
  const currentScss = normalizePdfMonkeyTemplateMarkup(template.scss_style);
  const currentScssDraft = normalizePdfMonkeyTemplateMarkup(template.scss_style_draft);
  const currentSettings = normalizePdfMonkeyTemplateSettings(template.settings);
  const currentSettingsDraft = normalizePdfMonkeyTemplateSettings(template.settings_draft);
  const currentSampleData = normalizePdfMonkeyTemplateSampleData(template.sample_data);
  const currentSampleDataDraft = normalizePdfMonkeyTemplateSampleData(template.sample_data_draft);

  if (
    currentBody === normalizePdfMonkeyTemplateMarkup(desiredBody) &&
    currentBodyDraft === normalizePdfMonkeyTemplateMarkup(desiredBody) &&
    currentScss === desiredScss &&
    currentScssDraft === desiredScss &&
    JSON.stringify(currentSettings) === JSON.stringify(desiredSettings) &&
    JSON.stringify(currentSettingsDraft) === JSON.stringify(desiredSettings) &&
    currentSampleData === desiredSampleData &&
    currentSampleDataDraft === desiredSampleData &&
    template.edition_mode === "code"
  ) {
    return;
  }

  await updatePdfMonkeyTemplate(templateId, {
    edition_mode: "code",
    body: desiredBody,
    body_draft: desiredBody,
    scss_style: desiredScss,
    scss_style_draft: desiredScss,
    settings: desiredSettings,
    settings_draft: desiredSettings,
    sample_data: desiredSampleData,
    sample_data_draft: desiredSampleData,
  });
}

async function createPdfMonkeyDocumentSync(
  payload: Record<string, unknown>,
  meta: Record<string, unknown>,
  templateId: string,
) {
  const apiKey = getPdfMonkeyApiKey();
  if (!apiKey || !templateId) return null;

  const response = await fetch(`${PDFMONKEY_BASE_URL}/documents/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      document: {
        document_template_id: templateId,
        status: "pending",
        payload,
        meta,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`PDFMonkey quote request failed: HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }

  const data = (await response.json()) as {
    document?: PdfMonkeyDocument;
    document_card?: PdfMonkeyDocument;
  };
  return data.document_card ?? data.document ?? null;
}

async function fetchPdfMonkeyDocument(documentId: string) {
  const apiKey = getPdfMonkeyApiKey();
  if (!apiKey) return null;

  const response = await fetch(`${PDFMONKEY_BASE_URL}/documents/${documentId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { document?: PdfMonkeyDocument };
  return data.document ?? null;
}

export async function generateQuotePdfDocument(
  input: LoadedQuotePdfPayload,
  options: { provider?: QuotePdfProvider | null } = {},
  deps: GenerateQuotePdfDeps = {},
): Promise<GeneratedQuotePdfDocument> {
  const provider = resolveQuotePdfProvider(options.provider);
  const buildNativePdf = deps.buildNativePdf ?? buildQuotePdfBuffer;
  const getTemplateIdFn = deps.getTemplateIdFn ?? getPdfMonkeyQuoteTemplateId;
  const buildPdfMonkeyPayload = deps.buildPdfMonkeyPayload ?? buildPdfMonkeyQuoteDocumentPayload;
  const syncPdfMonkeyTemplate = deps.syncPdfMonkeyTemplate ?? ensurePdfMonkeyQuoteTemplateParity;
  const createPdfMonkeyDocument = deps.createPdfMonkeyDocument ?? createPdfMonkeyDocumentSync;
  const fetchDocument = deps.fetchPdfMonkeyDocument ?? fetchPdfMonkeyDocument;

  if (provider === "native") {
    const pdf = buildNativePdf(input.quote);
    const dataUrl = `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`;
    return {
      provider,
      providerStatus: "SUCCESS",
      documentId: null,
      previewUrl: dataUrl,
      downloadUrl: dataUrl,
    };
  }

  const apiKey = getPdfMonkeyApiKey();
  const templateId = getTemplateIdFn();
  if (!apiKey || !templateId) {
    return {
      provider,
      providerStatus: "SKIPPED",
      documentId: null,
      previewUrl: null,
      downloadUrl: null,
    };
  }

  await syncPdfMonkeyTemplate(templateId);
  const pdfMonkeyPayload = await buildPdfMonkeyPayload(input.payload);
  let document = await createPdfMonkeyDocument(
    pdfMonkeyPayload,
    {
      _filename: `quote-${input.quotePublicId || input.quoteId.slice(0, 8)}.pdf`,
      quote_id: input.quoteId,
      quote_public_id: input.quotePublicId,
    },
    templateId,
  );

  if (!document) {
    return {
      provider,
      providerStatus: "SKIPPED",
      documentId: null,
      previewUrl: null,
      downloadUrl: null,
    };
  }

  const status = (document.status ?? "").toLowerCase();
  if (status && status !== "success") {
    if (["failure", "failed", "error", "canceled", "cancelled"].includes(status)) {
      throw new Error(document.failure_cause ?? "PDFMonkey quote generation failed");
    }

    if (document.id) {
      const delays = [200, 300, 500, 800];
      for (const delay of delays) {
        await sleep(delay);
        const refreshed = await fetchDocument(document.id);
        if (!refreshed) continue;
        const refreshedStatus = (refreshed.status ?? "").toLowerCase();
        if (refreshedStatus === "success") {
          document = refreshed;
          break;
        }
        if (["failure", "failed", "error", "canceled", "cancelled"].includes(refreshedStatus)) {
          throw new Error(refreshed.failure_cause ?? "PDFMonkey quote generation failed");
        }
      }
    }
  }

  if ((document.status ?? "").toLowerCase() !== "success") {
    return {
      provider,
      providerStatus: document.status ?? "PENDING",
      documentId: document.id ?? null,
      previewUrl: document.preview_url ?? null,
      downloadUrl: document.download_url ?? null,
    };
  }

  let previewUrl = document.preview_url ?? null;
  let downloadUrl = document.download_url ?? null;
  if ((!previewUrl || !downloadUrl) && document.id) {
    const refreshed = await fetchDocument(document.id);
    if (refreshed && (refreshed.status ?? "").toLowerCase() === "success") {
      previewUrl = refreshed.preview_url ?? previewUrl;
      downloadUrl = refreshed.download_url ?? downloadUrl;
    }
  }

  return {
    provider,
    providerStatus: document.status ?? "SUCCESS",
    documentId: document.id ?? null,
    previewUrl,
    downloadUrl,
  };
}
