import {
  buildInvoicePayload,
  downloadPdfBase64,
  generateInvoicePdf,
  generateRentalAgreementPdf,
} from "@/lib/pdfmonkey";
import { loadBookingRentalAgreementPayload } from "@/lib/agreements/rentalAgreementPayload";
import {
  formatBookingLocationDisplayText,
  readBookingLocationDetails,
} from "@/lib/bookings/bookingLocations";
import {
  createBookingEmailAccessSignature,
  readBookingAccessHash,
} from "@/lib/bookings/privateAccess";
import { logError, logWarn } from "@/lib/log";
import { readInsurancePricingFields, readPromoPricingFields } from "@/lib/payments/pricing";
import { dbQuery } from "@/lib/db";
import { formatPaymentStatus } from "@/lib/payments/formatPaymentStatus";
import { calcDaysInclusive } from "@/lib/payments/dateMath";
import { resolveStoredRegionCountry } from "@/lib/jamaicaParishes";
import {
  sendTrackedResendEmail,
  type EmailDispatchAttachment,
  type EmailDispatchContext,
  type SendTrackedEmailResult,
} from "@/lib/notifications/emailDispatch";

const DEFAULT_FROM = "onboarding@resend.dev";

function formatAmount(amount: number) {
  return Number(amount || 0).toLocaleString("en-JM", {
    style: "currency",
    currency: "JMD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateOnly(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-JM");
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-JM");
}

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  dispatch: EmailDispatchContext;
};

type SendEmailResult = SendTrackedEmailResult;

async function sendResendEmail({
  to,
  subject,
  html,
  replyTo,
  attachments,
  dispatch,
}: SendEmailInput & { attachments?: EmailDispatchAttachment[] }): Promise<SendEmailResult> {
  return sendTrackedResendEmail({
    to,
    subject,
    html,
    replyTo,
    attachments,
    dispatch,
  });
}

function baseUrl() {
  return process.env.SITE_URL ?? "http://localhost:3000";
}

type PublicBookingEmailLinkTarget = "view" | "pay" | "balance" | "invoice";

async function buildPublicBookingEmailLink(
  bookingId: string,
  target: PublicBookingEmailLinkTarget = "view",
) {
  const normalizedBookingId = normalizeText(bookingId);
  const pathMap: Record<PublicBookingEmailLinkTarget, string> = {
    view: `/bookings/${normalizedBookingId}`,
    pay: `/bookings/${normalizedBookingId}/pay`,
    balance: `/bookings/${normalizedBookingId}/balance`,
    invoice: `/bookings/${normalizedBookingId}/invoice`,
  };

  if (!normalizedBookingId) {
    return `${baseUrl()}${pathMap[target]}`;
  }

  try {
    const result = await dbQuery<{ pricing_json: Record<string, unknown> | null }>(
      "select pricing_json from bookings where id = $1 limit 1",
      [normalizedBookingId],
    );
    const accessHash = readBookingAccessHash(result.rows[0]?.pricing_json);
    const signature = createBookingEmailAccessSignature(normalizedBookingId, accessHash);
    if (!accessHash || !signature) {
      return `${baseUrl()}${pathMap[target]}`;
    }

    const params = new URLSearchParams({
      target,
      sig: signature,
    });
    return `${baseUrl()}/bookings/${normalizedBookingId}/access?${params.toString()}`;
  } catch (error) {
    logWarn("public_booking_email_link_build_failed", {
      bookingId: normalizedBookingId,
      target,
      error: error instanceof Error ? error.message : String(error),
    });
    return `${baseUrl()}${pathMap[target]}`;
  }
}

function policyHtml(options?: { includeAvailabilityNote?: boolean }) {
  const includeAvailabilityNote = options?.includeAvailabilityNote ?? true;
  const noteItems = [
    includeAvailabilityNote
      ? "<li>Please note vehicle availability is not guaranteed without payment. To guarantee availability a deposit is required.</li>"
      : "",
    "<li>Please bring a valid driver’s license and the booking reference.</li>",
    "<li>Cancellations within 24 hours of pickup may be non-refundable.</li>",
  ]
    .filter(Boolean)
    .join("");

  return `
    <div style="margin-top:16px; font-size:12px; color:#64748b;">
      <p style="font-weight:600; color:#0f172a; margin-bottom:6px;">Payment & pickup notes</p>
      <ul style="margin:0; padding-left:18px;">${noteItems}</ul>
    </div>
  `;
}

const PAYMENT_STATUS_REDUCES_BALANCE = new Set([
  "SUCCESS",
  "SUCCEEDED",
  "COMPLETED",
  "DEPOSIT_PAID",
  "PAID",
  "CAPTURED",
  "SETTLED",
  "AUTHORIZED",
  "AUTHORISED",
]);

type InvoiceContextRow = {
  public_id: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  pricing_json: Record<string, unknown> | null;
  customer_address: string | null;
  customer_street: string | null;
  customer_street2: string | null;
  customer_city: string | null;
  customer_state: string | null;
  customer_country: string | null;
};

type InvoiceNumberRow = {
  invoice_number: string;
};

type BookingReferenceRow = {
  id: string;
  public_id: string | null;
};

