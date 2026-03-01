import { dbQuery } from "@/lib/db";
import { getInvoiceProvider } from "@/lib/env";
import { formatJmd } from "@/lib/money";
import {
  computeBookingPricing,
  fetchNetPaidToDate,
  readInsurancePricingFields,
  readPromoPricingFields,
} from "@/lib/payments/pricing";
import { formatPaymentStatus } from "@/lib/payments/formatPaymentStatus";
import {
  buildInvoicePayload,
  buildRentalAgreementPayload,
  generateInvoicePdf,
  generateRentalAgreementPdf,
} from "@/lib/pdfmonkey";
import { QuoteTemplatePreviewFrame } from "@/components/admin/QuoteTemplatePreviewFrame";

type TemplateKey = "invoice" | "quote" | "agreement" | "receipt";

const TEMPLATE_ITEMS: ReadonlyArray<{ key: TemplateKey; label: string; note: string }> = [
  { key: "invoice", label: "Invoice", note: "Preview generated from the newest booking." },
  { key: "quote", label: "Quote", note: "Preview generated from the newest quote." },
  { key: "agreement", label: "Rental Agreement", note: "Preview generated from the newest booking." },
  { key: "receipt", label: "Receipt", note: "Uses the same template output as Invoice." },
];

type BookingRow = {
  id: string;
  public_id: string;
  start_date: string | Date;
  end_date: string | Date;
  pickup_location: string;
  status: string;
  pricing_json: Record<string, unknown> | null;
  insurance_total_cents: number | null;
  insurance_price_per_day_cents: number | null;
  insurance_selected: boolean | null;
  created_at: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string | null;
  customer_street: string | null;
  customer_street2: string | null;
  customer_city: string | null;
  customer_state: string | null;
  customer_country: string | null;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  daily_rate_cents: number;
  deposit_cents: number;
};

type PaymentRow = {
  provider: string;
  status: string;
  deposit_amount_cents: number;
  created_at: string | Date;
  metadata_json: Record<string, unknown> | null;
};

type TemplatePreview = {
  sourceId: string | null;
  sourcePublicId: string | null;
  sourceLabel: "booking" | "quote";
  pdfUrl: string | null;
  error: string | null;
  total: number;
  paidToDate: number;
  balanceDue: number;
  paymentCount: number;
};

type LatestTemplateContext = {
  booking: BookingRow;
  reducingPayments: PaymentRow[];
  pickupDate: string;
  dropoffDate: string;
  customerAddress: string;
  dailyRate: number;
  depositPolicy: number;
  promoCode: string | null;
  summary: ReturnType<typeof computeBookingPricing>;
};

type QuoteRow = {
  id: string;
  public_id: string | null;
  total_cents: number;
  amount_due_cents: number;
};

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

