import { dbQuery } from "@/lib/db";
import { resolveStoredRegionCountry } from "@/lib/jamaicaParishes";
import {
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
} from "@/lib/payments/pricing";
import { buildRentalAgreementPayload } from "@/lib/pdfmonkey";
import { buildUploadcareCdnUrl, extractUploadcareFileId } from "@/lib/uploads/uploadcare";

type DbQueryFn = typeof dbQuery;
type FetchNetPaidToDateFn = typeof fetchNetPaidToDate;

type BookingRow = {
  id: string;
  public_id: string | null;
  start_date: string | Date;
  end_date: string | Date;
  pickup_location: string;
  dropoff_location: string | null;
  status: string;
  pricing_json: Record<string, unknown> | null;
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
  deleted_at?: string | null;
};

type BookingSignatureFileRow = {
  storage_provider: string | null;
  storage_key: string | null;
  mime_type: string | null;
};

type BookingSignatureTimeRow = {
  signature_signed_at: string | Date | null;
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
  "REFUNDED",
]);

export type LoadedRentalAgreementPayload = {
  bookingId: string;
  bookingPublicId: string;
  paymentMethod: string;
  paymentCount: number;
  payload: Record<string, unknown>;
  summary: ReturnType<typeof computeBookingPricingFromStoredSnapshot>;
  signatureDataUrl: string | null;
  signedAt: string;
};

type LoadRentalAgreementPayloadDeps = {
  query?: DbQueryFn;
  fetchNetPaidToDateFn?: FetchNetPaidToDateFn;
  fetchFn?: typeof fetch;
  loadBooking?: (bookingId: string, query: DbQueryFn) => Promise<BookingRow | null>;
  loadPayments?: (bookingId: string, query: DbQueryFn) => Promise<PaymentRow[]>;
  loadSignature?: (
    bookingId: string,
    deps: { query: DbQueryFn; fetchFn: typeof fetch },
  ) => Promise<{ signatureDataUrl: string | null; signedAt: string }>;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toDateString(value: string | Date) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
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
  const addressFields = resolveStoredRegionCountry(booking.customer_state, booking.customer_country);
  const parts = [
    normalizeText(booking.customer_street),
    normalizeText(booking.customer_street2),
    normalizeText(booking.customer_city),
    normalizeText(addressFields.region),
    normalizeText(addressFields.country),
  ].filter(Boolean);
  return parts.join(", ");
}

function toSignatureDataUrl(
  storageKey: string,
): { mimeType: string; dataUrl: string } | null {
  const match = storageKey.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) return null;
  const mimeType = normalizeText(match[1]) || "image/png";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  try {
    const bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf-8");
    if (bytes.length < 1) return null;
    return {
      mimeType,
      dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    };
  } catch {
    return null;
  }
}