type InvoicePaymentContextRow = {
  provider: string;
  status: string;
  deposit_amount_cents: number;
  created_at: string | Date;
  metadata_json: Record<string, unknown> | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function fallbackBookingReference(bookingId: string) {
  return bookingId.slice(0, 8);
}

async function resolveBookingReferences(bookingIds: string[]) {
  const uniqueIds = Array.from(
    new Set(
      bookingIds
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );
  const references = new Map<string, string>();

  if (uniqueIds.length === 0) {
    return references;
  }

  try {
    const result = await dbQuery<BookingReferenceRow>(
      "select id, public_id from bookings where id = any($1::uuid[])",
      [uniqueIds],
    );

    for (const row of result.rows) {
      references.set(row.id, normalizeText(row.public_id) || fallbackBookingReference(row.id));
    }
  } catch (error) {
    logWarn("booking_reference_lookup_failed", {
      bookingIds: uniqueIds,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  for (const bookingId of uniqueIds) {
    if (!references.has(bookingId)) {
      references.set(bookingId, fallbackBookingReference(bookingId));
    }
  }

  return references;
}

async function resolveBookingReference(bookingId: string) {
  return (await resolveBookingReferences([bookingId])).get(bookingId) || fallbackBookingReference(bookingId);
}

function readMoneyFromPricing(
  pricing: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (!pricing) return null;
  for (const key of keys) {
    const raw = pricing[key];
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return Math.max(0, value);
    }
  }
  return null;
}

function buildCustomerAddress(row: InvoiceContextRow | null) {
  if (!row) return "";
  const direct = normalizeText(row.customer_address);
  if (direct) return direct;
  const addressFields = resolveStoredRegionCountry(row.customer_state, row.customer_country);
  const parts = [
    normalizeText(row.customer_street),
    normalizeText(row.customer_street2),
    normalizeText(row.customer_city),
    normalizeText(addressFields.region),
    normalizeText(addressFields.country),
  ].filter(Boolean);
  return parts.join(", ");
}

function resolveProviderLabel(row: InvoicePaymentContextRow) {
  if (row.provider !== "MANUAL") return row.provider;
  const methodLabel =
    typeof row.metadata_json?.method_label === "string" ? row.metadata_json.method_label : null;
  if (methodLabel && methodLabel.trim()) return methodLabel.trim();
  const method = typeof row.metadata_json?.method === "string" ? row.metadata_json.method : null;
  if (method && method.trim()) return method.trim();
  return "MANUAL";
}

function toIsoDateOnly(value: string | Date | null | undefined) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  if (!text) return "";
  const dateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch?.[1]) return dateMatch[1];
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function isBalanceReducingPayment(row: InvoicePaymentContextRow) {
  const amount = Number(row.deposit_amount_cents || 0);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const normalized = String(row.status ?? "")
    .trim()
    .toUpperCase();
  return PAYMENT_STATUS_REDUCES_BALANCE.has(normalized);
}

async function allocateInvoiceNumber() {
  const result = await dbQuery<InvoiceNumberRow>(
    "select ('IV' || lpad(nextval('invoice_number_seq')::text, 6, '0')) as invoice_number",
  );
  const value = normalizeText(result.rows[0]?.invoice_number);
  if (!value) {
    throw new Error("Failed to allocate invoice number");
  }
  return value;
}

async function loadInvoiceContext(bookingId: string) {
  const contextResult = await (async () => {
    try {
      return await dbQuery<InvoiceContextRow>(
        "select b.public_id, b.pickup_location, b.dropoff_location, b.pricing_json, c.address as customer_address, c.street as customer_street, c.street2 as customer_street2, c.city as customer_city, c.state as customer_state, c.country as customer_country from bookings b join customers c on c.id = b.customer_id where b.id = $1",
        [bookingId],
      );
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "42703") {
        return await dbQuery<InvoiceContextRow>(
          "select b.public_id, b.pickup_location, b.dropoff_location, b.pricing_json, c.address as customer_address, null::text as customer_street, null::text as customer_street2, null::text as customer_city, null::text as customer_state, null::text as customer_country from bookings b join customers c on c.id = b.customer_id where b.id = $1",
          [bookingId],
        );
      }
      throw error;
    }
  })();

  const bookingRow = contextResult.rows[0] ?? null;
  const pricing =
    bookingRow?.pricing_json && typeof bookingRow.pricing_json === "object"
      ? (bookingRow.pricing_json as Record<string, unknown>)
      : null;
  const { promoCode, promoDiscount } = readPromoPricingFields(pricing);
  const { insuranceTotal } = readInsurancePricingFields(pricing);
  const subtotalAmount = readMoneyFromPricing(pricing, ["subtotal_cents"]);
  const totalAmount = readMoneyFromPricing(pricing, ["total_cents", "total_amount", "amount_due_cents"]);
  const depositAmount = readMoneyFromPricing(pricing, ["deposit_cents"]);
  const paidToDateAmount = readMoneyFromPricing(pricing, ["paid_to_date", "amount_paid"]);
  const balanceDueAmount = readMoneyFromPricing(pricing, ["balance_due"]);
  const customerAddress = buildCustomerAddress(bookingRow);
  const bookingPublicId = normalizeText(bookingRow?.public_id);
  const bookingLocationDetails = readBookingLocationDetails(pricing, {
    pickupLabel: normalizeText(bookingRow?.pickup_location),
    dropoffLabel: normalizeText(bookingRow?.dropoff_location),
  });
  const pickupLocationDisplay =
    formatBookingLocationDisplayText(bookingLocationDetails.pickup) ||
    normalizeText(bookingRow?.pickup_location);
  const dropoffLocationDisplay =
    formatBookingLocationDisplayText(bookingLocationDetails.dropoff) ||
    normalizeText(bookingRow?.dropoff_location) ||
    pickupLocationDisplay;

  const paymentsResult = await (async () => {
    try {
      return await dbQuery<InvoicePaymentContextRow>(
        "select provider, status, deposit_amount_cents, created_at, metadata_json from payments where booking_id = $1 and deleted_at is null order by created_at asc",
        [bookingId],
      );
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const message = String((error as { message?: unknown } | null)?.message ?? "");
      if (code === "42703" && message.includes("\"deleted_at\"") && message.includes("does not exist")) {
        return await dbQuery<InvoicePaymentContextRow>(
          "select provider, status, deposit_amount_cents, created_at, metadata_json from payments where booking_id = $1 order by created_at asc",
          [bookingId],
        );
      }
      throw error;
    }
  })();

  const payments = paymentsResult.rows
    .filter(isBalanceReducingPayment)
    .map((row: InvoicePaymentContextRow) => ({
      provider: resolveProviderLabel(row),
      status: formatPaymentStatus(row.status, {
        paymentType:
          typeof row.metadata_json?.payment_type === "string"
            ? String(row.metadata_json.payment_type)
            : null,
      }),
      amount: Number(row.deposit_amount_cents || 0),
      date: toIsoDateOnly(row.created_at),
    }));

  return {
    bookingPublicId,
    customerAddress,
    promoCode: promoCode || null,
    promoDiscount: Math.max(0, Number(promoDiscount || 0)),
    insuranceTotal: Math.max(0, Number(insuranceTotal || 0)),
    subtotalAmount,
    totalAmount,
    depositAmount,
    paidToDateAmount,
    balanceDueAmount,
    pickupLocationDisplay,
    dropoffLocationDisplay,
    payments,
  };
}

async function buildInvoiceAttachment(input: {
  bookingId: string;
  bookingPublicId?: string | null;
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
  insuranceTotal?: number;
  promoCode?: string | null;
  promoDiscount?: number;
  total: number;
  paidToDate: number;
  balanceDue: number;
  payments: { provider: string; status: string; amount: number; date: string }[];
}) {
  try {
    const context = await loadInvoiceContext(input.bookingId);
    const invoiceNumber = normalizeText(input.invoiceNumber) || (await allocateInvoiceNumber());
    const displayBookingId =
      normalizeText(input.bookingPublicId) || context.bookingPublicId || fallbackBookingReference(input.bookingId);
    const address = normalizeText(input.customerAddress) || context.customerAddress;
    const pickupLocation = normalizeText(context.pickupLocationDisplay) || normalizeText(input.pickupLocation);
    const payments = input.payments.length ? input.payments : context.payments;
    const promoCode = normalizeText(input.promoCode) || context.promoCode || null;
    const promoDiscountInput = Number(input.promoDiscount);
    const promoDiscount = Number.isFinite(promoDiscountInput)
      ? Math.max(0, promoDiscountInput)
      : context.promoDiscount;
    const insuranceTotalInput = Number(input.insuranceTotal);
    const insuranceTotal = Number.isFinite(insuranceTotalInput)
      ? Math.max(0, insuranceTotalInput)
      : context.insuranceTotal;
    const inputTotalAfterDiscount = Number.isFinite(Number(input.total))
      ? Math.max(0, Number(input.total))
      : 0;
    const subtotalAmount =
      context.subtotalAmount ??
      (context.totalAmount !== null ? Math.max(0, context.totalAmount + promoDiscount) : inputTotalAfterDiscount + promoDiscount);
    const depositInput = Number(input.deposit);
    const depositAmount = Number.isFinite(depositInput)
      ? Math.max(0, depositInput)
      : (context.depositAmount ?? 0);
    const paidToDateInput = Number(input.paidToDate);
    const paidToDate = Number.isFinite(paidToDateInput)
      ? Math.max(0, paidToDateInput)
      : (context.paidToDateAmount ?? 0);
    const totalAfterDiscount = Math.max(0, subtotalAmount - promoDiscount);
    const balanceDue = Math.max(0, totalAfterDiscount - paidToDate);
    const baseTotalAmount = Math.max(0, subtotalAmount - insuranceTotal);

    const payload = buildInvoicePayload({
      ...input,
      bookingId: input.bookingId,
      bookingPublicId: displayBookingId,
      invoiceNumber,
      pickupLocation,
      customerAddress: address,
      baseTotal: baseTotalAmount,
      total: subtotalAmount,
      deposit: depositAmount,
      paidToDate,
      balanceDue,
      insuranceTotal,
      promoCode,
      promoDiscount,
      payments,
    });
    const pdf = await generateInvoicePdf(payload, input.bookingId);
    if (!pdf?.downloadUrl) {
      logWarn("invoice_pdf_download_url_unavailable", {
        bookingId: input.bookingId,
        provider: pdf?.provider ?? null,
        providerStatus: pdf?.providerStatus ?? null,
        documentId: pdf?.documentId ?? null,
      });
      return undefined;
    }
    const base64 = await downloadPdfBase64(pdf.downloadUrl);
    return [{ filename: `invoice-${invoiceNumber}.pdf`, content: base64 }];
  } catch (error) {
    logError("invoice_pdf_generation_failed", error, { bookingId: input.bookingId });
    return undefined;
  }
}

type InvoiceAttachmentInput = Parameters<typeof buildInvoiceAttachment>[0];

async function buildRentalAgreementAttachment(input: {
  bookingId: string;
  bookingPublicId?: string | null;
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
}) {
  try {
    const agreement = await loadBookingRentalAgreementPayload(input.bookingId);
    if (!agreement) return undefined;
    const pdf = await generateRentalAgreementPdf(agreement.payload);
    if (!pdf?.downloadUrl) {
      logWarn("rental_agreement_pdf_download_url_unavailable", {
        bookingId: input.bookingId,
        provider: pdf?.provider ?? null,
        providerStatus: pdf?.providerStatus ?? null,
        documentId: pdf?.documentId ?? null,
      });
      return undefined;
    }
    const base64 = await downloadPdfBase64(pdf.downloadUrl);
    return [{ filename: `rental-agreement-${agreement.bookingPublicId}.pdf`, content: base64 }];
  } catch (error) {
    logError("rental_agreement_pdf_generation_failed", error, { bookingId: input.bookingId });
    return undefined;
  }
}

type RentalAgreementAttachmentInput = Parameters<typeof buildRentalAgreementAttachment>[0];

async function buildOptionalInvoiceEmailAttachment(
  input: InvoiceAttachmentInput,
  emailType: string,
) {
  const attachments = await buildInvoiceAttachment(input);
  if (attachments && attachments.length > 0) {
    return {
      attachments,
      noticeHtml:
        '<p style="font-size:12px; color:#64748b;">The attached invoice includes your live payment ledger.</p>',
    };
  }

  logWarn("invoice_email_attachment_unavailable", {
    bookingId: input.bookingId,
    emailType,
  });

  return {
    attachments: undefined,
    noticeHtml:
      '<p style="font-size:12px; color:#64748b;">Your invoice attachment is temporarily unavailable, but your booking and payment details are still available online.</p>',
  };
}

async function buildOptionalRentalAgreementEmailAttachment(
  input: RentalAgreementAttachmentInput,
  emailType: string,
) {
  const attachments = await buildRentalAgreementAttachment(input);
  if (attachments && attachments.length > 0) {
    return {
      attachments,
      noticeHtml:
        '<p style="font-size:12px; color:#64748b;">The attached rental agreement includes your booking terms.</p>',
    };
  }

  logWarn("rental_agreement_email_attachment_unavailable", {
    bookingId: input.bookingId,
    emailType,
  });

  return {
    attachments: undefined,
    noticeHtml:
      '<p style="font-size:12px; color:#64748b;">Your rental agreement attachment is temporarily unavailable, but your booking details are still available online.</p>',
  };
}

type EmailFinancialSummary = {
  bookingReference: string;
  promoCode: string | null;
  promoDiscount: number;
  insuranceTotal: number;
  subtotal: number;
  baseTotal: number;
  totalAfterDiscount: number;
  depositRequired: number;
  paidToDate: number;
  balanceDue: number;
  pickupLocationDisplay: string;
  dropoffLocationDisplay: string;
};

type EmailFinancialSummaryInput = {
  bookingId: string;
  total?: number;
  deposit?: number;
  paidToDate?: number;
  balanceDue?: number;
  promoCode?: string | null;
  promoDiscount?: number;
  insuranceTotal?: number;
};

type EmailDispatchOverrides = Partial<Omit<EmailDispatchContext, "emailType">> & {
  metadata?: Record<string, unknown> | null;
};

function withDispatchContext(
  defaults: EmailDispatchContext,
  overrides?: EmailDispatchOverrides,
): EmailDispatchContext {
  return {
    ...defaults,
    ...overrides,
    metadata: {
      ...defaults.metadata,
      ...(overrides?.metadata ?? {}),
    },
  };
}

function readOptionalMoney(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.max(0, amount);
}

async function resolveEmailFinancialSummary(
  input: EmailFinancialSummaryInput,
): Promise<EmailFinancialSummary> {
  const context = await loadInvoiceContext(input.bookingId).catch(() => null);
  const bookingReference =
    normalizeText(context?.bookingPublicId) || fallbackBookingReference(input.bookingId);
  const promoCode = normalizeText(input.promoCode) || context?.promoCode || null;
  const promoDiscount =
    readOptionalMoney(input.promoDiscount) ?? context?.promoDiscount ?? 0;
  const insuranceTotal =
    readOptionalMoney(input.insuranceTotal) ?? context?.insuranceTotal ?? 0;
  const totalAfterDiscountInput = readOptionalMoney(input.total);
  const subtotal =
    context?.subtotalAmount ??
    (totalAfterDiscountInput !== null ? totalAfterDiscountInput + promoDiscount : 0);
  const totalAfterDiscount =
    totalAfterDiscountInput ?? Math.max(0, subtotal - promoDiscount);
  const depositRequired =
    readOptionalMoney(input.deposit) ?? context?.depositAmount ?? 0;
  const paidToDate =
    readOptionalMoney(input.paidToDate) ?? context?.paidToDateAmount ?? 0;
  const balanceDue =
    readOptionalMoney(input.balanceDue) ??
    context?.balanceDueAmount ??
    Math.max(0, totalAfterDiscount - paidToDate);
  const baseTotal = Math.max(0, subtotal - insuranceTotal);
  const pickupLocationDisplay = context?.pickupLocationDisplay || "";
  const dropoffLocationDisplay = context?.dropoffLocationDisplay || pickupLocationDisplay;

  return {
    bookingReference,
    promoCode,
    promoDiscount,
    insuranceTotal,
    subtotal,
    baseTotal,
    totalAfterDiscount,
    depositRequired,
    paidToDate,
    balanceDue,
    pickupLocationDisplay,
    dropoffLocationDisplay,
  };
}

function renderEmailLocationSection(input: {
  pickupLocation: string;
  dropoffLocation?: string | null;
}) {
  const pickupLocation = normalizeText(input.pickupLocation);
  const dropoffLocation = normalizeText(input.dropoffLocation);
  const lines = [`<p><strong>Pickup location:</strong> ${pickupLocation || "Not specified"}</p>`];
  if (dropoffLocation && dropoffLocation !== pickupLocation) {
    lines.push(`<p><strong>Dropoff location:</strong> ${dropoffLocation}</p>`);
  }
  return lines.join("\n");
}

function renderEmailChargeSummary(
  summary: EmailFinancialSummary,
  options: {
    depositLabel: string;
    balanceLabel: string;
  },
) {
  return `
      <p><strong>Rental subtotal:</strong> ${formatAmount(summary.baseTotal)}</p>
      ${
        summary.insuranceTotal > 0
          ? `<p><strong>Insurance total:</strong> ${formatAmount(summary.insuranceTotal)}</p>`
          : ""
      }
      ${
        summary.promoDiscount > 0
          ? `<p><strong>Promo${summary.promoCode ? ` (${summary.promoCode})` : ""}:</strong> -${formatAmount(summary.promoDiscount)}</p>`
          : ""
      }
      <p><strong>${options.depositLabel}:</strong> ${formatAmount(summary.depositRequired)}</p>
      <p><strong>Paid to date:</strong> ${formatAmount(summary.paidToDate)}</p>
      <p><strong>Total of booking:</strong> ${formatAmount(summary.totalAfterDiscount)}</p>
      <p><strong>${options.balanceLabel}:</strong> ${formatAmount(summary.balanceDue)}</p>
  `;
}

function renderPrimaryEmailButton(label: string, href: string, options?: { accent?: "primary" | "secondary" }) {
  const accent = options?.accent ?? "primary";
  const style =
    accent === "primary"
      ? "background:#1f2d4d; color:#fff; border:1px solid #1f2d4d;"
      : "background:#f8fafc; color:#1f2d4d; border:1px solid #cbd5e1;";
  return `<a href="${href}" style="display:inline-block; ${style} padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600;">${label}</a>`;
}

export async function sendBookingCreatedEmail(input: {
  bookingId: string;
  customerEmail: string;
  customerName: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  dailyRate: number;
  deposit: number;
  promoCode?: string | null;
  promoDiscount?: number;
  dispatch?: EmailDispatchOverrides;
}): Promise<SendEmailResult> {
  const days = Math.max(1, calcDaysInclusive(input.startDate, input.endDate));
  const summary = await resolveEmailFinancialSummary({
    bookingId: input.bookingId,
    deposit: input.deposit,
    promoCode: input.promoCode ?? null,
    promoDiscount: input.promoDiscount ?? 0,
    paidToDate: 0,
  });
  const bookingLink = await buildPublicBookingEmailLink(input.bookingId, "pay");
  const paymentStatusLabel = summary.balanceDue > 0 ? "Payment incomplete" : "Paid in full";
  const pickupLocationDisplay = summary.pickupLocationDisplay || input.pickupLocation;
  const dropoffLocationDisplay = summary.dropoffLocationDisplay || input.pickupLocation;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Booking received</h2>
      <p>Hi ${input.customerName},</p>
      <p>Your booking request has been received. Please pay the deposit to confirm your reservation.</p>
      <p><strong>Booking reference:</strong> ${summary.bookingReference}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)} (${days} days)</p>
      ${renderEmailLocationSection({
        pickupLocation: pickupLocationDisplay,
        dropoffLocation: dropoffLocationDisplay,
      })}
      <hr />
      ${renderEmailChargeSummary(summary, { depositLabel: "Deposit online", balanceLabel: "Balance on pickup" })}
      <p><strong>Payment status:</strong> ${paymentStatusLabel}</p>
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">Pay Deposit</a>
      </p>
      <p style="font-size:12px; color:#64748b;">The attached rental agreement includes your booking terms.</p>
      ${policyHtml()}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  const agreementAttachment = await buildOptionalRentalAgreementEmailAttachment(
    {
      bookingId: input.bookingId,
      bookingPublicId: summary.bookingReference,
      bookingStatus: "PENDING_PAYMENT",
      startDate: input.startDate,
      endDate: input.endDate,
      pickupLocation: pickupLocationDisplay,
      returnLocation: dropoffLocationDisplay,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: "",
      vehicleMake: input.vehicleLabel,
      vehicleModel: "",
      vehicleYear: 0,
      dailyRate: input.dailyRate,
      total: summary.totalAfterDiscount,
      deposit: summary.depositRequired,
      paidToDate: summary.paidToDate,
      balanceDue: summary.balanceDue,
      paymentMethod: "Not specified",
    },
    "booking_created",
  );

  const htmlWithAttachmentNotice = html.replace(
    '<p style="font-size:12px; color:#64748b;">The attached rental agreement includes your booking terms.</p>',
    agreementAttachment.noticeHtml,
  );

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Your booking is ready — deposit required",
    html: htmlWithAttachmentNotice,
    attachments: agreementAttachment.attachments,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: summary.bookingReference,
        emailType: "booking_created",
        recipientName: input.customerName,
        triggerSource: "public_booking",
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference: summary.bookingReference,
          vehicleLabel: input.vehicleLabel,
        },
      },
      input.dispatch,
    ),
  });
}

