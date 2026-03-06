import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  getOrCreateInvoiceLedgerRow,
  hashInvoicePayload,
  markInvoiceProviderInfo,
} from "@/lib/invoices/ledger";
import { logError, redactText } from "@/lib/log";
import { calcDaysInclusive } from "@/lib/payments/dateMath";

const PDFMONKEY_BASE_URL = "https://api.pdfmonkey.io/api/v1";
const DEFAULT_GOTENBERG_URL = "http://localhost:3001";
const DATA_URL_BASE64_REGEX = /^data:.*;base64,(.*)$/i;

type InvoicePdfProvider = "pdfmonkey" | "gotenberg";

export type InvoicePaymentLine = {
  provider: string;
  status: string;
  amount: number;
  date: string;
};

export type InvoicePayloadInput = {
  bookingId: string;
  bookingPublicId?: string;
  invoiceNumber?: string;
  bookingStatus: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress?: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  dailyRate: number;
  deposit: number;
  baseTotal?: number;
  insuranceTotal?: number;
  promoDiscount?: number;
  promoCode?: string | null;
  total: number;
  paidToDate: number;
  balanceDue: number;
  payments: InvoicePaymentLine[];
};

export type RentalAgreementPayloadInput = {
  bookingId: string;
  bookingStatus: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  returnLocation?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress?: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  dailyRate: number;
  total: number;
  deposit: number;
  paidToDate: number;
  balanceDue: number;
  paymentMethod?: string;
  signatureDataUrl?: string | null;
  signedAt?: string;
};

type GenerateInvoicePdfOptions = {
  createdByUserId?: string | null;
  source?: string;
};

type GotenbergDocumentType = "invoice" | "rental_agreement";

type PdfMonkeyDocument = {
  id?: string;
  status?: string;
  download_url?: string | null;
  preview_url?: string | null;
  failure_cause?: string | null;
};

