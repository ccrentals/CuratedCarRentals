import { siteContent } from "@/data/content";
import { isVehicleUnavailableWithAvailabilityRules } from "@/lib/bookings/availabilityRules";
import {
  appendBookingLocationNote,
  formatBookingLocationDisplayText,
  readBookingLocationDetails,
  type BookingLocationDetails,
  type BookingLocationDetailsEntry,
} from "@/lib/bookings/bookingLocations";
import { writeAuditLog } from "@/lib/audit";
import { CustomerBlockedError, upsertCustomerForBooking } from "@/lib/customers";
import { dbQuery, getDbPool } from "@/lib/db";
import { logWarn } from "@/lib/log";
import { validatePromoForBooking } from "@/lib/promos";
import { resolveEffectiveQuoteStatus } from "@/lib/quotes/lifecycle";
import { buildQuotePricingSnapshot } from "@/lib/quotes/quotePricing";
import {
  sendTrackedResendEmail,
  type EmailDispatchContext,
} from "@/lib/notifications/emailDispatch";

const DEFAULT_FROM = "onboarding@resend.dev";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
};

type QuoteRow = {
  id: string;
  public_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  status: string;
  expires_at: string | Date | null;
  customer_full_name: string;
  customer_email: string;
  customer_phone: string | null;
  start_at: string | Date;
  end_at: string | Date;
  pickup_location_id: string | null;
  dropoff_location_id: string | null;
  pickup_location_text: string;
  dropoff_location_text: string;
  vehicle_id: string | null;
  vehicle_label: string;
  vehicle_class: string | null;
  pricing_json: Record<string, unknown>;
  base_total_cents: number;
  insurance_total_cents: number;
  discount_total_cents: number;
  subtotal_cents: number;
  total_cents: number;
  deposit_required_cents: number;
  amount_due_cents: number;
  promo_code: string | null;
  insurance_plan_id: string | null;
  insurance_enabled: boolean;
  tags: string[];
  comments: string | null;
  commission_partner_name: string | null;
  client_pays_at_partner: boolean;
  rack_price_cents: number | null;
  created_by_admin_user_id: string | null;
  last_emailed_at: string | Date | null;
  last_emailed_to: string | null;
  converted_booking_id: string | null;
};

export type QuoteOpsQuote = {
  id: string;
  publicId: string | null;
  createdAt: string;
  updatedAt: string;
  status: string;
  expiresAt: string | null;
  customerFullName: string;
  customerEmail: string;
  customerPhone: string | null;
  startAt: string;
  endAt: string;
  pickupLocationId: string | null;
  dropoffLocationId: string | null;
  pickupLocationText: string;
  dropoffLocationText: string;
  bookingLocationDetails: BookingLocationDetails;
  vehicleId: string | null;
  vehicleLabel: string;
  vehicleClass: string | null;
  pricingJson: Record<string, unknown>;
  baseTotalCents: number;
  insuranceTotalCents: number;
  discountTotalCents: number;
  subtotalCents: number;
  totalCents: number;
  depositRequiredCents: number;
  amountDueCents: number;
  promoCode: string | null;
  insurancePlanId: string | null;
  insuranceEnabled: boolean;
  tags: string[];
  comments: string | null;
  commissionPartnerName: string | null;
  clientPaysAtPartner: boolean;
  rackPriceCents: number | null;
  createdByAdminUserId: string | null;
  lastEmailedAt: string | null;
  lastEmailedTo: string | null;
  convertedBookingId: string | null;
};

export type QuoteEventType =
  | "CREATED"
  | "UPDATED"
  | "EMAILED"
  | "STATUS_CHANGED"
  | "CONVERTED"
  | "PDF_GENERATED";

export class QuoteOpsError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function assertUuid(value: string, code: string) {
  if (!UUID_REGEX.test(value)) {
    throw new QuoteOpsError(code, "Invalid identifier.", 400);
  }
}

function toIso(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(String(value ?? ""));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return String(value ?? "");
}