export async function sendDepositReceiptEmail(input: {
  bookingId: string;
  customerEmail: string;
  customerName: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  dailyRate: number;
  deposit: number;
  paidToDate: number;
  promoCode?: string | null;
  promoDiscount?: number;
  dispatch?: EmailDispatchOverrides;
}): Promise<SendEmailResult> {
  const days = Math.max(1, calcDaysInclusive(input.startDate, input.endDate));
  const summary = await resolveEmailFinancialSummary({
    bookingId: input.bookingId,
    deposit: input.deposit,
    paidToDate: input.paidToDate,
    promoCode: input.promoCode ?? null,
    promoDiscount: input.promoDiscount ?? 0,
  });
  const bookingLink = await buildPublicBookingEmailLink(input.bookingId, "view");
  const invoiceLink = await buildPublicBookingEmailLink(input.bookingId, "invoice");
  const paymentStatusLabel = summary.balanceDue > 0 ? "Payment incomplete" : "Paid in full";
  const pickupLocationDisplay = summary.pickupLocationDisplay || input.pickupLocation;
  const dropoffLocationDisplay = summary.dropoffLocationDisplay || input.pickupLocation;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Deposit received</h2>
      <p>Hi ${input.customerName},</p>
      <p>Your deposit payment was received and your booking is confirmed.</p>
      <p><strong>Booking reference:</strong> ${summary.bookingReference}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)} (${days} days)</p>
      ${renderEmailLocationSection({
        pickupLocation: pickupLocationDisplay,
        dropoffLocation: dropoffLocationDisplay,
      })}
      <hr />
      ${renderEmailChargeSummary(summary, { depositLabel: "Deposit paid", balanceLabel: "Balance on pickup" })}
      <p><strong>Payment status:</strong> ${paymentStatusLabel}</p>
      <p style="margin-top: 16px;">
        ${renderPrimaryEmailButton("View Booking", bookingLink)}
        <span style="display:inline-block; width:12px;"></span>
        ${renderPrimaryEmailButton("View Invoice", invoiceLink, { accent: "secondary" })}
      </p>
      <p style="font-size:12px; color:#64748b;">The attached invoice includes your live payment ledger.</p>
      ${policyHtml({ includeAvailabilityNote: false })}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  const invoiceAttachment = await buildOptionalInvoiceEmailAttachment(
    {
      bookingId: input.bookingId,
      bookingPublicId: summary.bookingReference,
      bookingStatus: "CONFIRMED",
      startDate: input.startDate,
      endDate: input.endDate,
      pickupLocation: pickupLocationDisplay,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: "",
      vehicleMake: input.vehicleLabel,
      vehicleModel: "",
      vehicleYear: 0,
      dailyRate: input.dailyRate,
      deposit: summary.depositRequired,
      insuranceTotal: summary.insuranceTotal,
      promoCode: summary.promoCode,
      promoDiscount: summary.promoDiscount,
      total: summary.subtotal,
      paidToDate: summary.paidToDate,
      balanceDue: summary.balanceDue,
      payments: [],
    },
    "deposit_receipt",
  );

  const htmlWithAttachmentNotice = html.replace(
    '<p style="font-size:12px; color:#64748b;">The attached invoice includes your live payment ledger.</p>',
    invoiceAttachment.noticeHtml,
  );

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Deposit received — booking confirmed",
    html: htmlWithAttachmentNotice,
    attachments: invoiceAttachment.attachments,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: summary.bookingReference,
        emailType: "deposit_receipt",
        recipientName: input.customerName,
        triggerSource: "wipay_reconcile",
        relatedTransactionType: "payment",
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference: summary.bookingReference,
          vehicleLabel: input.vehicleLabel,
          paidToDate: summary.paidToDate,
        },
      },
      input.dispatch,
    ),
  });
}

