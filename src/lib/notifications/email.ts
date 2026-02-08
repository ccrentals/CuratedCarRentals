import { buildInvoicePayload, downloadPdfBase64, generateInvoicePdf } from "@/lib/pdfmonkey";
import { logError, logWarn, redactText, safeErrorMessage } from "@/lib/log";

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

function daysInclusive(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff + 1 : 0;
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

async function buildInvoiceAttachment(input: {
  bookingId: string;
  bookingStatus: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  dailyRate: number;
  deposit: number;
  total: number;
  paidToDate: number;
  balanceDue: number;
  payments: { provider: string; status: string; amount: number; date: string }[];
}) {
  try {
    const payload = buildInvoicePayload(input);
    const pdf = await generateInvoicePdf(payload, input.bookingId);
    if (!pdf?.downloadUrl) return undefined;
    const base64 = await downloadPdfBase64(pdf.downloadUrl);
    return [{ filename: `invoice-${input.bookingId.slice(0, 8)}.pdf`, content: base64 }];
  } catch (error) {
    logError("invoice_pdf_generation_failed", error, { bookingId: input.bookingId });
    return undefined;
  }
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
}) {
  const days = daysInclusive(input.startDate, input.endDate);
  const total = days * input.dailyRate;
  const balance = Math.max(0, total - input.deposit);
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
}) {
  const days = daysInclusive(input.startDate, input.endDate);
  const total = days * input.dailyRate;
  const balance = Math.max(0, total - input.paidToDate);
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

  const attachments = await buildInvoiceAttachment({
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
    payments: [
      {
        provider: "WIPAY",
        status: "DEPOSIT_PAID",
        amount: input.paidToDate,
        date: new Date().toISOString(),
      },
    ],
  });

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Deposit received — booking confirmed",
    html,
    attachments,
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

  const attachments = await buildInvoiceAttachment({
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

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Payment update — balance outstanding",
    html,
    attachments,
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

  const attachments = await buildInvoiceAttachment({
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

  return sendResendEmail({
    to: input.customerEmail,
    subject: "Payment complete — booking paid in full",
    html,
    attachments,
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