function isBalanceReducingPayment(payment: PaymentRow) {
  const amount = Number(payment.deposit_amount_cents || 0);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const normalized = String(payment.status ?? "")
    .trim()
    .toUpperCase();
  return PAYMENT_STATUS_REDUCES_BALANCE.has(normalized);
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

async function loadBookingRow(bookingId: string, query: DbQueryFn) {
  try {
    const result = await query<BookingRow>(
      "select b.id, b.public_id, b.start_date, b.end_date, b.pickup_location, b.dropoff_location, b.status, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address, c.street as customer_street, c.street2 as customer_street2, c.city as customer_city, c.state as customer_state, c.country as customer_country, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
      [bookingId],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42703") {
      const fallback = await query<BookingRow>(
        "select b.id, b.public_id, b.start_date, b.end_date, b.pickup_location, b.dropoff_location, b.status, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address, null::text as customer_street, null::text as customer_street2, null::text as customer_city, null::text as customer_state, null::text as customer_country, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
        [bookingId],
      );
      return fallback.rows[0] ?? null;
    }
    throw error;
  }
}

async function loadPayments(bookingId: string, query: DbQueryFn) {
  try {
    const result = await query<PaymentRow>(
      "select provider, status, deposit_amount_cents, created_at, metadata_json, deleted_at from payments where booking_id = $1 and deleted_at is null order by created_at asc",
      [bookingId],
    );
    return result.rows;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const message = String((error as { message?: unknown } | null)?.message ?? "");
    if (code === "42703" && message.includes("\"deleted_at\"") && message.includes("does not exist")) {
      const fallback = await query<PaymentRow>(
        "select provider, status, deposit_amount_cents, created_at, metadata_json from payments where booking_id = $1 order by created_at asc",
        [bookingId],
      );
      return fallback.rows;
    }
    throw error;
  }
}

async function loadSignature(
  bookingId: string,
  deps: { query: DbQueryFn; fetchFn: typeof fetch },
) {
  const signedAtResult = await (async () => {
    try {
      return await deps.query<BookingSignatureTimeRow>(
        "select signature_signed_at from bookings where id = $1 limit 1",
        [bookingId],
      );
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const message = String((error as { message?: unknown } | null)?.message ?? "");
      if (code === "42703" && message.includes("\"signature_signed_at\"")) {
        return { rows: [{ signature_signed_at: null }], rowCount: 1 } as {
          rows: BookingSignatureTimeRow[];
          rowCount: number;
        };
      }
      throw error;
    }
  })();

  const signedAtRaw = signedAtResult.rows[0]?.signature_signed_at ?? null;
  const signedAt =
    signedAtRaw instanceof Date ? signedAtRaw.toISOString() : normalizeText(signedAtRaw);

  const signatureResult = await deps.query<BookingSignatureFileRow>(
    "select storage_provider, storage_key, mime_type from booking_private_files where booking_id = $1 and document_type = 'SIGNATURE' order by created_at desc limit 1",
    [bookingId],
  );
  const signature = signatureResult.rows[0] ?? null;
  if (!signature) {
    return { signatureDataUrl: null as string | null, signedAt };
  }

  const storageProvider = normalizeText(signature.storage_provider).toUpperCase();
  const storageKey = normalizeText(signature.storage_key);
  if (!storageKey) {
    return { signatureDataUrl: null as string | null, signedAt };
  }

  if (storageProvider === "DATA_URL") {
    const parsed = toSignatureDataUrl(storageKey);
    return {
      signatureDataUrl: parsed?.dataUrl ?? null,
      signedAt,
    };
  }

  const uploadcareFileId = extractUploadcareFileId(storageKey);
  if (!uploadcareFileId) {
    return { signatureDataUrl: null as string | null, signedAt };
  }

  try {
    const upstream = await deps.fetchFn(buildUploadcareCdnUrl(uploadcareFileId));
    if (!upstream.ok) {
      return { signatureDataUrl: null as string | null, signedAt };
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length < 1) {
      return { signatureDataUrl: null as string | null, signedAt };
    }
    const mimeType =
      normalizeText(signature.mime_type) ||
      normalizeText(upstream.headers.get("content-type")) ||
      "image/png";
    return {
      signatureDataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
      signedAt,
    };
  } catch {
    return { signatureDataUrl: null as string | null, signedAt };
  }
}

export async function loadBookingRentalAgreementPayload(
  bookingId: string,
  deps: LoadRentalAgreementPayloadDeps = {},
): Promise<LoadedRentalAgreementPayload | null> {
  const query = deps.query ?? dbQuery;
  const fetchNetPaid = deps.fetchNetPaidToDateFn ?? fetchNetPaidToDate;
  const fetchFn = deps.fetchFn ?? fetch;
  const booking = await (deps.loadBooking ?? loadBookingRow)(bookingId, query);
  if (!booking) {
    return null;
  }

  const payments = await (deps.loadPayments ?? loadPayments)(booking.id, query);
  const reducingPayments = payments.filter(isBalanceReducingPayment);
  const paymentMethod =
    [...reducingPayments]
      .reverse()
      .map(resolveProviderLabel)
      .find((value) => normalizeText(value).length > 0) ?? "Not specified";
  const signature = await (deps.loadSignature ?? loadSignature)(booking.id, { query, fetchFn });
  const pricing = booking.pricing_json ?? {};
  const netPaidToDate = await fetchNetPaid(booking.id);
  const summary = computeBookingPricingFromStoredSnapshot({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    pricing,
    fallbackDailyRate: booking.daily_rate_cents,
    fallbackDeposit: booking.deposit_cents,
    netPaidToDate,
  });
  const bookingPublicId = normalizeText(booking.public_id) || booking.id.slice(0, 8);
  const payload = buildRentalAgreementPayload({
    bookingId: bookingPublicId,
    bookingStatus: booking.status,
    startDate: toDateString(booking.start_date),
    endDate: toDateString(booking.end_date),
    pickupLocation: booking.pickup_location,
    returnLocation: normalizeText(booking.dropoff_location) || booking.pickup_location,
    customerName: booking.customer_name,
    customerEmail: booking.customer_email,
    customerPhone: booking.customer_phone,
    customerAddress: buildCustomerAddress(booking),
    vehicleMake: booking.vehicle_make,
    vehicleModel: booking.vehicle_model,
    vehicleYear: booking.vehicle_year,
    dailyRate: summary.dailyRate,
    total: summary.total,
    deposit: summary.deposit,
    paidToDate: summary.netPaidToDate,
    balanceDue: summary.balanceDue,
    paymentMethod,
    signatureDataUrl: signature.signatureDataUrl,
    signedAt: signature.signedAt || undefined,
  });

  return {
    bookingId: booking.id,
    bookingPublicId,
    paymentMethod,
    paymentCount: reducingPayments.length,
    payload,
    summary,
    signatureDataUrl: signature.signatureDataUrl,
    signedAt: signature.signedAt || toIsoDateOnly(booking.start_date),
  };
}