function isBalanceReducingPayment(payment: PaymentRow) {
  const amount = Number(payment.deposit_amount_cents || 0);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const normalized = String(payment.status ?? "")
    .trim()
    .toUpperCase();
  return PAYMENT_STATUS_REDUCES_BALANCE.has(normalized);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function buildCustomerAddress(booking: BookingRow) {
  const direct = normalizeText(booking.customer_address);
  if (direct) return direct;
  const parts = [
    normalizeText(booking.customer_street),
    normalizeText(booking.customer_street2),
    normalizeText(booking.customer_city),
    normalizeText(booking.customer_state),
    normalizeText(booking.customer_country),
  ].filter(Boolean);
  return parts.join(", ");
}

function toMoneyCents(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function resolveProviderLabel(payment: PaymentRow) {
  if (payment.provider !== "MANUAL") return payment.provider;
  const methodLabel =
    typeof payment.metadata_json?.method_label === "string" ? payment.metadata_json.method_label : null;
  if (methodLabel && methodLabel.trim()) return methodLabel.trim();
  const method = typeof payment.metadata_json?.method === "string" ? payment.metadata_json.method : null;
  if (method && method.trim()) return method.trim();
  return "MANUAL";
}

function resolveTemplate(input: string | string[] | undefined): TemplateKey {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (value === "invoice" || value === "quote" || value === "agreement" || value === "receipt") {
    return value;
  }
  return "invoice";
}

async function fetchLatestBooking(): Promise<BookingRow | null> {
  try {
    const result = await dbQuery<BookingRow>(
      "select b.id, b.public_id, b.start_date, b.end_date, b.pickup_location, b.status, b.pricing_json, b.insurance_total_cents, b.insurance_price_per_day_cents, b.insurance_selected, b.created_at, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address, c.street as customer_street, c.street2 as customer_street2, c.city as customer_city, c.state as customer_state, c.country as customer_country, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id order by b.created_at desc limit 1",
    );
    return result.rowCount > 0 ? result.rows[0] : null;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42703") {
      const fallback = await dbQuery<BookingRow>(
        "select b.id, b.public_id, b.start_date, b.end_date, b.pickup_location, b.status, b.pricing_json, null::int as insurance_total_cents, null::int as insurance_price_per_day_cents, null::boolean as insurance_selected, b.created_at, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, null::text as customer_address, null::text as customer_street, null::text as customer_street2, null::text as customer_city, null::text as customer_state, null::text as customer_country, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id order by b.created_at desc limit 1",
      );
      return fallback.rowCount > 0 ? fallback.rows[0] : null;
    }
    throw error;
  }
}

async function fetchBookingPayments(bookingId: string): Promise<PaymentRow[]> {
  try {
    const result = await dbQuery<PaymentRow>(
      "select provider, status, deposit_amount_cents, created_at, metadata_json from payments where booking_id = $1 and deleted_at is null order by created_at asc",
      [bookingId],
    );
    return result.rows;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const message = String((error as { message?: unknown } | null)?.message ?? "");
    if (code === "42703" && message.includes("\"deleted_at\"") && message.includes("does not exist")) {
      const fallback = await dbQuery<PaymentRow>(
        "select provider, status, deposit_amount_cents, created_at, metadata_json from payments where booking_id = $1 order by created_at asc",
        [bookingId],
      );
      return fallback.rows;
    }
    throw error;
  }
}

async function getLatestTemplateContext(): Promise<LatestTemplateContext | null> {
  const booking = await fetchLatestBooking();
  if (!booking) return null;

  const payments = await fetchBookingPayments(booking.id);
  const reducingPayments = payments.filter(isBalanceReducingPayment);
  const pickupDate = toIsoDateOnly(booking.start_date);
  const dropoffDate = toIsoDateOnly(booking.end_date);
  const customerAddress = buildCustomerAddress(booking);
  const pricing = booking.pricing_json ?? {};
  const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const depositPolicy = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
  const promoRead = readPromoPricingFields(pricing);
  const promoCode = promoRead.promoCode;
  const promoDiscount = Math.max(
    0,
    toMoneyCents(pricing.promo_discount_cents ?? pricing.discount_total_cents ?? promoRead.promoDiscount ?? 0),
  );
  const { insuranceSelected, insurancePricePerDay, insuranceTotal } = readInsurancePricingFields(pricing);
  const insuranceTotalDisplay = Math.max(
    0,
    toMoneyCents(
      pricing.insurance_total_cents ?? booking.insurance_total_cents ?? insuranceTotal ?? 0,
    ),
  );
  const insurancePricePerDayDisplay = Math.max(
    0,
    toMoneyCents(
      pricing.insurance_price_per_day_cents ??
        booking.insurance_price_per_day_cents ??
        insurancePricePerDay ??
        0,
    ),
  );
  const insuranceSelectedDisplay =
    typeof pricing.insurance_selected === "boolean"
      ? pricing.insurance_selected
      : booking.insurance_selected ?? insuranceSelected;
  const netPaidToDate = await fetchNetPaidToDate(booking.id);

  const summary = computeBookingPricing({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    dailyRate,
    deposit: depositPolicy,
    netPaidToDate,
    promoCode,
    promoDiscount,
    insuranceSelected: insuranceSelectedDisplay,
    insurancePricePerDay: insurancePricePerDayDisplay,
    insuranceTotal: insuranceTotalDisplay,
  });

  return {
    booking,
    reducingPayments,
    pickupDate,
    dropoffDate,
    customerAddress,
    dailyRate,
    depositPolicy,
    promoCode,
    summary,
  };
}

function emptyPreview(error: string): TemplatePreview {
  return {
    sourceId: null,
    sourcePublicId: null,
    sourceLabel: "booking",
    pdfUrl: null,
    error,
    total: 0,
    paidToDate: 0,
    balanceDue: 0,
    paymentCount: 0,
  };
}

async function buildInvoicePreviewFromLatestBooking(): Promise<TemplatePreview> {
  const context = await getLatestTemplateContext();
  if (!context) {
    return emptyPreview("No bookings found yet. Create a booking first, then refresh this page.");
  }

  const payload = buildInvoicePayload({
    bookingId: context.booking.id,
    bookingPublicId: context.booking.public_id || context.booking.id,
    bookingStatus: context.booking.status,
    startDate: context.pickupDate,
    endDate: context.dropoffDate,
    pickupLocation: context.booking.pickup_location,
    customerName: context.booking.customer_name,
    customerEmail: context.booking.customer_email,
    customerPhone: context.booking.customer_phone,
    customerAddress: context.customerAddress,
    vehicleMake: context.booking.vehicle_make,
    vehicleModel: context.booking.vehicle_model,
    vehicleYear: context.booking.vehicle_year,
    dailyRate: context.dailyRate,
    deposit: context.depositPolicy,
    baseTotal: context.summary.baseTotal,
    insuranceTotal: context.summary.insuranceTotal,
    promoDiscount: context.summary.discountTotal,
    promoCode: context.promoCode,
    total: context.summary.subtotal,
    paidToDate: context.summary.netPaidToDate,
    balanceDue: context.summary.balanceDue,
    payments: context.reducingPayments.map((payment) => ({
      provider: resolveProviderLabel(payment),
      status: formatPaymentStatus(payment.status, {
        paymentType:
          typeof payment.metadata_json?.payment_type === "string"
            ? String(payment.metadata_json.payment_type)
            : null,
      }),
      amount: Number(payment.deposit_amount_cents || 0),
      date: toIsoDateOnly(payment.created_at),
    })),
  });

  try {
    const pdf = await generateInvoicePdf(payload, context.booking.id, {
      source: "ADMIN_TEMPLATE_PREVIEW",
    });
    if (!pdf?.previewUrl) {
      return {
        sourceId: context.booking.id,
        sourcePublicId: context.booking.public_id || context.booking.id,
        sourceLabel: "booking",
        pdfUrl: null,
        error: "Invoice PDF preview was not returned by the current provider.",
        total: context.summary.total,
        paidToDate: context.summary.netPaidToDate,
        balanceDue: context.summary.balanceDue,
        paymentCount: context.reducingPayments.length,
      };
    }
    return {
      sourceId: context.booking.id,
      sourcePublicId: context.booking.public_id || context.booking.id,
      sourceLabel: "booking",
      pdfUrl: pdf.previewUrl,
      error: null,
      total: context.summary.total,
      paidToDate: context.summary.netPaidToDate,
      balanceDue: context.summary.balanceDue,
      paymentCount: context.reducingPayments.length,
    };
  } catch (error) {
    return {
      sourceId: context.booking.id,
      sourcePublicId: context.booking.public_id || context.booking.id,
      sourceLabel: "booking",
      pdfUrl: null,
      error:
        error instanceof Error
          ? error.message
          : "Unable to generate invoice preview right now.",
      total: context.summary.total,
      paidToDate: context.summary.netPaidToDate,
      balanceDue: context.summary.balanceDue,
      paymentCount: context.reducingPayments.length,
    };
  }
}

async function buildRentalAgreementPreviewFromLatestBooking(): Promise<TemplatePreview> {
  const context = await getLatestTemplateContext();
  if (!context) {
    return emptyPreview("No bookings found yet. Create a booking first, then refresh this page.");
  }

  const latestReducingPayment = [...context.reducingPayments].reverse().find(isBalanceReducingPayment);
  const paymentMethod = latestReducingPayment
    ? resolveProviderLabel(latestReducingPayment)
    : "Not specified";

  const payload = buildRentalAgreementPayload({
    bookingId: context.booking.public_id || context.booking.id,
    bookingStatus: context.booking.status,
    startDate: context.pickupDate,
    endDate: context.dropoffDate,
    pickupLocation: context.booking.pickup_location,
    returnLocation: context.booking.pickup_location,
    customerName: context.booking.customer_name,
    customerEmail: context.booking.customer_email,
    customerPhone: context.booking.customer_phone,
    customerAddress: context.customerAddress,
    vehicleMake: context.booking.vehicle_make,
    vehicleModel: context.booking.vehicle_model,
    vehicleYear: context.booking.vehicle_year,
    dailyRate: context.dailyRate,
    total: context.summary.total,
    deposit: context.depositPolicy,
    paidToDate: context.summary.netPaidToDate,
    balanceDue: context.summary.balanceDue,
    paymentMethod,
  });

  try {
    const pdf = await generateRentalAgreementPdf(payload);
    if (!pdf?.previewUrl) {
      return {
        sourceId: context.booking.id,
        sourcePublicId: context.booking.public_id || context.booking.id,
        sourceLabel: "booking",
        pdfUrl: null,
        error: "Rental agreement PDF preview was not returned by the current provider.",
        total: context.summary.total,
        paidToDate: context.summary.netPaidToDate,
        balanceDue: context.summary.balanceDue,
        paymentCount: context.reducingPayments.length,
      };
    }
    return {
      sourceId: context.booking.id,
      sourcePublicId: context.booking.public_id || context.booking.id,
      sourceLabel: "booking",
      pdfUrl: pdf.previewUrl,
      error: null,
      total: context.summary.total,
      paidToDate: context.summary.netPaidToDate,
      balanceDue: context.summary.balanceDue,
      paymentCount: context.reducingPayments.length,
    };
  } catch (error) {
    return {
      sourceId: context.booking.id,
      sourcePublicId: context.booking.public_id || context.booking.id,
      sourceLabel: "booking",
      pdfUrl: null,
      error:
        error instanceof Error
          ? error.message
          : "Unable to generate rental agreement preview right now.",
      total: context.summary.total,
      paidToDate: context.summary.netPaidToDate,
      balanceDue: context.summary.balanceDue,
      paymentCount: context.reducingPayments.length,
    };
  }
}

async function fetchLatestQuote(): Promise<QuoteRow | null> {
  const result = await dbQuery<QuoteRow>(
    "select id, public_id, total_cents, amount_due_cents from quotes order by created_at desc limit 1",
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

async function buildQuotePreviewFromLatestQuote(): Promise<TemplatePreview> {
  const latestQuote = await fetchLatestQuote();
  if (!latestQuote) {
    return {
      ...emptyPreview("No quotes found yet. Create a quote first, then refresh this page."),
      sourceLabel: "quote",
    };
  }

  return {
    sourceId: latestQuote.id,
    sourcePublicId: latestQuote.public_id || latestQuote.id,
    sourceLabel: "quote",
    pdfUrl: `/api/admin/quotes/${latestQuote.id}/pdf`,
    error: null,
    total: Number(latestQuote.total_cents || 0),
    paidToDate: 0,
    balanceDue: Number(latestQuote.amount_due_cents || latestQuote.total_cents || 0),
    paymentCount: 0,
  };
}

export default async function AdminTemplateLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const activeTemplate = resolveTemplate(query.template);
  const provider = getInvoiceProvider();
  const invoicePreview =
    activeTemplate === "invoice" || activeTemplate === "receipt"
      ? await buildInvoicePreviewFromLatestBooking()
      : null;
  const quotePreview = activeTemplate === "quote" ? await buildQuotePreviewFromLatestQuote() : null;
  const agreementPreview =
    activeTemplate === "agreement" ? await buildRentalAgreementPreviewFromLatestBooking() : null;
  const activePreview =
    activeTemplate === "agreement"
      ? agreementPreview
      : activeTemplate === "quote"
        ? quotePreview
        : invoicePreview;
  const activeLabel =
    TEMPLATE_ITEMS.find((item) => item.key === activeTemplate)?.label ??
    (activeTemplate === "agreement" ? "Rental Agreement" : "Invoice");
  const activeProviderLabel = activeTemplate === "quote" ? "native" : provider;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10">
      <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Administration
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">Template Lab</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          Admin-only preview route for invoice, quote, agreement, and receipt templates.
        </p>
      </div>

      <div className="mt-6">
        <section className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
          <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--ccr-text)]">
                    {activeLabel} Template Preview
                  </p>
                  <p className="text-xs text-[var(--ccr-muted)]">
                    Source {activePreview?.sourceLabel ?? "booking"}:{" "}
                    {activePreview?.sourceId
                      ? `${activePreview.sourcePublicId || activePreview.sourceId.slice(0, 8)} (${activePreview.sourceId.slice(0, 8)})`
                      : "none"}
                  </p>
                </div>
                <div className="text-right text-xs text-[var(--ccr-muted)]">
                  <p>
                    Provider:{" "}
                    <span className="font-semibold text-[var(--ccr-text)]">{activeProviderLabel}</span>
                  </p>
                  <p>
                    Total:{" "}
                    <span className="font-semibold text-[var(--ccr-text)]">
                      {formatJmd(activePreview?.total ?? 0)}
                    </span>
                  </p>
                  <p>
                    Paid:{" "}
                    <span className="font-semibold text-[var(--ccr-text)]">
                      {formatJmd(activePreview?.paidToDate ?? 0)}
                    </span>
                  </p>
                  <p>
                    Balance:{" "}
                    <span className="font-semibold text-[var(--ccr-text)]">
                      {formatJmd(activePreview?.balanceDue ?? 0)}
                    </span>
                  </p>
                </div>
              </div>

              {activeTemplate !== "quote" && provider !== "gotenberg" ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Current PDF provider is <strong>{provider}</strong>. For this template workflow,
                  set <code>PDF_PROVIDER=gotenberg</code>.
                </div>
              ) : null}

              {activePreview?.error ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  {activePreview.error}
                </div>
              ) : null}

              {activeTemplate === "quote" && activePreview?.sourceId ? (
                <QuoteTemplatePreviewFrame
                  quoteId={activePreview.sourceId}
                  title={`${activeLabel} Template Preview`}
                />
              ) : activePreview?.pdfUrl ? (
                <iframe
                  title={`${activeLabel} Template Preview`}
                  src={activePreview.pdfUrl}
                  className="mt-4 h-[980px] w-full rounded-2xl border border-[var(--ccr-border)] bg-white"
                />
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-5 text-sm text-[var(--ccr-muted)]">
                  No {activeLabel.toLowerCase()} preview available yet.
                </div>
              )}
          </>
        </section>
      </div>
    </div>
  );
}