export async function sendPaymentUpdateEmail(input: {
  bookingId: string;
  customerEmail: string;
  customerName: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  dailyRate: number;
  deposit: number;
  total: number;
  paidToDate: number;
  balanceDue: number;
  paymentAmount?: number;
  paymentMethod?: string;
  paymentDateTime?: string;
  paymentReference?: string;
  dispatch?: EmailDispatchOverrides;
}): Promise<SendEmailResult> {
  const bookingLink = await buildPublicBookingEmailLink(input.bookingId, "view");
  const invoiceLink = await buildPublicBookingEmailLink(input.bookingId, "invoice");
  const balanceLink = await buildPublicBookingEmailLink(input.bookingId, "balance");
  const summary = await resolveEmailFinancialSummary({
    bookingId: input.bookingId,
    total: input.total,
    deposit: input.deposit,
    paidToDate: input.paidToDate,
    balanceDue: input.balanceDue,
  });
  const paymentStatusLabel = summary.balanceDue > 0 ? "Payment incomplete" : "Paid in full";
  const pickupLocationDisplay = summary.pickupLocationDisplay || input.pickupLocation;
  const dropoffLocationDisplay = summary.dropoffLocationDisplay || input.pickupLocation;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Payment updated</h2>
      <p>Hi ${input.customerName},</p>
      <p>We have recorded a payment toward your booking.</p>
      ${
        input.paymentAmount || input.paymentMethod || input.paymentDateTime || input.paymentReference
          ? `
        <div style="margin-top:12px; padding:12px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc;">
          <p style="margin:0 0 6px; font-weight:600;">Payment details</p>
          ${input.paymentAmount ? `<p style="margin:0;"><strong>Amount:</strong> ${formatAmount(input.paymentAmount)}</p>` : ""}
          ${input.paymentMethod ? `<p style="margin:0;"><strong>Method:</strong> ${input.paymentMethod}</p>` : ""}
          ${input.paymentDateTime ? `<p style="margin:0;"><strong>Date/time:</strong> ${formatDateTime(input.paymentDateTime)}</p>` : ""}
          ${input.paymentReference ? `<p style="margin:0;"><strong>Reference:</strong> ${input.paymentReference}</p>` : ""}
        </div>
      `
          : ""
      }
      <p><strong>Booking reference:</strong> ${summary.bookingReference}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      ${renderEmailLocationSection({
        pickupLocation: pickupLocationDisplay,
        dropoffLocation: dropoffLocationDisplay,
      })}
      <hr />
      ${renderEmailChargeSummary(summary, {
        depositLabel: summary.paidToDate > 0 ? "Deposit paid" : "Deposit amount",
        balanceLabel: "Balance outstanding",
      })}
      <p><strong>Payment status:</strong> ${paymentStatusLabel}</p>
      <p style="margin-top: 16px;">
        ${renderPrimaryEmailButton("View Booking", bookingLink)}
        <span style="display:inline-block; width:12px;"></span>
        ${renderPrimaryEmailButton("Pay Balance", balanceLink, { accent: "secondary" })}
        <span style="display:inline-block; width:12px;"></span>
        ${renderPrimaryEmailButton("View Invoice", invoiceLink, { accent: "secondary" })}
      </p>
      <p style="font-size:12px; color:#64748b;">The attached invoice includes your live payment ledger.</p>
      ${policyHtml({ includeAvailabilityNote: false })}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  const invoiceAttachment = await buildOptionalInvoiceEmailAttachment(
    {
      bookingId: input.bookingId,
      bookingPublicId: summary.bookingReference,
      bookingStatus: "CONFIRMED",
      startDate: input.startDate,
      endDate: input.endDate,
      pickupLocation: pickupLocationDisplay,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: "",
      vehicleMake: input.vehicleLabel,
      vehicleModel: "",
      vehicleYear: 0,
      dailyRate: input.dailyRate,
      deposit: summary.depositRequired,
      insuranceTotal: summary.insuranceTotal,
      promoCode: summary.promoCode,
      promoDiscount: summary.promoDiscount,
      total: summary.subtotal,
      paidToDate: summary.paidToDate,
      balanceDue: summary.balanceDue,
      payments: [],
    },
    "payment_update",
  );

  const htmlWithAttachmentNotice = html.replace(
    '<p style="font-size:12px; color:#64748b;">The attached invoice includes your live payment ledger.</p>',
    invoiceAttachment.noticeHtml,
  );

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Payment update — balance outstanding",
    html: htmlWithAttachmentNotice,
    attachments: invoiceAttachment.attachments,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: summary.bookingReference,
        emailType: "payment_update",
        recipientName: input.customerName,
        triggerSource: "admin_payment",
        relatedTransactionType: "payment",
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference: summary.bookingReference,
          paymentReference: input.paymentReference ?? null,
          paymentMethod: input.paymentMethod ?? null,
          paymentAmount: input.paymentAmount ?? null,
          paymentDateTime: input.paymentDateTime ?? null,
        },
      },
      input.dispatch,
    ),
  });
}