function toDate(value: unknown, code = "INVALID_DATE") {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(String(value ?? ""));
  if (!Number.isNaN(parsed.getTime())) return parsed;
  throw new QuoteOpsError(code, "Invalid date supplied.", 400);
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeNullableText(value: unknown) {
  const text = normalizeText(value);
  return text ? text : null;
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed);
}

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
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-JM", {
    dateStyle: "medium",
  });
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mapQuoteRow(row: QuoteRow): QuoteOpsQuote {
  const status = resolveEffectiveQuoteStatus(row.status, row.expires_at);
  const pricingJson = row.pricing_json ?? {};
  const bookingLocationDetails = readBookingLocationDetails(pricingJson, {
    pickupLabel: normalizeText(row.pickup_location_text),
    dropoffLabel: normalizeText(row.dropoff_location_text),
    pickupLocationId: normalizeNullableText(row.pickup_location_id),
    dropoffLocationId: normalizeNullableText(row.dropoff_location_id),
  });
  return {
    id: row.id,
    publicId: normalizeNullableText(row.public_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    status,
    expiresAt: row.expires_at ? toIso(row.expires_at) : null,
    customerFullName: normalizeText(row.customer_full_name),
    customerEmail: normalizeText(row.customer_email),
    customerPhone: normalizeNullableText(row.customer_phone),
    startAt: toIso(row.start_at),
    endAt: toIso(row.end_at),
    pickupLocationId: normalizeNullableText(row.pickup_location_id),
    dropoffLocationId: normalizeNullableText(row.dropoff_location_id),
    pickupLocationText: normalizeText(row.pickup_location_text),
    dropoffLocationText: normalizeText(row.dropoff_location_text),
    bookingLocationDetails,
    vehicleId: normalizeNullableText(row.vehicle_id),
    vehicleLabel: normalizeText(row.vehicle_label),
    vehicleClass: normalizeNullableText(row.vehicle_class),
    pricingJson,
    baseTotalCents: normalizeInt(row.base_total_cents),
    insuranceTotalCents: normalizeInt(row.insurance_total_cents),
    discountTotalCents: normalizeInt(row.discount_total_cents),
    subtotalCents: normalizeInt(row.subtotal_cents),
    totalCents: normalizeInt(row.total_cents),
    depositRequiredCents: normalizeInt(row.deposit_required_cents),
    amountDueCents: normalizeInt(row.amount_due_cents),
    promoCode: normalizeNullableText(row.promo_code),
    insurancePlanId: normalizeNullableText(row.insurance_plan_id),
    insuranceEnabled: normalizeBoolean(row.insurance_enabled),
    tags: Array.isArray(row.tags) ? row.tags.filter((entry) => typeof entry === "string") : [],
    comments: normalizeNullableText(row.comments),
    commissionPartnerName: normalizeNullableText(row.commission_partner_name),
    clientPaysAtPartner: normalizeBoolean(row.client_pays_at_partner),
    rackPriceCents: row.rack_price_cents == null ? null : normalizeInt(row.rack_price_cents),
    createdByAdminUserId: normalizeNullableText(row.created_by_admin_user_id),
    lastEmailedAt: row.last_emailed_at ? toIso(row.last_emailed_at) : null,
    lastEmailedTo: normalizeNullableText(row.last_emailed_to),
    convertedBookingId: normalizeNullableText(row.converted_booking_id),
  };
}

function formatLocationLines(entry: BookingLocationDetailsEntry) {
  const details = formatBookingLocationDisplayText(entry, { separator: " | " });
  return details || entry.label || "—";
}

function formatLocationHtml(entry: BookingLocationDetailsEntry) {
  return escapeHtml(formatLocationLines(entry)).replace(/\n/g, "<br />");
}

export async function fetchQuoteByIdForOps(
  quoteId: string,
  options: { client?: Queryable } = {},
): Promise<QuoteOpsQuote | null> {
  assertUuid(quoteId, "INVALID_QUOTE_ID");

  const db = options.client ?? {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };

  const result = await db.query(
    "select id, public_id, created_at, updated_at, status, expires_at, customer_full_name, customer_email, customer_phone, start_at, end_at, pickup_location_id, dropoff_location_id, pickup_location_text, dropoff_location_text, vehicle_id, vehicle_label, vehicle_class, pricing_json, base_total_cents, insurance_total_cents, discount_total_cents, subtotal_cents, total_cents, deposit_required_cents, amount_due_cents, promo_code, insurance_plan_id, insurance_enabled, tags, comments, commission_partner_name, client_pays_at_partner, rack_price_cents, created_by_admin_user_id, last_emailed_at, last_emailed_to, converted_booking_id from quotes where id = $1::uuid limit 1",
    [quoteId],
  );

  const row = result.rows[0] as QuoteRow | undefined;
  return row ? mapQuoteRow(row) : null;
}

export async function insertQuoteEvent(
  quoteId: string,
  eventType: QuoteEventType,
  input: {
    actorAdminUserId?: string | null;
    meta?: Record<string, unknown>;
    client?: Queryable;
  } = {},
) {
  const db = input.client ?? {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };

  await db.query(
    "insert into quote_events (quote_id, event_type, actor_admin_user_id, meta) values ($1::uuid, $2, $3::uuid, $4::jsonb)",
    [quoteId, eventType, input.actorAdminUserId ?? null, JSON.stringify(input.meta ?? {})],
  );
}

export async function recordQuoteEmailLog(
  input: {
    quoteId: string;
    toEmail: string;
    subject: string;
    status: "SENT" | "FAILED";
    providerMessageId?: string | null;
    error?: string | null;
    client?: Queryable;
  },
) {
  const db = input.client ?? {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };

  await db.query(
    "insert into quote_emails (quote_id, to_email, subject, status, provider_message_id, error) values ($1::uuid, $2, $3, $4, $5, $6)",
    [
      input.quoteId,
      input.toEmail,
      input.subject,
      input.status,
      input.providerMessageId ?? null,
      input.error ?? null,
    ],
  );
}

export async function updateQuoteLastEmailed(
  input: { quoteId: string; toEmail: string; client?: Queryable },
) {
  const db = input.client ?? {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };

  await db.query(
    "update quotes set last_emailed_at = now(), last_emailed_to = $2, updated_at = now() where id = $1::uuid",
    [input.quoteId, input.toEmail],
  );
}

export function buildQuoteEmailContent(input: {
  quote: QuoteOpsQuote;
  toEmail: string;
  message?: string | null;
}) {
  const displayQuoteId = input.quote.publicId || input.quote.id.slice(0, 8);
  const subject = `Your Quote from ${siteContent.brand} — ${displayQuoteId}`;
  const note = normalizeNullableText(input.message);

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Your rental quote</h2>
      <p>Hello ${escapeHtml(input.quote.customerFullName || "Customer")},</p>
      <p>Thanks for choosing ${escapeHtml(siteContent.brand)}. Your quote summary is below.</p>
      <p><strong>Quote ID:</strong> ${escapeHtml(displayQuoteId)}</p>
      <p><strong>Vehicle:</strong> ${escapeHtml(input.quote.vehicleLabel || "—")}</p>
      <p><strong>Pickup:</strong> ${escapeHtml(formatDateTime(input.quote.startAt))}<br />${formatLocationHtml(input.quote.bookingLocationDetails.pickup)}</p>
      <p><strong>Dropoff:</strong> ${escapeHtml(formatDateTime(input.quote.endAt))}<br />${formatLocationHtml(input.quote.bookingLocationDetails.dropoff)}</p>
      <hr />
      <p><strong>Total:</strong> ${escapeHtml(formatAmount(input.quote.totalCents))}</p>
      <p><strong>Deposit required:</strong> ${escapeHtml(formatAmount(input.quote.depositRequiredCents))}</p>
      <p><strong>Amount due now:</strong> ${escapeHtml(formatAmount(input.quote.amountDueCents))}</p>
      ${
        input.quote.expiresAt
          ? `<p><strong>Expires:</strong> ${escapeHtml(formatDateTime(input.quote.expiresAt))}</p>`
          : ""
      }
      ${note ? `<p><strong>Message from our team:</strong><br />${escapeHtml(note)}</p>` : ""}
      <p style="margin-top: 14px;">A PDF copy of this quote is attached for your records.</p>
      <p style="font-size: 12px; color: #64748b; margin-top: 16px;">
        This is a quote. Vehicle is not reserved until deposit/payment is received.<br />
        Questions? Contact us at ${escapeHtml(siteContent.email)} or ${escapeHtml(siteContent.phone)}.
      </p>
    </div>
  `;

  return { subject, html };
}

export type SendQuoteEmailResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  providerMessageId?: string | null;
};

export async function sendQuoteEmailWithAttachment(input: {
  toEmail: string;
  subject: string;
  html: string;
  attachmentFilename: string;
  attachmentBase64: string;
  dispatch?: EmailDispatchContext;
}): Promise<SendQuoteEmailResult> {
  if (!input.dispatch) {
    logWarn("quote_email_missing_dispatch_context", {
      toEmail: input.toEmail,
      subject: input.subject,
    });
    return { ok: false, error: "Missing email dispatch context" };
  }

  return sendTrackedResendEmail({
    to: input.toEmail,
    subject: input.subject,
    html: input.html,
    replyTo: process.env.RESEND_FROM?.trim() || DEFAULT_FROM,
    attachments: [
      {
        filename: input.attachmentFilename,
        content: input.attachmentBase64,
      },
    ],
    dispatch: input.dispatch,
  });
}

function sanitizePdfText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

function wrapPdfLine(line: string, maxChars = 96) {
  const clean = line.trimEnd();
  if (clean.length <= maxChars) return [clean];

  const wrapped: string[] = [];
  let cursor = clean;
  while (cursor.length > maxChars) {
    const splitAt = cursor.lastIndexOf(" ", maxChars);
    const index = splitAt > 0 ? splitAt : maxChars;
    wrapped.push(cursor.slice(0, index));
    cursor = cursor.slice(index).trimStart();
  }
  if (cursor.length > 0) wrapped.push(cursor);
  return wrapped;
}

function formatRgb(color: [number, number, number]) {
  return color.map((value) => value.toFixed(3)).join(" ");
}

function pushPdfRect(input: {
  commands: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  fill: [number, number, number];
  stroke?: [number, number, number];
  lineWidth?: number;
}) {
  input.commands.push(`${formatRgb(input.fill)} rg`);
  if (input.stroke) {
    input.commands.push(`${formatRgb(input.stroke)} RG`);
    input.commands.push(`${Math.max(0.1, Number(input.lineWidth ?? 1)).toFixed(2)} w`);
  }
  input.commands.push(
    `${input.x.toFixed(2)} ${input.y.toFixed(2)} ${input.width.toFixed(2)} ${input.height.toFixed(2)} re`,
  );
  input.commands.push(input.stroke ? "B" : "f");
}

function pushPdfText(input: {
  commands: string[];
  x: number;
  y: number;
  lines: string[];
  font: "F1" | "F2";
  fontSize: number;
  color: [number, number, number];
  lineHeight?: number;
}) {
  const printable = input.lines.filter((line) => line.length > 0);
  if (printable.length === 0) return;
  input.commands.push("BT");
  input.commands.push(`/${input.font} ${input.fontSize.toFixed(2)} Tf`);
  input.commands.push(`${formatRgb(input.color)} rg`);
  input.commands.push(`${input.x.toFixed(2)} ${input.y.toFixed(2)} Td`);
  input.commands.push(`${(input.lineHeight ?? input.fontSize * 1.35).toFixed(2)} TL`);
  printable.forEach((line, index) => {
    input.commands.push(`(${sanitizePdfText(line)}) Tj`);
    if (index < printable.length - 1) {
      input.commands.push("T*");
    }
  });
  input.commands.push("ET");
}

function buildSinglePagePdf(commands: string[]) {
  const pageWidth = 595;
  const pageHeight = 842;
  const stream = commands.join("\n");
  const contentLength = Buffer.byteLength(stream, "ascii");

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [5 0 R] /Count 1 >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  objects[5] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
    `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>`;
  objects[6] = `<< /Length ${contentLength} >>\nstream\n${stream}\nendstream`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  const maxObjectId = objects.length - 1;

  for (let id = 1; id <= maxObjectId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "ascii");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${maxObjectId + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id <= maxObjectId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

export function buildQuotePdfBuffer(quote: QuoteOpsQuote) {
  const displayQuoteId = quote.publicId || quote.id.slice(0, 8);
  const created = formatDateTime(quote.createdAt);
  const issuedDate = formatDate(quote.createdAt);
  const expires = quote.expiresAt ? formatDateTime(quote.expiresAt) : "Not set";
  const status = quote.status || "DRAFT";
  const promoCode = quote.promoCode || "—";

  const brandAccent: [number, number, number] = [0.090, 0.545, 0.510];
  const headingText: [number, number, number] = [0.078, 0.118, 0.216];
  const bodyText: [number, number, number] = [0.082, 0.094, 0.122];
  const mutedText: [number, number, number] = [0.329, 0.423, 0.553];
  const cardFill: [number, number, number] = [0.972, 0.976, 0.984];
  const cardStroke: [number, number, number] = [0.820, 0.855, 0.910];
  const highlightFill: [number, number, number] = [0.905, 0.949, 0.929];

  const commands: string[] = [];

  // Invoice-style top accent + neutral header.
  pushPdfRect({
    commands,
    x: 40,
    y: 794,
    width: 515,
    height: 8,
    fill: brandAccent,
  });

  pushPdfText({
    commands,
    x: 54,
    y: 754,
    lines: ["Quote"],
    font: "F2",
    fontSize: 28,
    color: headingText,
  });

  pushPdfText({
    commands,
    x: 54,
    y: 730,
    lines: [`Quote #${displayQuoteId} · Issued ${issuedDate}`],
    font: "F1",
    fontSize: 11,
    color: mutedText,
  });

  pushPdfText({
    commands,
    x: 340,
    y: 748,
    lines: [siteContent.brand],
    font: "F2",
    fontSize: 14,
    color: headingText,
  });

  pushPdfText({
    commands,
    x: 340,
    y: 729,
    lines: [...wrapPdfLine(`${siteContent.email} | ${siteContent.phone}`, 37)],
    font: "F1",
    fontSize: 10,
    color: mutedText,
  });

  pushPdfText({
    commands,
    x: 340,
    y: 713,
    lines: [
      ...wrapPdfLine(
        `Pickup: ${formatLocationLines(quote.bookingLocationDetails.pickup)}`,
        37,
      ),
    ],
    font: "F1",
    fontSize: 10,
    color: mutedText,
  });

  // Left card: Customer + reservation
  pushPdfRect({
    commands,
    x: 40,
    y: 515,
    width: 250,
    height: 205,
    fill: cardFill,
    stroke: cardStroke,
  });

  const leftLines = [
    ...wrapPdfLine(`Name: ${quote.customerFullName || "—"}`, 34),
    ...wrapPdfLine(`Email: ${quote.customerEmail || "—"}`, 34),
    ...wrapPdfLine(`Phone: ${quote.customerPhone || "—"}`, 34),
    "",
    ...wrapPdfLine(`Pickup: ${formatDateTime(quote.startAt)}`, 34),
    ...wrapPdfLine(formatLocationLines(quote.bookingLocationDetails.pickup), 34),
    "",
    ...wrapPdfLine(`Dropoff: ${formatDateTime(quote.endAt)}`, 34),
    ...wrapPdfLine(formatLocationLines(quote.bookingLocationDetails.dropoff), 34),
  ];

  pushPdfText({
    commands,
    x: 54,
    y: 698,
    lines: ["Customer & Reservation"],
    font: "F2",
    fontSize: 12,
    color: headingText,
  });

  pushPdfText({
    commands,
    x: 54,
    y: 678,
    lines: leftLines,
    font: "F1",
    fontSize: 10,
    color: bodyText,
    lineHeight: 13,
  });

  // Right card: quote details
  pushPdfRect({
    commands,
    x: 305,
    y: 515,
    width: 250,
    height: 205,
    fill: cardFill,
    stroke: cardStroke,
  });

  pushPdfText({
    commands,
    x: 319,
    y: 698,
    lines: ["Quote Details"],
    font: "F2",
    fontSize: 12,
    color: headingText,
  });

  pushPdfText({
    commands,
    x: 319,
    y: 678,
    lines: [
      ...wrapPdfLine(`Status: ${status}`, 34),
      ...wrapPdfLine(`Created: ${created}`, 34),
      ...wrapPdfLine(`Expires: ${expires}`, 34),
      "",
      ...wrapPdfLine(`Vehicle: ${quote.vehicleLabel || "—"}`, 34),
      ...wrapPdfLine(`Class: ${quote.vehicleClass || "—"}`, 34),
      ...wrapPdfLine(`Promo code: ${promoCode}`, 34),
    ],
    font: "F1",
    fontSize: 10,
    color: bodyText,
    lineHeight: 13,
  });

  // Pricing summary block
  pushPdfRect({
    commands,
    x: 40,
    y: 285,
    width: 515,
    height: 205,
    fill: [0.988, 0.988, 0.996],
    stroke: cardStroke,
  });

  pushPdfText({
    commands,
    x: 54,
    y: 467,
    lines: ["Pricing Summary (JMD)"],
    font: "F2",
    fontSize: 12,
    color: headingText,
  });

  const pricingRows = [
    { label: "Rental subtotal", value: formatAmount(quote.baseTotalCents) },
    { label: "Insurance total", value: formatAmount(quote.insuranceTotalCents) },
    { label: "Promo discount", value: `-${formatAmount(quote.discountTotalCents)}` },
    { label: "Total of booking", value: formatAmount(quote.totalCents) },
    { label: "Deposit required", value: formatAmount(quote.depositRequiredCents) },
    { label: "Amount due now", value: formatAmount(quote.amountDueCents), highlight: true },
  ];

  let rowY = 440;
  for (const row of pricingRows) {
    if (row.highlight) {
      pushPdfRect({
        commands,
        x: 50,
        y: rowY - 6,
        width: 495,
        height: 22,
        fill: highlightFill,
      });
    }

    pushPdfText({
      commands,
      x: 56,
      y: rowY + 6,
      lines: [row.label],
      font: row.highlight ? "F2" : "F1",
      fontSize: 11,
      color: bodyText,
    });

    pushPdfText({
      commands,
      x: 430,
      y: rowY + 6,
      lines: [row.value],
      font: row.highlight ? "F2" : "F1",
      fontSize: 11,
      color: bodyText,
    });

    rowY -= 28;
  }

  const notes = [
    ...wrapPdfLine(
      "This is a quote. Vehicle is not reserved until deposit/payment is received.",
      96,
    ),
    ...wrapPdfLine(`Contact: ${siteContent.email} | ${siteContent.phone}`, 96),
  ];

  pushPdfText({
    commands,
    x: 40,
    y: 248,
    lines: notes,
    font: "F1",
    fontSize: 10,
    color: mutedText,
    lineHeight: 13,
  });

  return buildSinglePagePdf(commands);
}

