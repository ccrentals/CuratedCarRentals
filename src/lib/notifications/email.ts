import { buildInvoicePayload, downloadPdfBase64, generateInvoicePdf } from "@/lib/pdfmonkey";
import { logError, logWarn, redactText } from "@/lib/log";
import { computeBookingPricing, readInsurancePricingFields, readPromoPricingFields } from "@/lib/payments/pricing";
import { dbQuery } from "@/lib/db";
import { formatPaymentStatus } from "@/lib/payments/formatPaymentStatus";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

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
};

type Attachment = {
  filename: string;
  content: string;
};

type SendEmailResult = { ok: boolean; skipped?: boolean; error?: string };

async function sendResendEmail({
  to,
  subject,
  html,
  replyTo,
  attachments,
}: SendEmailInput & { attachments?: Attachment[] }): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM?.trim() || DEFAULT_FROM;

  if (!apiKey) {
    logWarn("resend_email_skipped", { reason: "RESEND_API_KEY not set" });
    return { ok: false, skipped: true, error: "RESEND_API_KEY not set" };
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      reply_to: replyTo ?? from,
      attachments,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logError("resend_email_failed", new Error(`HTTP ${response.status}`), {
      status: response.status,
      responseBody: text,
      to,
      subject,
    });
    const safe = redactText(text).replace(/\s+/g, " ").slice(0, 300);
    return { ok: false, error: safe || `HTTP ${response.status}` };
  }

  return { ok: true };
}

function baseUrl() {
  return process.env.SITE_URL ?? "http://localhost:3000";
}

