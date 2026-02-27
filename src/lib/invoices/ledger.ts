import { createHash } from "node:crypto";

import { dbQuery } from "@/lib/db";

type DbQueryFn = <T = unknown>(text: string, params?: unknown[]) => Promise<{
  rows: T[];
  rowCount: number;
}>;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function stableStringify(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, JsonValue>)[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJsonValue(entry);
    }
    return out;
  }

  return String(value);
}

export function computeInvoicePayloadHash(payload: Record<string, unknown>) {
  const encoded = stableStringify(toJsonValue(payload));
  return createHash("sha256").update(encoded).digest("hex");
}

export function hashInvoicePayload(payload: Record<string, unknown>) {
  return computeInvoicePayloadHash(payload);
}

function isUuid(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function ensureBookingInvoiceLedgerEntry(
  input: {
    bookingId: string;
    payload: Record<string, unknown>;
    source?: string;
    templateId?: string | null;
    createdByUserId?: string | null;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  const payloadHash = hashInvoicePayload(input.payload);
  const row = await getOrCreateInvoiceLedgerRow(
    {
      bookingId: input.bookingId,
      payloadHash,
      source: input.source ?? "PDFMONKEY",
      templateId: input.templateId ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
    queryFn,
  );

  return {
    id: row.id ?? null,
    payloadHash,
  };
}

export async function getOrCreateInvoiceLedgerRow(
  input: {
    bookingId: string;
    payloadHash: string;
    source?: string;
    templateId?: string | null;
    createdByUserId?: string | null;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  const createdByUserId = isUuid(input.createdByUserId) ? input.createdByUserId : null;
  const result = await queryFn<{ id: string; booking_id: string; payload_hash: string }>(
    "insert into booking_invoice_documents (booking_id, source, template_id, payload_hash, created_by_user_id) values ($1::uuid, $2, $3, $4, $5::uuid) " +
      "on conflict (booking_id, payload_hash) do update set source = excluded.source, template_id = coalesce(excluded.template_id, booking_invoice_documents.template_id), " +
      "created_by_user_id = coalesce(booking_invoice_documents.created_by_user_id, excluded.created_by_user_id) " +
      "returning id, booking_id, payload_hash",
    [
      input.bookingId,
      input.source ?? "PDFMONKEY",
      input.templateId ?? null,
      input.payloadHash,
      createdByUserId,
    ],
  );

  return {
    id: result.rows[0]?.id ?? null,
    bookingId: result.rows[0]?.booking_id ?? input.bookingId,
    payloadHash: result.rows[0]?.payload_hash ?? input.payloadHash,
  };
}

export async function markBookingInvoiceLedgerSuccess(
  input: {
    bookingId: string;
    payloadHash: string;
    providerDocumentId?: string | null;
    providerStatus?: string | null;
    downloadUrl?: string | null;
    emailedAt?: Date | null;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  await queryFn(
    "update booking_invoice_documents set provider_document_id = coalesce($3, provider_document_id), provider_status = coalesce($4, provider_status), download_url = coalesce($5, download_url), emailed_at = coalesce($6, emailed_at), last_error = null where booking_id = $1::uuid and payload_hash = $2",
    [
      input.bookingId,
      input.payloadHash,
      input.providerDocumentId ?? null,
      input.providerStatus ?? null,
      input.downloadUrl ?? null,
      input.emailedAt ?? null,
    ],
  );
}

export async function markInvoiceProviderInfo(
  input: {
    ledgerId?: string | null;
    bookingId?: string | null;
    payloadHash?: string | null;
    providerDocumentId?: string | null;
    providerStatus?: string | null;
    downloadUrl?: string | null;
    emailedAt?: Date | null;
    lastError?: string | null;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  if (input.ledgerId) {
    await queryFn(
      "update booking_invoice_documents set provider_document_id = coalesce($2, provider_document_id), provider_status = coalesce($3, provider_status), download_url = coalesce($4, download_url), emailed_at = coalesce($5, emailed_at), last_error = $6 where id = $1::uuid",
      [
        input.ledgerId,
        input.providerDocumentId ?? null,
        input.providerStatus ?? null,
        input.downloadUrl ?? null,
        input.emailedAt ?? null,
        input.lastError ? input.lastError.slice(0, 2000) : null,
      ],
    );
    return;
  }

  if (!input.bookingId || !input.payloadHash) return;

  await queryFn(
    "update booking_invoice_documents set provider_document_id = coalesce($3, provider_document_id), provider_status = coalesce($4, provider_status), download_url = coalesce($5, download_url), emailed_at = coalesce($6, emailed_at), last_error = $7 where booking_id = $1::uuid and payload_hash = $2",
    [
      input.bookingId,
      input.payloadHash,
      input.providerDocumentId ?? null,
      input.providerStatus ?? null,
      input.downloadUrl ?? null,
      input.emailedAt ?? null,
      input.lastError ? input.lastError.slice(0, 2000) : null,
    ],
  );
}

export async function markBookingInvoiceLedgerError(
  input: {
    bookingId: string;
    payloadHash: string;
    providerStatus?: string | null;
    error: string;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  await queryFn(
    "update booking_invoice_documents set provider_status = coalesce($3, provider_status), last_error = $4 where booking_id = $1::uuid and payload_hash = $2",
    [
      input.bookingId,
      input.payloadHash,
      input.providerStatus ?? "FAILED",
      input.error.slice(0, 2000),
    ],
  );
}