function readInsurancePricePerDay(pricingJson: Record<string, unknown>) {
  return normalizeInt(pricingJson.insurance_price_per_day_cents);
}

export async function convertQuoteToBooking(input: {
  quoteId: string;
  actorAdminUserId?: string | null;
}) {
  assertUuid(input.quoteId, "INVALID_QUOTE_ID");

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const quoteResult = await client.query(
      "select id, public_id, created_at, updated_at, status, expires_at, customer_full_name, customer_email, customer_phone, start_at, end_at, pickup_location_id, dropoff_location_id, pickup_location_text, dropoff_location_text, vehicle_id, vehicle_label, vehicle_class, pricing_json, base_total_cents, insurance_total_cents, discount_total_cents, subtotal_cents, total_cents, deposit_required_cents, amount_due_cents, promo_code, insurance_plan_id, insurance_enabled, tags, comments, commission_partner_name, client_pays_at_partner, rack_price_cents, created_by_admin_user_id, last_emailed_at, last_emailed_to, converted_booking_id from quotes where id = $1::uuid for update",
      [input.quoteId],
    );

    const quoteRow = quoteResult.rows[0] as QuoteRow | undefined;
    if (!quoteRow) {
      throw new QuoteOpsError("NOT_FOUND", "Quote not found.", 404);
    }

    const quote = mapQuoteRow(quoteRow);

    if (quote.convertedBookingId) {
      await client.query("commit");
      return { bookingId: quote.convertedBookingId, alreadyConverted: true };
    }

    if (quote.status === "EXPIRED") {
      throw new QuoteOpsError("QUOTE_EXPIRED", "Quote is expired.", 409);
    }

    if (!quote.vehicleId) {
      throw new QuoteOpsError("VEHICLE_REQUIRED", "Quote must have a vehicle before conversion.", 409);
    }

    if (!quote.customerPhone) {
      throw new QuoteOpsError("PHONE_REQUIRED", "Customer phone is required before conversion.", 400);
    }

    const startAt = toDate(quote.startAt, "INVALID_WINDOW");
    const endAt = toDate(quote.endAt, "INVALID_WINDOW");
    if (endAt <= startAt) {
      throw new QuoteOpsError(
        "INVALID_WINDOW",
        "Return date and time must be later than pickup date and time.",
        400,
      );
    }

    const availability = await isVehicleUnavailableWithAvailabilityRules(
      {
        vehicleId: quote.vehicleId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      },
      { client, includeBlockouts: true },
    );

    if (availability.unavailable) {
      throw new QuoteOpsError(
        "VEHICLE_UNAVAILABLE",
        availability.reasons[0] ??
          "Vehicle is no longer available for the selected rental window.",
        409,
      );
    }

    let customerUpsert;
    try {
      customerUpsert = await upsertCustomerForBooking(
        {
          fullName: quote.customerFullName,
          email: quote.customerEmail,
          phone: quote.customerPhone,
          bookedAt: new Date().toISOString(),
        },
        { client },
      );
    } catch (error) {
      if (error instanceof CustomerBlockedError) {
        throw new QuoteOpsError(
          "CUSTOMER_BLOCKED",
          "Customer is blocked from booking. Unblock customer before converting.",
          409,
        );
      }
      throw error;
    }

    const pricingSnapshot = await buildQuotePricingSnapshot(
      {
        vehicleId: quote.vehicleId,
        startAt,
        endAt,
        insuranceEnabled: quote.insuranceEnabled,
        insurancePlanId: quote.insurancePlanId,
        promoCode: quote.promoCode,
        customerEmail: quote.customerEmail,
        rackPriceCents: quote.rackPriceCents,
        deliverySelected:
          normalizeBoolean((quote.pricingJson ?? {})["delivery_selected"]) || false,
        deliveryZoneLabel:
          normalizeNullableText((quote.pricingJson ?? {})["delivery_zone_label"]) ?? null,
      },
      { client },
    );

    const startDate = toDateOnly(startAt);
    const endDate = toDateOnly(endAt);
    if (endDate <= startDate) {
      throw new QuoteOpsError(
        "INVALID_WINDOW",
        "Quote dates cannot be converted into a valid booking date range.",
        400,
      );
    }

    let promoId: string | null = null;
    let promoDiscount = pricingSnapshot.summary.discountTotalCents;
    const promoCode = pricingSnapshot.promoCode;

    if (promoCode) {
      const promoValidation = await validatePromoForBooking({
        code: promoCode,
        vehicleId: quote.vehicleId,
        startDate,
        endDate,
        subtotalCents: pricingSnapshot.summary.subtotalCents,
        baseTotalCents: pricingSnapshot.summary.baseTotalCents,
        customerId: customerUpsert.customerId,
        customerEmail: quote.customerEmail,
        client,
      });

      if (!promoValidation.ok) {
        throw new QuoteOpsError("PROMO_INVALID", promoValidation.message, 400);
      }

      promoId = promoValidation.promoId;
      promoDiscount = promoValidation.discountAmountCents;
    }

    const paymentOptionRaw = normalizeText(
      (pricingSnapshot.pricingJson ?? {})["payment_option_selected"],
    ).toUpperCase();
    const paymentOption = paymentOptionRaw || "DEPOSIT";
    const insurancePricePerDay = readInsurancePricePerDay(pricingSnapshot.pricingJson);
    const deliveryFeeCents = normalizeInt((pricingSnapshot.pricingJson ?? {})["delivery_fee_cents"]);
    const extraFeesCents = normalizeInt((pricingSnapshot.pricingJson ?? {})["extra_fees_cents"]);

    const bookingPricingBase = {
      ...pricingSnapshot.pricingJson,
      customer_name_snapshot: quote.customerFullName,
      customer_email_snapshot: quote.customerEmail,
      customer_phone_snapshot: quote.customerPhone,
      promo_code_id: promoId,
      promo_discount_cents: promoDiscount,
      discount_total_cents: pricingSnapshot.summary.discountTotalCents,
      insurance_selected: pricingSnapshot.insuranceEnabled,
      insurance_plan_id: pricingSnapshot.insurancePlanId,
      insurance_price_per_day_cents: insurancePricePerDay,
      insurance_total_cents: pricingSnapshot.summary.insuranceTotalCents,
      base_total_cents: pricingSnapshot.summary.baseTotalCents,
      delivery_fee_cents: deliveryFeeCents,
      extra_fees_cents: extraFeesCents,
      subtotal_cents: pricingSnapshot.summary.subtotalCents,
      total_amount: pricingSnapshot.summary.totalCents,
      total_cents: pricingSnapshot.summary.totalCents,
      amount_paid: 0,
      paid_to_date: 0,
      balance_due: pricingSnapshot.summary.amountDueCents,
      amount_due_cents: pricingSnapshot.summary.amountDueCents,
      deposit_required_cents: pricingSnapshot.summary.depositRequiredCents,
      deposit_cents: pricingSnapshot.summary.depositRequiredCents,
      payment_status: "UNPAID",
      payment_option_selected: paymentOption,
      currency: "JMD",
      quote_id: quote.id,
      quote_rack_price_cents: pricingSnapshot.rackPriceCents,
    };
    const bookingPricingJson = appendBookingLocationNote(
      bookingPricingBase,
      quote.bookingLocationDetails,
    );

    const bookingInsert = await client.query(
      "insert into bookings (vehicle_id, customer_id, start_date, end_date, pickup_location, status, pricing_json, pickup_location_id, dropoff_location_id, dropoff_location, pickup_location_text_snapshot, dropoff_location_text_snapshot, start_at, end_at, insurance_selected, insurance_plan_id, insurance_price_per_day_cents, insurance_total_cents, payment_option) values ($1::uuid, $2::uuid, $3::date, $4::date, $5, 'PENDING_PAYMENT', $6::jsonb, $7::uuid, $8::uuid, $9, $10, $11, $12::timestamptz, $13::timestamptz, $14, $15::uuid, $16, $17, $18) returning id, status",
      [
        quote.vehicleId,
        customerUpsert.customerId,
        startDate,
        endDate,
        quote.pickupLocationText,
        JSON.stringify(bookingPricingJson),
        quote.pickupLocationId,
        quote.dropoffLocationId,
        quote.dropoffLocationText,
        quote.pickupLocationText,
        quote.dropoffLocationText,
        startAt.toISOString(),
        endAt.toISOString(),
        pricingSnapshot.insuranceEnabled,
        pricingSnapshot.insurancePlanId,
        insurancePricePerDay,
        pricingSnapshot.summary.insuranceTotalCents,
        paymentOption,
      ],
    );

    const bookingId = (bookingInsert.rows[0] as { id?: string } | undefined)?.id;
    if (!bookingId) {
      throw new QuoteOpsError("BOOKING_CREATE_FAILED", "Failed to create booking from quote.", 500);
    }

    await client.query(
      "update quotes set status = 'CONVERTED', converted_booking_id = $2::uuid, updated_at = now() where id = $1::uuid",
      [quote.id, bookingId],
    );

    await insertQuoteEvent(quote.id, "CONVERTED", {
      actorAdminUserId: input.actorAdminUserId ?? null,
      meta: {
        bookingId,
        fromStatus: quote.status,
      },
      client,
    });

    await client.query("commit");

    await writeAuditLog({
      userId: input.actorAdminUserId ?? null,
      action: "BOOKING_CREATED_FROM_QUOTE",
      entityType: "booking",
      entityId: bookingId,
      details: {
        quote_id: quote.id,
        customer_id: customerUpsert.customerId,
        vehicle_id: quote.vehicleId,
        start_at: quote.startAt,
        end_at: quote.endAt,
      },
    }).catch((error) => {
      logWarn("booking_created_from_quote_audit_failed", {
        quoteId: quote.id,
        bookingId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return { bookingId, alreadyConverted: false };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function isQuoteOpsMissingTableError(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "").toUpperCase();
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return (
    code === "42P01" &&
    (message.includes("quotes") || message.includes("quote_events") || message.includes("quote_emails"))
  );
}