export async function sendPaymentCompleteEmail(input: {
  bookingId: string;
  customerEmail: string;
  customerName: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  dailyRate: number;
  deposit: number;
  total: number;
  paidToDate: number;
  balanceDue: number;
  paymentAmount?: number;
  paymentMethod?: string;
  paymentDateTime?: string;
  paymentReference?: string;
  dispatch?: EmailDispatchOverrides;
}): Promise<SendEmailResult> {
  const bookingLink = await buildPublicBookingEmailLink(input.bookingId, "view");
  const invoiceLink = await buildPublicBookingEmailLink(input.bookingId, "invoice");
  const summary = await resolveEmailFinancialSummary({
    bookingId: input.bookingId,
    total: input.total,
    deposit: input.deposit,
    paidToDate: input.paidToDate,
    balanceDue: input.balanceDue,
  });
  const paymentStatusLabel = summary.balanceDue > 0 ? "Payment incomplete" : "Paid in full";
  const pickupLocationDisplay = summary.pickupLocationDisplay || input.pickupLocation;
  const dropoffLocationDisplay = summary.dropoffLocationDisplay || input.pickupLocation;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Payment complete</h2>
      <p>Hi ${input.customerName},</p>
      <p>Your booking is now paid in full. Thank you!</p>
      ${
        input.paymentAmount || input.paymentMethod || input.paymentDateTime || input.paymentReference
          ? `
        <div style="margin-top:12px; padding:12px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc;">
          <p style="margin:0 0 6px; font-weight:600;">Payment details</p>
          ${input.paymentAmount ? `<p style="margin:0;"><strong>Amount:</strong> ${formatAmount(input.paymentAmount)}</p>` : ""}
          ${input.paymentMethod ? `<p style="margin:0;"><strong>Method:</strong> ${input.paymentMethod}</p>` : ""}
          ${input.paymentDateTime ? `<p style="margin:0;"><strong>Date/time:</strong> ${formatDateTime(input.paymentDateTime)}</p>` : ""}
          ${input.paymentReference ? `<p style="margin:0;"><strong>Reference:</strong> ${input.paymentReference}</p>` : ""}
        </div>
      `
          : ""
      }
      <p><strong>Booking reference:</strong> ${summary.bookingReference}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      ${renderEmailLocationSection({
        pickupLocation: pickupLocationDisplay,
        dropoffLocation: dropoffLocationDisplay,
      })}
      <hr />
      ${renderEmailChargeSummary(summary, {
        depositLabel: summary.paidToDate > 0 ? "Deposit paid" : "Deposit amount",
        balanceLabel: "Balance outstanding",
      })}
      <p><strong>Payment status:</strong> ${paymentStatusLabel}</p>
      <p style="margin-top: 16px;">
        ${renderPrimaryEmailButton("View Booking", bookingLink)}
        <span style="display:inline-block; width:12px;"></span>
        ${renderPrimaryEmailButton("View Invoice", invoiceLink, { accent: "secondary" })}
      </p>
      <p style="font-size:12px; color:#64748b;">The attached invoice includes your live payment ledger.</p>
      ${policyHtml({ includeAvailabilityNote: false })}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  const invoiceAttachment = await buildOptionalInvoiceEmailAttachment(
    {
      bookingId: input.bookingId,
      bookingPublicId: summary.bookingReference,
      bookingStatus: "CONFIRMED",
      startDate: input.startDate,
      endDate: input.endDate,
      pickupLocation: pickupLocationDisplay,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: "",
      vehicleMake: input.vehicleLabel,
      vehicleModel: "",
      vehicleYear: 0,
      dailyRate: input.dailyRate,
      deposit: summary.depositRequired,
      insuranceTotal: summary.insuranceTotal,
      promoCode: summary.promoCode,
      promoDiscount: summary.promoDiscount,
      total: summary.subtotal,
      paidToDate: summary.paidToDate,
      balanceDue: summary.balanceDue,
      payments: [],
    },
    "payment_complete",
  );

  const htmlWithAttachmentNotice = html.replace(
    '<p style="font-size:12px; color:#64748b;">The attached invoice includes your live payment ledger.</p>',
    invoiceAttachment.noticeHtml,
  );

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Payment complete — booking paid in full",
    html: htmlWithAttachmentNotice,
    attachments: invoiceAttachment.attachments,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: summary.bookingReference,
        emailType: "payment_complete",
        recipientName: input.customerName,
        triggerSource: "wipay_reconcile",
        relatedTransactionType: "payment",
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference: summary.bookingReference,
          paymentReference: input.paymentReference ?? null,
          paymentMethod: input.paymentMethod ?? null,
          paymentAmount: input.paymentAmount ?? null,
          paymentDateTime: input.paymentDateTime ?? null,
        },
      },
      input.dispatch,
    ),
  });
}