function policyHtml() {
  return `
    <div style="margin-top:16px; font-size:12px; color:#64748b;">
      <p style="font-weight:600; color:#0f172a; margin-bottom:6px;">Payment & pickup notes</p>
      <ul style="margin:0; padding-left:18px;">
        <li>Deposit secures the booking. Balance is due by pickup.</li>
        <li>Please bring a valid driver’s license and the booking reference.</li>
        <li>Cancellations within 24 hours of pickup may be non-refundable.</li>
      </ul>
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
  const parts = [
    normalizeText(row.customer_street),
    normalizeText(row.customer_street2),
    normalizeText(row.customer_city),
    normalizeText(row.customer_state),
    normalizeText(row.customer_country),
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
        "select b.public_id, b.pricing_json, c.address as customer_address, c.street as customer_street, c.street2 as customer_street2, c.city as customer_city, c.state as customer_state, c.country as customer_country from bookings b join customers c on c.id = b.customer_id where b.id = $1",
        [bookingId],
      );
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "42703") {
        return await dbQuery<InvoiceContextRow>(
          "select b.public_id, b.pricing_json, c.address as customer_address, null::text as customer_street, null::text as customer_street2, null::text as customer_city, null::text as customer_state, null::text as customer_country from bookings b join customers c on c.id = b.customer_id where b.id = $1",
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
    .map((row) => ({
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
      normalizeText(input.bookingPublicId) || context.bookingPublicId || input.bookingId.slice(0, 8);
    const address = normalizeText(input.customerAddress) || context.customerAddress;
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
    if (!pdf?.downloadUrl) return undefined;
    const base64 = await downloadPdfBase64(pdf.downloadUrl);
    return [{ filename: `invoice-${invoiceNumber}.pdf`, content: base64 }];
  } catch (error) {
    logError("invoice_pdf_generation_failed", error, { bookingId: input.bookingId });
    return undefined;
  }
}

type InvoiceAttachmentInput = Parameters<typeof buildInvoiceAttachment>[0];

async function buildRequiredInvoiceAttachment(input: InvoiceAttachmentInput) {
  const attachments = await buildInvoiceAttachment(input);
  if (!attachments || attachments.length === 0) {
    return {
      ok: false as const,
      error: "Invoice PDF is currently unavailable. Please retry shortly.",
    };
  }
  return {
    ok: true as const,
    attachments,
  };
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
}) {
  const summary = computeBookingPricing({
    bookingId: input.bookingId,
    bookingStatus: "PENDING_PAYMENT",
    startDate: input.startDate,
    endDate: input.endDate,
    dailyRate: input.dailyRate,
    deposit: input.deposit,
    netPaidToDate: 0,
    promoCode: input.promoCode ?? null,
    promoDiscount: input.promoDiscount ?? 0,
  });
  const days = summary.days;
  const total = summary.total;
  const balance = Math.max(0, summary.total - summary.deposit);
  const bookingLink = `${baseUrl()}/bookings/${input.bookingId}`;
  const invoiceLink = `${baseUrl()}/bookings/${input.bookingId}/invoice`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Booking received</h2>
      <p>Hi ${input.customerName},</p>
      <p>Your booking request has been received. Please pay the deposit to confirm your reservation.</p>
      <p><strong>Booking reference:</strong> ${input.bookingId.slice(0, 8)}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)} (${days} days)</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
      <hr />
      <p><strong>Total rental:</strong> ${formatAmount(total)}</p>
      ${
        summary.promoDiscount > 0
          ? `<p><strong>Promo${summary.promoCode ? ` (${summary.promoCode})` : ""}:</strong> -${formatAmount(summary.promoDiscount)}</p>`
          : ""
      }
      <p><strong>Deposit online:</strong> ${formatAmount(input.deposit)}</p>
      <p><strong>Balance on pickup:</strong> ${formatAmount(balance)}</p>
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">Pay Deposit</a>
        <a href="${invoiceLink}" style="margin-left:12px; color:#1f2d4d; text-decoration:underline;">View Invoice</a>
      </p>
      ${policyHtml()}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  const attachments = await buildInvoiceAttachment({
    bookingId: input.bookingId,
    bookingStatus: "PENDING_PAYMENT",
    startDate: input.startDate,
    endDate: input.endDate,
    pickupLocation: input.pickupLocation,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: "",
    vehicleMake: input.vehicleLabel,
    vehicleModel: "",
    vehicleYear: 0,
    dailyRate: input.dailyRate,
    deposit: input.deposit,
    total,
    paidToDate: 0,
    balanceDue: balance,
    payments: [],
  });

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Your booking is ready — deposit required",
    html,
    attachments,
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
}) {
  const summary = computeBookingPricing({
    bookingId: input.bookingId,
    bookingStatus: "CONFIRMED",
    startDate: input.startDate,
    endDate: input.endDate,
    dailyRate: input.dailyRate,
    deposit: input.deposit,
    netPaidToDate: input.paidToDate,
    promoCode: input.promoCode ?? null,
    promoDiscount: input.promoDiscount ?? 0,
  });
  const days = summary.days;
  const total = summary.total;
  const balance = summary.balanceDue;
  const bookingLink = `${baseUrl()}/bookings/${input.bookingId}`;
  const invoiceLink = `${baseUrl()}/bookings/${input.bookingId}/invoice`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Deposit received</h2>
      <p>Hi ${input.customerName},</p>
      <p>Your deposit payment was received and your booking is confirmed.</p>
      <p><strong>Booking reference:</strong> ${input.bookingId.slice(0, 8)}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)} (${days} days)</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
      <hr />
      <p><strong>Total rental:</strong> ${formatAmount(total)}</p>
      ${
        summary.promoDiscount > 0
          ? `<p><strong>Promo${summary.promoCode ? ` (${summary.promoCode})` : ""}:</strong> -${formatAmount(summary.promoDiscount)}</p>`
          : ""
      }
      <p><strong>Deposit paid:</strong> ${formatAmount(input.deposit)}</p>
      <p><strong>Paid to date:</strong> ${formatAmount(input.paidToDate)}</p>
      <p><strong>Balance on pickup:</strong> ${formatAmount(balance)}</p>
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">View Booking</a>
        <a href="${invoiceLink}" style="margin-left:12px; color:#1f2d4d; text-decoration:underline;">View Invoice</a>
      </p>
      ${policyHtml()}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  const invoiceAttachment = await buildRequiredInvoiceAttachment({
    bookingId: input.bookingId,
    bookingStatus: "CONFIRMED",
    startDate: input.startDate,
    endDate: input.endDate,
    pickupLocation: input.pickupLocation,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: "",
    vehicleMake: input.vehicleLabel,
    vehicleModel: "",
    vehicleYear: 0,
    dailyRate: input.dailyRate,
    deposit: input.deposit,
    total,
    paidToDate: input.paidToDate,
    balanceDue: balance,
    payments: [],
  });

  if (!invoiceAttachment.ok) {
    return invoiceAttachment;
  }

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Deposit received — booking confirmed",
    html,
    attachments: invoiceAttachment.attachments,
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
}) {
  const bookingLink = `${baseUrl()}/bookings/${input.bookingId}`;
  const invoiceLink = `${baseUrl()}/bookings/${input.bookingId}/invoice`;
  const balanceLink = `${baseUrl()}/bookings/${input.bookingId}/balance`;

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
      <p><strong>Booking reference:</strong> ${input.bookingId.slice(0, 8)}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
      <hr />
      <p><strong>Total rental:</strong> ${formatAmount(input.total)}</p>
      <p><strong>Paid to date:</strong> ${formatAmount(input.paidToDate)}</p>
      <p><strong>Balance outstanding:</strong> ${formatAmount(input.balanceDue)}</p>
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">View Booking</a>
        <a href="${balanceLink}" style="margin-left:12px; background:#e2a100; color:#111827; padding:10px 16px; border-radius:8px; text-decoration:none;">Pay Balance</a>
        <a href="${invoiceLink}" style="margin-left:12px; color:#1f2d4d; text-decoration:underline;">View Invoice</a>
      </p>
      ${policyHtml()}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  const invoiceAttachment = await buildRequiredInvoiceAttachment({
    bookingId: input.bookingId,
    bookingStatus: "CONFIRMED",
    startDate: input.startDate,
    endDate: input.endDate,
    pickupLocation: input.pickupLocation,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: "",
    vehicleMake: input.vehicleLabel,
    vehicleModel: "",
    vehicleYear: 0,
    dailyRate: input.dailyRate,
    deposit: input.deposit,
    total: input.total,
    paidToDate: input.paidToDate,
    balanceDue: input.balanceDue,
    payments: [],
  });

  if (!invoiceAttachment.ok) {
    return invoiceAttachment;
  }

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Payment update — balance outstanding",
    html,
    attachments: invoiceAttachment.attachments,
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
}) {
  const bookingLink = `${baseUrl()}/bookings/${input.bookingId}`;
  const invoiceLink = `${baseUrl()}/bookings/${input.bookingId}/invoice`;

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
      <p><strong>Booking reference:</strong> ${input.bookingId.slice(0, 8)}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
      <hr />
      <p><strong>Total rental:</strong> ${formatAmount(input.total)}</p>
      <p><strong>Paid to date:</strong> ${formatAmount(input.paidToDate)}</p>
      <p><strong>Balance outstanding:</strong> ${formatAmount(input.balanceDue)}</p>
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">View Booking</a>
        <a href="${invoiceLink}" style="margin-left:12px; color:#1f2d4d; text-decoration:underline;">View Invoice</a>
      </p>
      ${policyHtml()}
      <p style="font-size:12px; color:#64748b;">Need help? Reply to this email.</p>
    </div>
  `;

  const invoiceAttachment = await buildRequiredInvoiceAttachment({
    bookingId: input.bookingId,
    bookingStatus: "CONFIRMED",
    startDate: input.startDate,
    endDate: input.endDate,
    pickupLocation: input.pickupLocation,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: "",
    vehicleMake: input.vehicleLabel,
    vehicleModel: "",
    vehicleYear: 0,
    dailyRate: input.dailyRate,
    deposit: input.deposit,
    total: input.total,
    paidToDate: input.paidToDate,
    balanceDue: input.balanceDue,
    payments: [],
  });

  if (!invoiceAttachment.ok) {
    return invoiceAttachment;
  }

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Payment complete — booking paid in full",
    html,
    attachments: invoiceAttachment.attachments,
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
}) {
  const balanceLink = `${baseUrl()}/bookings/${input.bookingId}/balance`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Balance due before pickup</h2>
      <p>Hi ${input.customerName},</p>
      <p>Your pickup date is today and a balance is still outstanding.</p>
      <p><strong>Booking reference:</strong> ${input.bookingId.slice(0, 8)}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
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
}) {
  const bookingLink = `${baseUrl()}/bookings/${input.bookingId}`;
  const balanceLink = `${baseUrl()}/bookings/${input.bookingId}/balance`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Dropoff reminder</h2>
      <p>Hi ${input.customerName},</p>
      <p>Today is your dropoff date and there is still a balance outstanding.</p>
      <p><strong>Booking reference:</strong> ${input.bookingId.slice(0, 8)}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
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
}) {
  const bookingLink = `${baseUrl()}/bookings/${input.bookingId}`;
  const balanceLink = `${baseUrl()}/bookings/${input.bookingId}/balance`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Late dropoff notice</h2>
      <p>Hi ${input.customerName},</p>
      <p>Your scheduled dropoff date has passed and a balance is still outstanding.</p>
      <p><strong>Booking reference:</strong> ${input.bookingId.slice(0, 8)}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
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
}) {
  const isInternal = input.recipientType === "internal";
  const bookingLink = isInternal
    ? `${baseUrl()}/admin/bookings/${input.bookingId}`
    : `${baseUrl()}/bookings/${input.bookingId}`;
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
      <p><strong>Booking reference:</strong> ${input.bookingId.slice(0, 8)}</p>
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
      ? `[Internal] Blockout cancellation — ${input.bookingId.slice(0, 8)}`
      : "Booking cancelled due to vehicle unavailability",
    html,
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
}) {
  const isInternal = input.recipientType === "internal";
  const bookingLink = isInternal
    ? `${baseUrl()}/admin/bookings/${input.bookingId}`
    : `${baseUrl()}/bookings/${input.bookingId}`;
  const overridingBookingLink = isInternal
    ? `${baseUrl()}/admin/bookings/${input.overriddenByBookingId}`
    : `${baseUrl()}/bookings/${input.overriddenByBookingId}`;

  const greeting = isInternal ? "Operations update" : `Hi ${input.customerName},`;
  const intro = isInternal
    ? "A non-blocking booking was automatically cancelled because another booking for the same vehicle and dates became paid."
    : "Your unpaid booking was cancelled because another customer completed payment for the same vehicle and dates.";

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>${isInternal ? "[Internal] Booking overridden by paid booking" : "Booking cancellation notice"}</h2>
      <p>${greeting}</p>
      <p>${intro}</p>
      <p><strong>Booking reference:</strong> ${input.bookingId.slice(0, 8)}</p>
      <p><strong>Customer:</strong> ${input.customerName} (${input.customerEmail})</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
      <hr />
      <p><strong>Overridden by booking:</strong> ${input.overriddenByBookingId.slice(0, 8)}</p>
      <p style="margin-top: 16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">${
          isInternal ? "Open Overridden Booking" : "View Booking"
        }</a>
        <a href="${overridingBookingLink}" style="margin-left:12px; color:#1f2d4d; text-decoration:underline;">${
          isInternal ? "Open Paid Booking" : "View Paid Booking"
        }</a>
      </p>
      ${isInternal ? "" : policyHtml()}
      <p style="font-size:12px; color:#64748b;">${isInternal ? "This is an internal operations alert." : "Need help? Reply to this email."}</p>
    </div>
  `;

  return sendResendEmail({
    to: input.recipientEmail,
    subject: isInternal
      ? `[Internal] Booking overridden — ${input.bookingId.slice(0, 8)}`
      : "Booking cancelled — vehicle reserved by another paid booking",
    html,
  });
}

export function getInternalNotesRecipient() {
  return (
    process.env.INTERNAL_NOTES_EMAIL?.trim() ||
    process.env.RESEND_FROM?.trim() ||
    DEFAULT_FROM
  );
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
}) {
  const bookingLink = `${baseUrl()}/admin/bookings/${input.bookingId}`;
  const notePrefix = input.recipientType === "internal" ? "[Internal] " : "";
  const scheduleLine = input.scheduledFor
    ? `<p><strong>Scheduled send:</strong> ${formatDateTime(input.scheduledFor)}</p>`
    : "";

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>${notePrefix}Booking note update</h2>
      <p><strong>Booking reference:</strong> ${input.bookingId.slice(0, 8)}</p>
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
    subject: `${notePrefix}Booking note — ${input.bookingId.slice(0, 8)}`,
    html,
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
}) {
  const bookingLink = `${baseUrl()}/bookings/${input.bookingId}`;
  const balanceLink = `${baseUrl()}/bookings/${input.bookingId}/balance`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Pickup reminder</h2>
      <p>Hi ${input.customerName},</p>
      <p>This is a reminder for your upcoming pickup.</p>
      <p><strong>Booking reference:</strong> ${input.bookingId.slice(0, 8)}</p>
      <p><strong>Vehicle:</strong> ${input.vehicleLabel}</p>
      <p><strong>Dates:</strong> ${formatDateOnly(input.startDate)} → ${formatDateOnly(input.endDate)}</p>
      <p><strong>Pickup location:</strong> ${input.pickupLocation}</p>
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
  });
}