function getInvoicePdfProvider(): InvoicePdfProvider {
  const provider = (process.env.PDF_PROVIDER ?? "pdfmonkey").trim().toLowerCase();
  if (provider === "gotenberg") return "gotenberg";
  return "pdfmonkey";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPdfMonkeyKey() {
  const key = process.env.PDFMONKEY_API_KEY;
  if (!key) return null;
  return key;
}

function getTemplateId() {
  const templateId = process.env.PDFMONKEY_TEMPLATE_ID;
  if (!templateId) return null;
  return templateId;
}

function getGotenbergUrl() {
  const configured = (process.env.GOTENBERG_URL ?? "").trim();
  const url = configured || DEFAULT_GOTENBERG_URL;
  return url.replace(/\/+$/, "");
}

function escapeHtml(value: unknown) {
  const text = String(value ?? "");
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asNumber(value: unknown) {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return typeof value === "string" ? value : "";
}

function formatJmd(value: number) {
  return Number(value || 0).toLocaleString("en-JM", {
    style: "currency",
    currency: "JMD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateLabel(value: unknown) {
  const dateFormatter = new Intl.DateTimeFormat("en-JM", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return dateFormatter.format(value);
  }

  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "—";

  const isoDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    const year = Number(isoDateMatch[1]);
    const month = Number(isoDateMatch[2]);
    const day = Number(isoDateMatch[3]);
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    if (Number.isFinite(utcDate.getTime())) {
      return dateFormatter.format(utcDate);
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return trimmed;
  return dateFormatter.format(parsed);
}

function computeRentalDays(start: string, end: string) {
  const days = calcDaysInclusive(start, end);
  return Math.max(1, days);
}

function detectImageContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

type PdfAsset = {
  bytes: Buffer;
  contentType: string;
  fileName: string;
};

let cachedInvoiceLogoAsset: PdfAsset | null | undefined;
let cachedRentalAgreementConditionAsset: PdfAsset | null | undefined;

async function loadInvoiceLogoAsset() {
  if (cachedInvoiceLogoAsset !== undefined) {
    return cachedInvoiceLogoAsset;
  }

  const configuredLogoPath = (process.env.INVOICE_LOGO_PATH ?? "").trim();
  const candidatePaths = [
    configuredLogoPath,
    path.join(process.cwd(), "public", "branding", "invoice-logo.png"),
    "/Users/damianthompson/Downloads/Logo_Favicon files/Transparent logo/High resolution transparent logo.png",
    "/Users/damianthompson/Downloads/Logo_Favicon files/Transparent logo/Transparent logo.png",
  ].filter(Boolean);

  for (const logoPath of candidatePaths) {
    try {
      if (!existsSync(logoPath)) continue;
      const bytes = await readFile(logoPath);
      if (bytes.length === 0) continue;
      const extension = path.extname(logoPath).toLowerCase() || ".png";
      cachedInvoiceLogoAsset = {
        bytes,
        contentType: detectImageContentType(logoPath),
        fileName: `invoice-logo${extension}`,
      };
      return cachedInvoiceLogoAsset;
    } catch {
      continue;
    }
  }

  cachedInvoiceLogoAsset = null;
  return cachedInvoiceLogoAsset;
}

async function loadRentalAgreementConditionAsset() {
  if (cachedRentalAgreementConditionAsset !== undefined) {
    return cachedRentalAgreementConditionAsset;
  }

  const configuredConditionPath = (process.env.RENTAL_AGREEMENT_CONDITION_IMAGE_PATH ?? "").trim();
  const candidatePaths = [
    configuredConditionPath,
    path.join(process.cwd(), "public", "branding", "rental-agreement-condition.jpg"),
    path.join(process.cwd(), "tmp", "pdfs", "ra-images", "img-003.jpg"),
  ].filter(Boolean);

  for (const imagePath of candidatePaths) {
    try {
      if (!existsSync(imagePath)) continue;
      const bytes = await readFile(imagePath);
      if (bytes.length === 0) continue;
      const extension = path.extname(imagePath).toLowerCase() || ".jpg";
      cachedRentalAgreementConditionAsset = {
        bytes,
        contentType: detectImageContentType(imagePath),
        fileName: `rental-agreement-condition${extension}`,
      };
      return cachedRentalAgreementConditionAsset;
    } catch {
      continue;
    }
  }

  cachedRentalAgreementConditionAsset = null;
  return cachedRentalAgreementConditionAsset;
}

function renderGotenbergInvoiceHtml(
  payload: Record<string, unknown>,
  options: { logoFileName?: string | null } = {},
) {
  const booking = asRecord(payload.booking);
  const customer = asRecord(payload.customer);
  const vehicle = asRecord(payload.vehicle);
  const charges = asRecord(payload.charges);
  const payments = Array.isArray(payload.payments) ? payload.payments.map(asRecord) : [];
  const issuedAtRaw = asString(payload.issued_at) || new Date().toISOString();
  const issuedAt = formatDateLabel(issuedAtRaw);
  const bookingIdRaw = asString(booking.id);
  const bookingPublicIdRaw =
    asString(booking.public_id) || asString(booking.reference) || bookingIdRaw.slice(0, 8);
  const invoiceNumberRaw =
    asString(booking.invoice_number) || asString(booking.reference) || bookingPublicIdRaw;
  const startDateRaw = asString(booking.start_date);
  const endDateRaw = asString(booking.end_date);
  const dueDate = formatDateLabel(startDateRaw);
  const rentalDays = computeRentalDays(startDateRaw, endDateRaw);

  const paymentsRows = payments.length
    ? payments
        .map((payment) => {
          const provider = escapeHtml(asString(payment.provider) || "Payment");
          const status = escapeHtml(asString(payment.status) || "Unknown");
          const amount = formatJmd(asNumber(payment.amount));
          const date = escapeHtml(formatDateLabel(asString(payment.date)));
          return `<tr><td>${provider}</td><td>${date}</td><td>${status}</td><td class="money">${amount}</td></tr>`;
        })
        .join("")
    : '<tr><td colspan="4" class="muted">No payments recorded yet.</td></tr>';

  const bookingPublicId = escapeHtml(bookingPublicIdRaw);
  const invoiceNumber = escapeHtml(invoiceNumberRaw);
  const bookingStatus = escapeHtml(asString(booking.status));
  const pickupLocation = escapeHtml(asString(booking.pickup_location));
  const startDate = escapeHtml(formatDateLabel(startDateRaw));
  const endDate = escapeHtml(formatDateLabel(endDateRaw));
  const customerName = escapeHtml(asString(customer.name));
  const customerEmail = escapeHtml(asString(customer.email));
  const customerAddressLines = asString(customer.address)
    .split(/,|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const customerAddressHtml = customerAddressLines.length
    ? customerAddressLines.map((line) => `<span class="address-line">${escapeHtml(line)}</span>`).join("")
    : '<span class="address-line">Address not provided</span>';
  const vehicleLabel = escapeHtml(
    `${asString(vehicle.year)} ${asString(vehicle.make)} ${asString(vehicle.model)}`.trim(),
  );
  const dailyRateValue = asNumber(vehicle.daily_rate);
  const dailyRate = formatJmd(dailyRateValue);
  const rentalDaysLabel = escapeHtml(`${rentalDays}`);
  const baseTotalRaw = asNumber(charges.base_total);
  const baseTotalValue = baseTotalRaw > 0 ? baseTotalRaw : Math.max(0, dailyRateValue * rentalDays);
  const depositValue = asNumber(charges.deposit);
  const insuranceTotalValue = Math.max(0, asNumber(charges.insurance_total));
  const promoDiscountValue = Math.max(0, asNumber(charges.promo_discount));
  const paidToDateValue = asNumber(charges.paid_to_date);
  const balanceDueValue = asNumber(charges.balance_due);
  const remainingDepositValue = Math.max(depositValue - paidToDateValue, 0);
  const baseTotal = formatJmd(baseTotalValue);
  const insuranceTotal = formatJmd(insuranceTotalValue);
  const promoDiscount = formatJmd(-promoDiscountValue);
  const remainingDeposit = formatJmd(remainingDepositValue);
  const paidToDate = formatJmd(paidToDateValue);
  const balanceDue = formatJmd(balanceDueValue);
  const issued = escapeHtml(issuedAt);
  const due = escapeHtml(dueDate);
  const logoSrc = options.logoFileName ? escapeHtml(options.logoFileName) : "";
  const companyName = "Curated Car Rentals";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Invoice ${invoiceNumber}</title>
    <style>
      :root {
        --ink: #0f172a;
        --muted: #64748b;
        --line: #e2e8f0;
        --surface: #f8fafc;
        --brand: #0f766e;
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
      .invoice-title {
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
      }
      .company-logo {
        width: 148px;
        height: auto;
        max-height: 72px;
        object-fit: contain;
        margin-left: auto;
        margin-bottom: 8px;
      }
      .company-name {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
      }
      .section {
        padding: 0 24px 18px;
      }
      .split {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 18px;
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 12px 14px;
        background: var(--surface);
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
      }
      .address-lines {
        margin: 4px 0;
        font-size: 13px;
      }
      .address-line {
        display: block;
      }
      .muted { color: var(--muted); }
      .table-wrap {
        margin-top: 14px;
        border: 1px solid var(--line);
        border-radius: 10px;
        overflow: hidden;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      thead th {
        background: var(--surface);
        color: #334155;
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      th, td {
        border-bottom: 1px solid var(--line);
        padding: 10px 12px;
        text-align: left;
        font-size: 12px;
      }
      tbody tr:last-child td { border-bottom: none; }
      .money { text-align: right; font-variant-numeric: tabular-nums; }
      .totals {
        width: 320px;
        margin-left: auto;
        margin-top: 14px;
        border: 1px solid var(--line);
        border-radius: 10px;
        overflow: hidden;
      }
      .totals-row {
        display: flex;
        justify-content: space-between;
        padding: 10px 12px;
        font-size: 13px;
        border-bottom: 1px solid var(--line);
      }
      .totals-row:last-child { border-bottom: none; }
      .totals-row.balance {
        background: #ecfdf5;
        font-size: 14px;
        font-weight: 700;
        color: #065f46;
      }
      .footer {
        border-top: 1px solid var(--line);
        margin-top: 18px;
        padding: 14px 24px 20px;
        font-size: 11px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <header class="header">
        <div>
          <h1 class="invoice-title">Invoice</h1>
          <div class="meta">Booking #${bookingPublicId} · Issued ${issued}</div>
        </div>
        <div class="company">
          ${logoSrc ? `<img src="${logoSrc}" alt="${companyName}" class="company-logo" />` : ""}
          <p class="company-name">${companyName}</p>
          <p class="line muted">Pickup: ${pickupLocation}</p>
        </div>
      </header>

      <section class="section split">
        <div class="card">
          <p class="card-title">Bill To</p>
          <p class="line">${customerName}</p>
          <p class="line muted">${customerEmail}</p>
          <div class="address-lines muted">${customerAddressHtml}</div>
        </div>
        <div class="card">
          <p class="card-title">Invoice Details</p>
          <p class="line"><strong>Invoice #:</strong> ${invoiceNumber}</p>
          <p class="line"><strong>Issued:</strong> ${issued}</p>
          <p class="line"><strong>Due:</strong> ${due}</p>
          <p class="line"><strong>Status:</strong> ${bookingStatus}</p>
          <p class="line"><strong>Booking ID:</strong> ${bookingPublicId}</p>
        </div>
      </section>

      <section class="section">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Pickup Date</th>
                <th>Drop-off Date</th>
                <th>Qty</th>
                <th class="money">Rate</th>
                <th class="money">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${vehicleLabel} rental</td>
                <td>${startDate}</td>
                <td>${endDate}</td>
                <td>${rentalDaysLabel} day(s)</td>
                <td class="money">${dailyRate}</td>
                <td class="money">${baseTotal}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="section">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Payment Method</th><th>Date</th><th>Status</th><th class="money">Amount</th></tr>
            </thead>
            <tbody>${paymentsRows}</tbody>
          </table>
        </div>
        <div class="totals">
          <div class="totals-row"><span>Subtotal</span><span>${baseTotal}</span></div>
          ${insuranceTotalValue > 0 ? `<div class="totals-row"><span>Insurance Total</span><span>${insuranceTotal}</span></div>` : ""}
          ${promoDiscountValue > 0 ? `<div class="totals-row"><span>Promo Discount</span><span>${promoDiscount}</span></div>` : ""}
          <div class="totals-row"><span>Deposit</span><span>${remainingDeposit}</span></div>
          <div class="totals-row"><span>Paid to date</span><span>${paidToDate}</span></div>
          <div class="totals-row balance"><span>Balance due on pickup</span><span>${balanceDue}</span></div>
        </div>
      </section>

      <footer class="footer">
        Agreement review: Please review the details before pickup and confirm any corrections in advance.
      </footer>
    </main>
  </body>
</html>`;
}

function renderGotenbergRentalAgreementHtml(
  payload: Record<string, unknown>,
  options: { logoFileName?: string | null; conditionImageFileName?: string | null } = {},
) {
  const booking = asRecord(payload.booking);
  const customer = asRecord(payload.customer);
  const vehicle = asRecord(payload.vehicle);
  const charges = asRecord(payload.charges);
  const signature = asRecord(payload.signature);
  const issuedAtRaw = asString(payload.issued_at) || new Date().toISOString();
  const issuedAt = formatDateLabel(issuedAtRaw);
  const bookingIdRaw = asString(booking.id);
  const bookingRefRaw = asString(booking.reference) || bookingIdRaw.slice(0, 8);
  const startDateRaw = asString(booking.start_date);
  const endDateRaw = asString(booking.end_date);
  const days = computeRentalDays(startDateRaw, endDateRaw);
  const startDate = escapeHtml(formatDateLabel(startDateRaw));
  const endDate = escapeHtml(formatDateLabel(endDateRaw));
  const bookingRef = escapeHtml(bookingRefRaw);
  const bookingId = escapeHtml(bookingIdRaw);
  const bookingStatus = escapeHtml(asString(booking.status));
  const pickupLocation = escapeHtml(asString(booking.pickup_location));
  const returnLocation = escapeHtml(
    asString(booking.return_location) || asString(booking.pickup_location),
  );
  const customerName = escapeHtml(asString(customer.name));
  const customerEmail = escapeHtml(asString(customer.email));
  const customerPhone = escapeHtml(asString(customer.phone));
  const customerAddressLines = asString(customer.address)
    .split(/,|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const customerAddressHtml = customerAddressLines.length
    ? customerAddressLines.map((line) => `<span class="address-line">${escapeHtml(line)}</span>`).join("")
    : '<span class="address-line">Address not provided</span>';
  const vehicleLabel = escapeHtml(
    `${asString(vehicle.year)} ${asString(vehicle.make)} ${asString(vehicle.model)}`.trim(),
  );
  const dailyRate = formatJmd(asNumber(vehicle.daily_rate));
  const total = formatJmd(asNumber(charges.total));
  const deposit = formatJmd(asNumber(charges.deposit));
  const paidToDate = formatJmd(asNumber(charges.paid_to_date));
  const balanceDue = formatJmd(asNumber(charges.balance_due));
  const paymentMethod = escapeHtml(asString(charges.payment_method) || "Not specified");
  const logoSrc = options.logoFileName ? escapeHtml(options.logoFileName) : "";
  const conditionImageSrc = options.conditionImageFileName
    ? escapeHtml(options.conditionImageFileName)
    : "";
  const companyName = "Curated Car Rentals";
  const issued = escapeHtml(issuedAt);
  const dayCount = escapeHtml(String(days));
  const signatureDataUrlRaw = asString(signature.image_data_url);
  const hasInlineSignature = /^data:image\/[^;]+;base64,[a-z0-9+/=\s]+$/i.test(signatureDataUrlRaw);
  const signatureImageSrc = hasInlineSignature ? escapeHtml(signatureDataUrlRaw) : "";
  const signedAtRaw = asString(signature.signed_at) || issuedAtRaw;
  const signedAtLabel = escapeHtml(formatDateLabel(signedAtRaw));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Rental Agreement ${bookingRef}</title>
    <style>
      :root {
        --ink: #0f172a;
        --muted: #64748b;
        --line: #dbe5f6;
        --surface: #f7faff;
        --brand: #1d4ed8;
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
      }
      .company-logo {
        width: 148px;
        height: auto;
        max-height: 72px;
        object-fit: contain;
        margin-left: auto;
        margin-bottom: 8px;
      }
      .company-name {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
      }
      .section {
        padding: 0 24px 18px;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 12px 14px;
        background: var(--surface);
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
      }
      .address-line { display: block; }
      .muted { color: var(--muted); }
      .terms {
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #ffffff;
        padding: 14px 16px;
      }
      .terms h2 {
        margin: 0 0 10px;
        font-size: 16px;
      }
      .terms p {
        margin: 6px 0;
        font-size: 12px;
        line-height: 1.45;
      }
      .terms ol {
        margin: 8px 0 0 18px;
        padding: 0;
      }
      .terms li {
        margin: 6px 0;
        font-size: 12px;
        line-height: 1.45;
      }
      .signature {
        margin-top: 14px;
        border-top: 1px dashed var(--line);
        padding-top: 12px;
      }
      .signature-line {
        margin-top: 18px;
        height: 1px;
        background: #94a3b8;
      }
      .signature-image {
        margin-top: 8px;
        max-width: 300px;
        max-height: 90px;
        object-fit: contain;
        display: block;
        filter: brightness(0) saturate(100%);
      }
      .signature-label {
        margin-top: 6px;
        font-size: 12px;
        color: var(--muted);
      }
      .inspection-image {
        width: 100%;
        height: auto;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <header class="header">
        <div>
          <h1 class="doc-title">Rental Agreement</h1>
          <div class="meta">Booking #${bookingRef} · Issued ${issued}</div>
        </div>
        <div class="company">
          ${logoSrc ? `<img src="${logoSrc}" alt="${companyName}" class="company-logo" />` : ""}
          <p class="company-name">${companyName}</p>
        </div>
      </header>

      <section class="section grid">
        <div class="card">
          <p class="card-title">Renter Information</p>
          <p class="line">${customerName}</p>
          <p class="line muted">${customerEmail}</p>
          <p class="line muted">${customerPhone}</p>
          <p class="line muted">${customerAddressHtml}</p>
        </div>
        <div class="card">
          <p class="card-title">Rental Information</p>
          <p class="line"><strong>Date Out:</strong> ${startDate}</p>
          <p class="line"><strong>Date Due:</strong> ${endDate}</p>
          <p class="line"><strong>Pickup Location:</strong> ${pickupLocation}</p>
          <p class="line"><strong>Return Location:</strong> ${returnLocation}</p>
          <p class="line"><strong>Status:</strong> ${bookingStatus}</p>
          <p class="line"><strong>Booking ID:</strong> ${bookingId}</p>
        </div>
      </section>

      <section class="section grid">
        <div class="card">
          <p class="card-title">Vehicle Information</p>
          <p class="line"><strong>Vehicle:</strong> ${vehicleLabel}</p>
          <p class="line"><strong>Daily Rate:</strong> ${dailyRate}</p>
          <p class="line"><strong>Rental Days:</strong> ${dayCount}</p>
        </div>
        <div class="card">
          <p class="card-title">Charge Information</p>
          <p class="line"><strong>Total:</strong> ${total}</p>
          <p class="line"><strong>Payment Method:</strong> ${paymentMethod}</p>
          <p class="line"><strong>Amount Paid:</strong> ${paidToDate}</p>
          <p class="line"><strong>Amount Outstanding:</strong> ${balanceDue}</p>
          <p class="line"><strong>Security Deposit:</strong> ${deposit}</p>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <p class="card-title">Vehicle Condition Diagram</p>
          ${
            conditionImageSrc
              ? `<img src="${conditionImageSrc}" alt="Vehicle condition diagram" class="inspection-image" />`
              : '<p class="line muted">Vehicle condition diagram not available.</p>'
          }
        </div>
      </section>

      <section class="section">
        <div class="terms">
          <h2>Terms & Conditions</h2>
          <p>Definitions. "Agreement" means all terms and conditions in the rental record ("Rental Record") and any additional documents you sign or we provide at the time of rental, electronically or otherwise. "Renter" means each person signing this Agreement, each Authorized Driver, and every person or organization to whom charges are billed by us at its or the Renter's direction. "We," "our" or "us" means [Rental Car Company]. "Authorized Driver" means (a) the Renter; (b) any additional driver listed by us on this Agreement; and (c) any other person defined as an "authorized driver" under applicable law. Each Authorized Driver must have a valid operator's license and be at least age 21 (unless otherwise specified in [applicable law]). "Vehicle" means the automobile or truck identified in this Agreement and any vehicle we substitute for it, and all its tires, tools, accessories, equipment, keys and document provided inside the vehicle at the time of rental. "Physical Damage" means damage to, or loss of, the Vehicle resulting from (but not limited to) collision, theft, vandalism, acts of nature, riots or other civil disturbances, hail, flood, fire or any other loss not caused by collision. "Loss of Use" means the loss of our ability to use the Vehicle for our purposes because of Vehicle damage or loss, including, without limitation, use for rent, display for rent and/or sale, opportunity to upgrade or sell, or transportation of employees. "Diminution of Value" means the difference between the fair market value of the Vehicle before damage or loss and its value after repairs as calculated by a third-party estimate obtained by us or on our behalf. "Charges" means the fees and charges that are incurred under this Agreement. "Vehicle License Fee," "Vehicle Licensing," "Vehicle License Prop Tax," "Vehicle License Cost Recovery Fee," or "Motor Vehicle Tax" means a vehicle license cost recovery fee based on our estimated average per day per vehicle portion of our total annual vehicle licensing, titling, and registration costs or as otherwise defined under applicable law.</p>
          <ol>
            <li>Rental; Indemnity; Personal Property; Warranties. Only Authorized Drivers may use the Vehicle. Authorized Drivers include only those individuals named in the Rental Agreement or permitted by state law. We may repossess the Vehicle at your expense without notice to you if the Vehicle is abandoned or used in violation of law or of this Agreement. You agree to indemnify us, defend us and hold us harmless from all judgments, claims, liability, costs and attorney fees we incur resulting from, or arising out of, this rental and your use of the Vehicle or Optional Equipment (as defined below). You release us, our agents and employees from all claims for loss of or damage to your personal property or that of another person that we received, handled or stored, or that was left or carried in or on the Vehicle or in any service vehicle or in our offices, whether or not the loss or damage was caused by our negligence or was otherwise our responsibility. We make no warranties, express, implied or apparent, regarding the Vehicle, no warranty of merchantability and no warranty that the Vehicle is fit for a particular purpose. In no event shall we be liable to you for any indirect, special or consequential damages related directly or indirectly to any alleged breach by us of this Agreement.</li>
            <li>Condition and Return of Vehicle. Rental of this vehicle constitutes a "bailment," meaning that the use of the Vehicle is for Renter's own benefit. The Vehicle must be returned to our rental office or other location we specify on the date and time noted in this Agreement and in the same condition received, except for ordinary wear. Our determination of the condition of the Vehicle is subject to a final inspection for damage(s) which may occur in our facilities after drop off, whether or not the vehicle is checked in by an employee and whether or not such damage(s) are immediately recognizable or hidden. This also means that if the Vehicle is returned after closing hours, Renter's responsibility for damages under this Agreement continues until final inspection even if the damage occurred after the vehicle was returned. To extend the rental, Renter must contact our rental office before the due-in date listed in this Agreement. All Charges may continue to accrue until the return location opens for business. Service to the Vehicle or replacement of parts or accessories during the rental must have our prior approval. Renter must check and maintain all fluid levels, and return the Vehicle with at least the same amount of fuel as when rented.</li>
            <li>Responsibility for Damage or Loss. Regardless of fault, you are responsible for all damage to, loss of, or theft of the Vehicle during the rental period resulting from any cause. Subject to the law in the jurisdiction where the Vehicle was rented, your responsibility will include: (a) physical damage caused by collisions, weather, vandalism, road conditions, acts of nature, and any other cause resulting in physical damage to the Vehicle: (b) if we determine that the Vehicle is a total loss, the full fair retail market value of the Vehicle, less salvage; (c) if we determine that the Vehicle is repairable: (A) the difference between the value of the Vehicle immediately before the damage and the value immediately after the damage; or (B) the reasonable estimated retail value or actual cost of repair plus Diminution of Value, meaning the difference between the fair market value of the Vehicle before damage or loss and its value after repairs as calculated by a third-party estimate obtained by us or on our behalf; (d) Loss of Use, which shall be measured by multiplying the daily rental rate noted on this Agreement either by the actual or estimated number of days from the date the Vehicle is damaged until it is replaced or repaired, which you agree represents a reasonable estimate of Loss of Use damages and not a penalty. Loss of Use shall be payable regardless of fleet utilization, whether we had other vehicles in our fleet to rent, the Vehicle would not have been used but for the damage, and regardless of whether we suffered lost profits as a result of the damage; (e) an administrative fee, calculated based on the damage, which you agree is reasonable.</li>
            <li>Prohibited Uses. The following uses of the Vehicle are prohibited and constitute material breaches of this Agreement. The Vehicle shall not be used: (a) by anyone who is not an Authorized Driver, or by anyone whose driving license is suspended in any jurisdiction; (b) by anyone under the influence of drugs or alcohol; (c) by anyone who obtained the Vehicle or extended the rental by giving us false, fraudulent or misleading information; (d) in furtherance of any illegal purpose or under any circumstance that would constitute a felony or other violation of law (other than a minor traffic violation); (e) to carry persons or property for hire; (f) to push or tow anything; (g) in any race, speed test or contest; (h) to teach anyone to drive; (i) to carry dangerous or hazardous items or illegal materiel; (j) outside the United States (unless that use is specifically authorized in this Agreement); (k) on unpaved roads; (l) to transport more persons than the Vehicle has seat belts, or to carry persons outside the passenger compartment; (m) to transport children without approved child safety seats as required by law; (n) when the odometer has been tampered with or disconnected; (o) when it is reasonable for you to know that further operation would damage the Vehicle; (p) with inadequately secured cargo; (q) where applicable, by anyone who lacks experience operating a manual transmission; (r) in connection with a willful, wanton or reckless act; or (s) by anyone who is sending or reading an electronic message, including text (SMS) messages or emails, while operating the Vehicle. Smoking in the Vehicle is also prohibited. ANY PROHIBITED USE OF THE VEHICLE VIOLATES THIS AGREEMENT AND SHALL INVALIDATE ANY COVERAGE PRODUCT (WHERE PERMITTED BY LAW). For purposes of this Agreement, in addition to any appropriate local statutory definition, a "willful," "wanton" or "reckless" act shall also include (but not be limited to): (1) the use of unauthorized equipment on or in the Vehicle; and (2) aiding in the theft of the Vehicle or failing to safeguard the keys and the Vehicle is stolen or vandalized.</li>
            <li>Insurance: If you purchase Insurance, subject to the terms of this Agreement, we will waive our right to hold you financially responsible for all or a portion of physical damage to the Vehicle as noted on the Rental Record, including charges such as loss of use and administrative fees.</li>
            <li>Responsibility to Others; Handling Accidents/Incidents. You are responsible for all injury, damage, or loss you cause to yourself and others (including any passengers). We are not responsible for injury or damage you cause to others and will provide no coverage for any such injury, damage or loss unless required by law, or unless you elect to purchase such coverage at the time of rental. You agree that it is your responsibility to know and understand what insurance coverage you have or elect to purchase for this rental. Your liability insurance coverage must provide at least the minimum limits of coverage required by the financial responsibility laws of the state where the loss occurs. If we are required to pay any amount to injured or damaged parties, we expressly reserve the right to subrogate against you for recovery of such payment(s). You must: (a) report all damage to us and all accidents to us and the police as soon as you discover them and are safe out of danger; (b) complete our incident report form; and (c) provide us with a legible copy of any service of process, pleading, or notice of any kind related to an accident or other incident involving the Vehicle. Any failure by you to report all damage to us by completing an incident report, or to report all accidents (of any size) to us and to the police as soon as they occur, will be a material breach of this Agreement, and may invalidate optional coverage products that you elect to purchase. The Vehicle may not be taken into Mexico under any circumstances.</li>
            <li>Payment; Charges. You permit us to reserve or set aside against your payment card at the time of rental a reasonable amount in addition to the estimated total charges. We may use the reserve to pay all Charges. We will authorize the release of any excess reserve or set aside upon the completion of your rental, and your payment card issuer's rules will apply to your credit line or your account being credited for the excess and may not be immediately released by your card issuer. You will pay us at or before the conclusion of this rental or upon demand of all Charges, including without limitation: (a) time charge as shown on the Rental Record; (b) mileage charges, including charges for extra miles, based on the per-mile rate specified on the Rental Record; (c) mileage charge based on our experience if the odometer is altered; (d) optional product and service fees; (e) fuel and a refueling fee if you return the Vehicle with less fuel than when rented; (f) applicable taxes, surcharges, airport facility fees, and airport concession recovery fees; (f) expenses we incur locating and recovering the Vehicle if you fail to return it or if we repossess it under the terms of this Agreement; (g) costs including pre- and post-judgment attorney fees we incur collecting payment from you or otherwise enforcing or defending our rights under this Agreement; (h) a reasonable cleaning fee if the Vehicle is returned substantially less clean than when rented or with evidence of smoking in the Vehicle; (i) towing, storage charges, forfeitures, court costs, penalties, and all other costs we incur resulting from your use of the Vehicle; (j) a surcharge if you return the Vehicle to a location other than the location where you rented the Vehicle or if you do not return it on the date and time due, and you may be charged the standard rates for each day (or partial day) after the due-in date noted on this Agreement; (k) replacement cost of lost or damaged parts and supplies used in Features and (l) if applicable, a redemption fee if you present a reward certificate, coupon or voucher associated with a loyalty program. All Charges are subject to a final audit. If errors are found, you authorize us to correct the Charges with your payment card issuer.</li>
            <li>Responsibility for Tolls, Traffic Violations, and Other Charges. Responsibility for Tolls, Traffic Violations, and Other Charges. You are responsible for paying charging authorities directly all tolls ("Tolls") and parking citations, photo enforcement fees, fines for toll evasion, and other fines, fees, and penalties (each a "Violation") assessed against you, us or the Vehicle during this rental. If we are notified by charging authorities that we may be responsible for payment of a Violation, you authorize us to release your rental and payment card information to charging authorities or other relevant parties for processing and billing purposes. If we pay a Toll or Violation, you authorize us to charge all such payments and administrative fees to the payment card you used to pay for this rental.</li>
            <li>Personal Information; Communications. You agree that we may disclose personally identifiable information about you to applicable law enforcement agencies or to other third parties in connection with our enforcement of our rights under this Agreement. Questions regarding privacy should be directed to the location where you rented the Vehicle. You agree, in order for us to service or otherwise administer our account or to recover any amounts you may owe, that we or any assignee or collection agency of our choosing, may contact you by telephone at any telephone number associated with your account, including wireless telephone numbers, which could result in additional charges to you. We, our assignee, or any collection agency of our choosing, may also contact you by sending text messages or e-mails, using any e-mail address you provide to use. Methods of contact may include using pre-recorded/artificial voice messages and/or use of an automatic dialing device, as applicable.</li>
            <li>Miscellaneous. No term of this Agreement can be waived or modified except by a writing that we have signed. This Agreement constitutes the entire agreement between you and us. All prior representations and agreements between you and us regarding this rental are void. A waiver by us of any breach of this Agreement is not a waiver of any additional breach or waiver of the performance of your obligations under this Agreement. Our acceptance of payment from you or our failure, refusal or neglect to exercise any of our rights under this Agreement does not constitute a waiver of any other provision of this Agreement. You waive all recourse against us for any criminal reports or prosecutions that we take against you that arise out of your breach of this Agreement. Unless prohibited by law, you release us from all liability for consequential, special or punitive damages in connection with this rental or the reservation of a vehicle. This Agreement will be governed by the substantive law of the jurisdiction where the rental commences, without giving effect to the choice of law rules thereof, and you irrevocably and unconditionally consent and submit to the nonexclusive jurisdiction of the courts located in that jurisdiction. If any provision of this Agreement is deemed void or unenforceable, the remaining provisions shall remain valid and enforceable. YOU AND WE EACH IRREVOCABLY WAIVE ALL RIGHT TO TRIAL BY JURY IN ANY LEGAL PROCEEDING ARISING OUT OF OR RELATING TO THIS AGREEMENT OR THE TRANSACTIONS CONTEMPLATED UNDER THIS AGREEMENT.</li>
          </ol>
          <div class="signature">
            <p class="line"><strong>Signature</strong></p>
            ${
              signatureImageSrc
                ? `<img src="${signatureImageSrc}" alt="Signature" class="signature-image" />`
                : '<div class="signature-line"></div>'
            }
            <p class="signature-label">Signed at ${signedAtLabel}</p>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

async function createDocumentWithGotenberg(
  payload: Record<string, unknown>,
  options: { documentType?: GotenbergDocumentType } = {},
) {
  const form = new FormData();
  const logoAsset = await loadInvoiceLogoAsset();
  const documentType = options.documentType ?? "invoice";
  const conditionAsset =
    documentType === "rental_agreement" ? await loadRentalAgreementConditionAsset() : null;
  const html =
    documentType === "rental_agreement"
      ? renderGotenbergRentalAgreementHtml(payload, {
          logoFileName: logoAsset?.fileName ?? null,
          conditionImageFileName: conditionAsset?.fileName ?? null,
        })
      : renderGotenbergInvoiceHtml(payload, {
          logoFileName: logoAsset?.fileName ?? null,
        });
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  if (logoAsset) {
    form.append(
      "files",
      new Blob([new Uint8Array(logoAsset.bytes)], { type: logoAsset.contentType }),
      logoAsset.fileName,
    );
  }
  if (conditionAsset) {
    form.append(
      "files",
      new Blob([new Uint8Array(conditionAsset.bytes)], { type: conditionAsset.contentType }),
      conditionAsset.fileName,
    );
  }

  const endpoint = `${getGotenbergUrl()}/forms/chromium/convert/html`;
  const retryDelaysMs = [0, 200, 600];
  let response: Response | null = null;
  let lastFetchError: unknown = null;

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    const delay = retryDelaysMs[attempt];
    if (delay > 0) {
      await sleep(delay);
    }

    try {
      response = await fetch(endpoint, {
        method: "POST",
        body: form,
      });
      lastFetchError = null;
      break;
    } catch (error) {
      lastFetchError = error;
    }
  }

  if (!response) {
    const causeText =
      lastFetchError instanceof Error
        ? `${lastFetchError.message}${lastFetchError.cause ? ` (${String(lastFetchError.cause)})` : ""}`
        : String(lastFetchError ?? "unknown error");
    throw new Error(`Gotenberg connection failed (${endpoint}): ${causeText}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const safe = redactText(text).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`Gotenberg request failed: HTTP ${response.status}${safe ? `: ${safe}` : ""}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("Gotenberg returned an empty PDF");
  }

  const dataUrl = `data:application/pdf;base64,${buffer.toString("base64")}`;
  return {
    downloadUrl: dataUrl,
    previewUrl: dataUrl,
    documentId: null as string | null,
  };
}

export function buildInvoicePayload(input: InvoicePayloadInput) {
  const bookingPublicId = (input.bookingPublicId ?? "").trim() || input.bookingId.slice(0, 8);
  const invoiceReference = (input.invoiceNumber ?? "").trim() || bookingPublicId;
  const insuranceTotal = Math.max(0, Number(input.insuranceTotal ?? 0));
  const baseTotal = Number.isFinite(Number(input.baseTotal))
    ? Math.max(0, Number(input.baseTotal))
    : Math.max(0, Number(input.total) - insuranceTotal);
  return {
    booking: {
      id: input.bookingId,
      public_id: bookingPublicId,
      reference: bookingPublicId,
      invoice_number: invoiceReference,
      status: input.bookingStatus,
      pickup_location: input.pickupLocation,
      start_date: input.startDate,
      end_date: input.endDate,
    },
    customer: {
      name: input.customerName,
      email: input.customerEmail,
      phone: input.customerPhone,
      address: input.customerAddress ?? "",
    },
    vehicle: {
      make: input.vehicleMake,
      model: input.vehicleModel,
      year: input.vehicleYear,
      daily_rate: input.dailyRate,
    },
    charges: {
      total: input.total,
      deposit: input.deposit,
      base_total: baseTotal,
      insurance_total: insuranceTotal,
      promo_discount: input.promoDiscount ?? 0,
      promo_code: input.promoCode ?? null,
      paid_to_date: input.paidToDate,
      balance_due: input.balanceDue,
    },
    payments: input.payments,
    issued_at: new Date().toISOString(),
  };
}

export function buildRentalAgreementPayload(input: RentalAgreementPayloadInput) {
  return {
    booking: {
      id: input.bookingId,
      reference: input.bookingId.slice(0, 8),
      status: input.bookingStatus,
      pickup_location: input.pickupLocation,
      return_location: input.returnLocation ?? input.pickupLocation,
      start_date: input.startDate,
      end_date: input.endDate,
    },
    customer: {
      name: input.customerName,
      email: input.customerEmail,
      phone: input.customerPhone,
      address: input.customerAddress ?? "",
    },
    vehicle: {
      make: input.vehicleMake,
      model: input.vehicleModel,
      year: input.vehicleYear,
      daily_rate: input.dailyRate,
    },
    charges: {
      total: input.total,
      deposit: input.deposit,
      paid_to_date: input.paidToDate,
      balance_due: input.balanceDue,
      payment_method: input.paymentMethod ?? "",
    },
    signature: {
      image_data_url: input.signatureDataUrl ?? "",
      signed_at: input.signedAt ?? "",
    },
    issued_at: new Date().toISOString(),
  };
}

async function createDocumentSync(payload: Record<string, unknown>, meta: Record<string, unknown>) {
  const apiKey = getPdfMonkeyKey();
  const templateId = getTemplateId();
  if (!apiKey || !templateId) {
    return null;
  }

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
    const safe = redactText(text).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`PDFMonkey request failed: HTTP ${response.status}${safe ? `: ${safe}` : ""}`);
  }

  const data = (await response.json()) as {
    document?: PdfMonkeyDocument;
    document_card?: PdfMonkeyDocument;
  };

  return data.document_card ?? data.document ?? null;
}

async function fetchDocument(documentId: string) {
  const apiKey = getPdfMonkeyKey();
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

export async function generateInvoicePdf(
  payload: Record<string, unknown>,
  bookingId: string,
  options: GenerateInvoicePdfOptions = {},
) {
  const provider = getInvoicePdfProvider();
  const templateId = provider === "pdfmonkey" ? getTemplateId() : null;
  const payloadHash = hashInvoicePayload(payload);
  let ledgerId: string | null = null;

  try {
    const ledger = await getOrCreateInvoiceLedgerRow({
      bookingId,
      payloadHash,
      source: options.source ?? (provider === "gotenberg" ? "GOTENBERG" : "PDFMONKEY"),
      templateId,
      createdByUserId: options.createdByUserId ?? null,
    });
    ledgerId = ledger.id;
  } catch (error) {
    logError("invoice_ledger_upsert_failed", error, { bookingId });
  }

  const meta = {
    _filename: `invoice-${bookingId.slice(0, 8)}.pdf`,
    booking_id: bookingId,
  };

  try {
    if (provider === "gotenberg") {
      const document = await createDocumentWithGotenberg(payload);
      if (ledgerId) {
        await markInvoiceProviderInfo({
          ledgerId,
          providerStatus: "SUCCESS",
          downloadUrl: document.downloadUrl ?? null,
        });
      }
      return {
        downloadUrl: document.downloadUrl,
        previewUrl: document.previewUrl,
        documentId: document.documentId ?? undefined,
      };
    }

    let document = await createDocumentSync(payload, meta);
    if (!document) {
      if (ledgerId) {
        await markInvoiceProviderInfo({
          ledgerId,
          providerStatus: "SKIPPED",
        });
      }
      return null;
    }

    const status = document.status ?? "";
    const statusNormalized = status.toLowerCase();

    // Treat explicit failures as errors, but allow "pending"/"generating" by polling briefly.
    if (statusNormalized && statusNormalized !== "success") {
      if (["failure", "failed", "error", "canceled", "cancelled"].includes(statusNormalized)) {
        throw new Error(document.failure_cause ?? "PDFMonkey generation failed");
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
            throw new Error(refreshed.failure_cause ?? "PDFMonkey generation failed");
          }
        }
      }
    }

    if ((document.status ?? "").toLowerCase() !== "success") {
      // Still pending after retries.
      if (ledgerId) {
        await markInvoiceProviderInfo({
          ledgerId,
          providerDocumentId: document.id ?? null,
          providerStatus: document.status ?? "PENDING",
        });
      }
      return null;
    }

    let downloadUrl = document.download_url ?? undefined;
    let previewUrl = document.preview_url ?? undefined;

    if ((!downloadUrl || !previewUrl) && document.id) {
      const refreshed = await fetchDocument(document.id);
      if (refreshed && (refreshed.status ?? "").toLowerCase() === "success") {
        downloadUrl = refreshed.download_url ?? downloadUrl;
        previewUrl = refreshed.preview_url ?? previewUrl;
      }
    }

    if (ledgerId) {
      await markInvoiceProviderInfo({
        ledgerId,
        providerDocumentId: document.id ?? null,
        providerStatus: document.status ?? "SUCCESS",
        downloadUrl: downloadUrl ?? null,
      });
    }

    return {
      downloadUrl,
      previewUrl,
      documentId: document.id,
    };
  } catch (error) {
    if (ledgerId) {
      try {
        await markInvoiceProviderInfo({
          ledgerId,
          providerStatus: "FAILED",
          lastError: error instanceof Error ? error.message : String(error),
        });
      } catch (markError) {
        logError("invoice_ledger_error_update_failed", markError, { bookingId, payloadHash });
      }
    }
    throw error;
  }
}

export async function generateRentalAgreementPdf(payload: Record<string, unknown>) {
  const provider = getInvoicePdfProvider();
  if (provider !== "gotenberg") return null;

  const document = await createDocumentWithGotenberg(payload, {
    documentType: "rental_agreement",
  });
  return {
    downloadUrl: document.downloadUrl,
    previewUrl: document.previewUrl,
    documentId: document.documentId ?? undefined,
  };
}

export async function downloadPdfBase64(downloadUrl: string) {
  const dataUrlMatch = downloadUrl.match(DATA_URL_BASE64_REGEX);
  if (dataUrlMatch && dataUrlMatch[1]) {
    return dataUrlMatch[1];
  }

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download PDF (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}