export async function sendBalanceDueReminderEmail(input: {
  bookingId: string;
  customerEmail: string;
  customerName: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  balanceDue: number;
  dispatch?: EmailDispatchOverrides;
}) {
  const balanceLink = await buildPublicBookingEmailLink(input.bookingId, "balance");
  const bookingReference = await resolveBookingReference(input.bookingId);
  const summary = await resolveEmailFinancialSummary({
    bookingId: input.bookingId,
    balanceDue: input.balanceDue,
  });

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Balance due before pickup</h2>
      <p>Hi ${input.customerName},</p>
      <p>Your pickup date is today and a balance is still outstanding.</p>
      <p><strong>Booking reference:</strong> ${bookingReference}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      ${renderEmailLocationSection({
        pickupLocation: summary.pickupLocationDisplay || input.pickupLocation,
        dropoffLocation: summary.dropoffLocationDisplay || input.pickupLocation,
      })}
      <hr />
      <p><strong>Balance due:</strong> ${formatAmount(input.balanceDue)}</p>
      <p style="margin-top: 16px;">
        <a href="${balanceLink}" style="background:#e2a100; color:#111827; padding:10px 16px; border-radius:8px; text-decoration:none;">Pay Balance Now</a>
      </p>
      ${policyHtml()}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Balance required for pickup",
    html,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: bookingReference,
        emailType: "balance_due_reminder",
        recipientName: input.customerName,
        triggerSource: "cron",
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference,
          balanceDue: input.balanceDue,
        },
      },
      input.dispatch,
    ),
  });
}

export async function sendDropoffReminderEmail(input: {
  bookingId: string;
  customerEmail: string;
  customerName: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  balanceDue: number;
  dispatch?: EmailDispatchOverrides;
}) {
  const bookingLink = await buildPublicBookingEmailLink(input.bookingId, "view");
  const balanceLink = await buildPublicBookingEmailLink(input.bookingId, "balance");
  const bookingReference = await resolveBookingReference(input.bookingId);
  const summary = await resolveEmailFinancialSummary({
    bookingId: input.bookingId,
    balanceDue: input.balanceDue,
  });

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Dropoff reminder</h2>
      <p>Hi ${input.customerName},</p>
      <p>Today is your dropoff date and there is still a balance outstanding.</p>
      <p><strong>Booking reference:</strong> ${bookingReference}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      ${renderEmailLocationSection({
        pickupLocation: summary.pickupLocationDisplay || input.pickupLocation,
        dropoffLocation: summary.dropoffLocationDisplay || input.pickupLocation,
      })}
      <hr />
      <p><strong>Balance due:</strong> ${formatAmount(input.balanceDue)}</p>
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">View Booking</a>
        <a href="${balanceLink}" style="margin-left:12px; background:#e2a100; color:#111827; padding:10px 16px; border-radius:8px; text-decoration:none;">Pay Balance</a>
      </p>
      ${policyHtml()}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Dropoff day reminder — balance due",
    html,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: bookingReference,
        emailType: "dropoff_reminder",
        recipientName: input.customerName,
        triggerSource: "cron",
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference,
          balanceDue: input.balanceDue,
        },
      },
      input.dispatch,
    ),
  });
}

export async function sendLateDropoffAlertEmail(input: {
  bookingId: string;
  customerEmail: string;
  customerName: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  balanceDue: number;
  dispatch?: EmailDispatchOverrides;
}) {
  const bookingLink = await buildPublicBookingEmailLink(input.bookingId, "view");
  const balanceLink = await buildPublicBookingEmailLink(input.bookingId, "balance");
  const bookingReference = await resolveBookingReference(input.bookingId);
  const summary = await resolveEmailFinancialSummary({
    bookingId: input.bookingId,
    balanceDue: input.balanceDue,
  });

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Late dropoff notice</h2>
      <p>Hi ${input.customerName},</p>
      <p>Your scheduled dropoff date has passed and a balance is still outstanding.</p>
      <p><strong>Booking reference:</strong> ${bookingReference}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      ${renderEmailLocationSection({
        pickupLocation: summary.pickupLocationDisplay || input.pickupLocation,
        dropoffLocation: summary.dropoffLocationDisplay || input.pickupLocation,
      })}
      <hr />
      <p><strong>Balance due:</strong> ${formatAmount(input.balanceDue)}</p>
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">View Booking</a>
        <a href="${balanceLink}" style="margin-left:12px; background:#e2a100; color:#111827; padding:10px 16px; border-radius:8px; text-decoration:none;">Pay Balance</a>
      </p>
      ${policyHtml()}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Late dropoff alert — balance required",
    html,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: bookingReference,
        emailType: "late_dropoff_alert",
        recipientName: input.customerName,
        triggerSource: "cron",
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference,
          balanceDue: input.balanceDue,
        },
      },
      input.dispatch,
    ),
  });
}

export async function sendBookingCancelledByBlockoutEmail(input: {
  recipientType: "customer" | "internal";
  recipientEmail: string;
  bookingId: string;
  customerName: string;
  customerEmail: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  blockoutReason: string;
  blockoutStart: string;
  blockoutEnd: string;
  dispatch?: EmailDispatchOverrides;
}) {
  const isInternal = input.recipientType === "internal";
  const bookingLink = isInternal
    ? `${baseUrl()}/admin/bookings/${input.bookingId}`
    : await buildPublicBookingEmailLink(input.bookingId, "view");
  const bookingReference = await resolveBookingReference(input.bookingId);
  const greeting = isInternal ? "Operations update" : `Hi ${input.customerName},`;
  const intro = isInternal
    ? "A booking was cancelled automatically because a vehicle blockout now supersedes it."
    : "Your booking was cancelled because the vehicle became unavailable during your selected dates.";
  const reasonLabel = input.blockoutReason || "Unavailable";

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>${isInternal ? "[Internal] Booking cancelled by blockout" : "Booking cancellation notice"}</h2>
      <p>${greeting}</p>
      <p>${intro}</p>
      <p><strong>Booking reference:</strong> ${bookingReference}</p>
      <p><strong>Customer:</strong> ${input.customerName} (${input.customerEmail})</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
      <hr />
      <p><strong>Blockout reason:</strong> ${reasonLabel}</p>
      <p><strong>Blockout window:</strong> ${formatDateTime(input.blockoutStart)} → ${formatDateTime(input.blockoutEnd)}</p>
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">${
          isInternal ? "Open Booking" : "View Booking"
        }</a>
      </p>
      ${isInternal ? "" : policyHtml()}
      <p style="font-size:12px; color:#64748b;">${isInternal ? "This is an internal operations alert." : "Need help? Reply to this email."}</p>
    </div>
  `;

  return sendResendEmail({
    to: input.recipientEmail,
    subject: isInternal
      ? `[Internal] Blockout cancellation — ${bookingReference}`
      : "Booking cancelled due to vehicle unavailability",
    html,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: bookingReference,
        emailType: "booking_cancelled_by_blockout",
        recipientName: input.recipientType === "customer" ? input.customerName : null,
        triggerSource: "admin_booking",
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference,
          recipientType: input.recipientType,
          blockoutReason: input.blockoutReason,
          blockoutStart: input.blockoutStart,
          blockoutEnd: input.blockoutEnd,
        },
      },
      input.dispatch,
    ),
  });
}

export async function sendBookingOverriddenByPaidBookingEmail(input: {
  recipientType: "customer" | "internal";
  recipientEmail: string;
  bookingId: string;
  customerName: string;
  customerEmail: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  overriddenByBookingId: string;
  dispatch?: EmailDispatchOverrides;
}) {
  const isInternal = input.recipientType === "internal";
  const bookingReferences = await resolveBookingReferences([
    input.bookingId,
    input.overriddenByBookingId,
  ]);
  const bookingReference =
    bookingReferences.get(input.bookingId) || fallbackBookingReference(input.bookingId);
  const overriddenByBookingReference =
    bookingReferences.get(input.overriddenByBookingId) ||
    fallbackBookingReference(input.overriddenByBookingId);
  const bookingLink = isInternal
    ? `${baseUrl()}/admin/bookings/${input.bookingId}`
    : await buildPublicBookingEmailLink(input.bookingId, "view");
  const overridingBookingLink = `${baseUrl()}/admin/bookings/${input.overriddenByBookingId}`;

  const greeting = isInternal ? "Operations update" : `Hi ${input.customerName},`;
  const intro = isInternal
    ? "A non-blocking booking was automatically cancelled because another booking for the same vehicle and dates became paid."
    : "Your unpaid booking was cancelled because another customer completed payment for the same vehicle and dates.";

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>${isInternal ? "[Internal] Booking overridden by paid booking" : "Booking cancellation notice"}</h2>
      <p>${greeting}</p>
      <p>${intro}</p>
      <p><strong>Booking reference:</strong> ${bookingReference}</p>
      <p><strong>Customer:</strong> ${input.customerName} (${input.customerEmail})</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
      <hr />
      ${
        isInternal
          ? `<p><strong>Overridden by booking:</strong> ${overriddenByBookingReference}</p>`
          : ""
      }
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">${
          isInternal ? "Open Overridden Booking" : "View Booking"
        }</a>
        ${
          isInternal
            ? `<a href="${overridingBookingLink}" style="margin-left:12px; color:#1f2d4d; text-decoration:underline;">Open Paid Booking</a>`
            : ""
        }
      </p>
      ${isInternal ? "" : policyHtml()}
      <p style="font-size:12px; color:#64748b;">${isInternal ? "This is an internal operations alert." : "Need help? Reply to this email."}</p>
    </div>
  `;

  return sendResendEmail({
    to: input.recipientEmail,
    subject: isInternal
      ? `[Internal] Booking overridden — ${bookingReference}`
      : "Booking cancelled — vehicle reserved by another paid booking",
    html,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: bookingReference,
        emailType: "booking_overridden_by_paid_booking",
        recipientName: input.recipientType === "customer" ? input.customerName : null,
        triggerSource: "wipay_reconcile",
        relatedTransactionType: "booking",
        relatedTransactionId: input.overriddenByBookingId,
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference,
          recipientType: input.recipientType,
          overriddenByBookingId: input.overriddenByBookingId,
          overriddenByBookingReference,
        },
      },
      input.dispatch,
    ),
  });
}

export function getInternalNotesRecipient() {
  return (
    process.env.INTERNAL_NOTES_EMAIL?.trim() ||
    process.env.RESEND_FROM?.trim() ||
    DEFAULT_FROM
  );
}

export async function sendOperationalAlertEmail(input: {
  recipientEmails: string[];
  subject: string;
  html: string;
  replyTo?: string;
  dispatch?: EmailDispatchOverrides;
}) {
  if (!Array.isArray(input.recipientEmails) || input.recipientEmails.length === 0) {
    return {
      ok: false,
      skipped: true,
      error: "No recipients configured",
      providerMessageId: null,
    } as const;
  }

  const recipients = input.recipientEmails.map((entry) => entry.trim()).filter(Boolean);
  let delivered = 0;
  let firstError = "";

  for (const recipient of recipients) {
    const result = await sendResendEmail({
      to: recipient,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo,
      dispatch: withDispatchContext(
        {
          entityType: "system",
          entityId: null,
          entityPublicId: null,
          emailType: "operational_alert",
          triggerSource: "system",
          manualResendAllowed: true,
          metadata: {
            html: input.html,
            replyTo: input.replyTo ?? null,
          },
        },
        input.dispatch,
      ),
    });

    if (result.ok) {
      delivered += 1;
    } else if (!firstError) {
      firstError = result.error ?? "Delivery failed";
    }
  }

  if (delivered > 0) {
    return { ok: true } satisfies SendEmailResult;
  }

  return {
    ok: false,
    error: firstError || "Delivery failed",
  } satisfies SendEmailResult;
}

export async function sendBookingNoteEmail(input: {
  bookingId: string;
  recipientEmail: string;
  recipientType: "customer" | "internal";
  customerName: string;
  customerEmail: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  noteMessage: string;
  sentByUserId?: string;
  scheduledFor?: string | null;
  dispatch?: EmailDispatchOverrides;
}) {
  const bookingLink = `${baseUrl()}/admin/bookings/${input.bookingId}`;
  const notePrefix = input.recipientType === "internal" ? "[Internal] " : "";
  const bookingReference = await resolveBookingReference(input.bookingId);
  const scheduleLine = input.scheduledFor
    ? `<p><strong>Scheduled send:</strong> ${formatDateTime(input.scheduledFor)}</p>`
    : "";

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>${notePrefix}Booking note update</h2>
      <p><strong>Booking reference:</strong> ${bookingReference}</p>
      <p><strong>Customer:</strong> ${input.customerName} (${input.customerEmail})</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
      ${scheduleLine}
      <div style="margin-top:12px; padding:12px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc;">
        <p style="margin:0 0 6px; font-weight:600;">Note</p>
        <p style="margin:0; white-space:pre-wrap;">${input.noteMessage}</p>
      </div>
      ${
        input.sentByUserId
          ? `<p style="margin-top:10px;"><strong>Recorded by user ID:</strong> ${input.sentByUserId}</p>`
          : ""
      }
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">View Booking</a>
      </p>
      <p style="font-size:12px; color:#64748b;">This is an operational update from Curated Car Rentals.</p>
    </div>
  `;

  return sendResendEmail({
    to: input.recipientEmail,
    subject: `${notePrefix}Booking note — ${bookingReference}`,
    html,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: bookingReference,
        emailType: "booking_note",
        recipientName: input.recipientType === "customer" ? input.customerName : null,
        triggeredByUserId: input.sentByUserId ?? null,
        triggerSource: input.scheduledFor ? "cron" : "admin_booking",
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference,
          recipientType: input.recipientType,
          scheduledFor: input.scheduledFor ?? null,
          noteMessage: input.noteMessage,
        },
      },
      input.dispatch,
    ),
  });
}

export async function sendPickupReminderEmail(input: {
  bookingId: string;
  customerEmail: string;
  customerName: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  balanceDue: number;
  dispatch?: EmailDispatchOverrides;
}) {
  const bookingLink = await buildPublicBookingEmailLink(input.bookingId, "view");
  const balanceLink = await buildPublicBookingEmailLink(input.bookingId, "balance");
  const bookingReference = await resolveBookingReference(input.bookingId);
  const summary = await resolveEmailFinancialSummary({
    bookingId: input.bookingId,
    balanceDue: input.balanceDue,
  });

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Pickup reminder</h2>
      <p>Hi ${input.customerName},</p>
      <p>This is a reminder for your upcoming pickup.</p>
      <p><strong>Booking reference:</strong> ${bookingReference}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      ${renderEmailLocationSection({
        pickupLocation: summary.pickupLocationDisplay || input.pickupLocation,
        dropoffLocation: summary.dropoffLocationDisplay || input.pickupLocation,
      })}
      <hr />
      <p><strong>Outstanding balance:</strong> ${formatAmount(input.balanceDue)}</p>
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">View Booking</a>
        <a href="${balanceLink}" style="margin-left:12px; background:#e2a100; color:#111827; padding:10px 16px; border-radius:8px; text-decoration:none;">Pay Balance</a>
      </p>
      ${policyHtml()}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Pickup reminder — balance due",
    html,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: bookingReference,
        emailType: "pickup_reminder",
        recipientName: input.customerName,
        triggerSource: "cron",
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference,
          balanceDue: input.balanceDue,
        },
      },
      input.dispatch,
    ),
  });
}

export async function sendPickupConfirmedEmail(input: {
  bookingId: string;
  customerEmail: string;
  customerName: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  paidToDate: number;
  balanceDue: number;
  dispatch?: EmailDispatchOverrides;
}) {
  const bookingLink = await buildPublicBookingEmailLink(input.bookingId, "view");
  const bookingReference = await resolveBookingReference(input.bookingId);
  const summary = await resolveEmailFinancialSummary({
    bookingId: input.bookingId,
    paidToDate: input.paidToDate,
    balanceDue: input.balanceDue,
  });

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Pickup confirmed</h2>
      <p>Hi ${input.customerName},</p>
      <p>Your pickup has been confirmed and your rental agreement is attached.</p>
      <p><strong>Booking reference:</strong> ${bookingReference}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      ${renderEmailLocationSection({
        pickupLocation: summary.pickupLocationDisplay || input.pickupLocation,
        dropoffLocation: summary.dropoffLocationDisplay || input.pickupLocation,
      })}
      <hr />
      <p><strong>Paid to date:</strong> ${formatAmount(summary.paidToDate)}</p>
      <p><strong>Balance outstanding:</strong> ${formatAmount(summary.balanceDue)}</p>
      <p style="margin-top: 16px;">
        ${renderPrimaryEmailButton("View Booking", bookingLink)}
      </p>
      <p style="font-size:12px; color:#64748b;">The attached rental agreement includes your booking terms.</p>
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  const agreementAttachment = await buildOptionalRentalAgreementEmailAttachment(
    {
      bookingId: input.bookingId,
      bookingPublicId: bookingReference,
      bookingStatus: "PICKED_UP",
      startDate: input.startDate,
      endDate: input.endDate,
      pickupLocation: summary.pickupLocationDisplay || input.pickupLocation,
      returnLocation: summary.dropoffLocationDisplay || input.pickupLocation,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: "",
      vehicleMake: input.vehicleLabel,
      vehicleModel: "",
      vehicleYear: 0,
      dailyRate: 0,
      total: summary.totalAfterDiscount,
      deposit: summary.depositRequired,
      paidToDate: summary.paidToDate,
      balanceDue: summary.balanceDue,
      paymentMethod: "Not specified",
    },
    "pickup_confirmed",
  );

  const htmlWithAttachmentNotice = html.replace(
    '<p style="font-size:12px; color:#64748b;">The attached rental agreement includes your booking terms.</p>',
    agreementAttachment.noticeHtml,
  );

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Pickup confirmed — rental agreement attached",
    html: htmlWithAttachmentNotice,
    attachments: agreementAttachment.attachments,
    dispatch: withDispatchContext(
      {
        entityType: "booking",
        entityId: input.bookingId,
        entityPublicId: bookingReference,
        emailType: "pickup_confirmed",
        recipientName: input.customerName,
        triggerSource: "admin_pickup",
        manualResendAllowed: true,
        metadata: {
          bookingId: input.bookingId,
          bookingReference,
        },
      },
      input.dispatch,
    ),
  });
}
