import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { loadAdminSettings } from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { formatPaymentStatus } from "@/lib/payments/formatPaymentStatus";
import { formatPaymentMetadataError } from "@/lib/payments/formatWipayError";

const PAYMENT_TYPES = ["all", "deposit", "balance", "full", "custom", "manual", "refund"] as const;
const PAYMENT_STATES = ["all", "successful", "pending", "failed", "refunded", "deleted"] as const;
const PAYMENT_PROVIDERS = ["all", "WIPAY", "MANUAL"] as const;

type PaymentTypeFilter = (typeof PAYMENT_TYPES)[number];
type PaymentStateFilter = (typeof PAYMENT_STATES)[number];
type PaymentProviderFilter = (typeof PAYMENT_PROVIDERS)[number];

type PaymentListRow = {
  id: string;
  public_id: string;
  booking_id: string;
  booking_public_id: string | null;
  provider: string;
  status: string;
  deposit_amount_cents: number;
  currency: string;
  provider_ref: string | null;
  provider_transaction_id: string | null;
  metadata_json: Record<string, unknown> | null;
  deleted_at: string | null;
  deleted_reason: string | null;
  created_at: string;
  updated_at: string;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
  is_refunded: boolean;
};

function oneOf<T extends readonly string[]>(value: string | null, options: T, fallback: T[number]) {
  return options.includes(value as T[number]) ? value as T[number] : fallback;
}

export function parseAdminPaymentsQuery(url: string) {
  const params = new URL(url).searchParams;
  const limitValue = params.get("limit");
  const rawLimit = Number(limitValue);
  const limit = limitValue && Number.isInteger(rawLimit) ? Math.min(50, Math.max(10, rawLimit)) : 20;
  const providerRaw = (params.get("provider") || "all").trim().toUpperCase();
  return {
    q: (params.get("q") || "").trim().slice(0, 120),
    type: oneOf((params.get("type") || "all").trim().toLowerCase(), PAYMENT_TYPES, "all") as PaymentTypeFilter,
    state: oneOf((params.get("state") || "all").trim().toLowerCase(), PAYMENT_STATES, "all") as PaymentStateFilter,
    provider: oneOf(providerRaw, PAYMENT_PROVIDERS, "all") as PaymentProviderFilter,
    cursor: (params.get("cursor") || "").trim(),
    limit,
  };
}

function readPaymentType(metadata: Record<string, unknown> | null) {
  const value = metadata?.payment_type;
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "deposit";
}

function providerLabel(provider: string, metadata: Record<string, unknown> | null) {
  if (provider !== "MANUAL") return provider;
  const label = metadata?.method_label ?? metadata?.method;
  return typeof label === "string" && label.trim() ? label.trim() : "MANUAL";
}

function parseCursor(value: string) {
  const separator = value.lastIndexOf("|");
  if (separator < 1) return null;
  const createdAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime()) || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return null;
  return { createdAt: parsed.toISOString(), id };
}

export async function GET(request: Request) {
  const auth = await requireAdminRole({ forbiddenMessage: "Forbidden" });
  if (!auth.ok) return auth.response;
  const filters = parseAdminPaymentsQuery(request.url);

  const conditions: string[] = [];
  const values: unknown[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.q) {
    const param = add(`%${filters.q}%`);
    conditions.push(`(p.public_id ilike ${param} or b.public_id ilike ${param} or c.full_name ilike ${param} or c.email ilike ${param} or p.provider_ref ilike ${param} or p.provider_transaction_id ilike ${param})`);
  }
  if (filters.provider !== "all") conditions.push(`upper(p.provider) = ${add(filters.provider)}`);
  if (filters.type !== "all") conditions.push(`lower(coalesce(p.metadata_json->>'payment_type', 'deposit')) = ${add(filters.type)}`);

  if (filters.state === "deleted") conditions.push("p.deleted_at is not null");
  else conditions.push("p.deleted_at is null");
  if (filters.state === "successful") conditions.push("upper(p.status) in ('DEPOSIT_PAID', 'PAID_IN_FULL')");
  if (filters.state === "pending") conditions.push("upper(p.status) in ('INITIATED', 'PENDING', 'PROCESSING')");
  if (filters.state === "failed") conditions.push("upper(p.status) in ('FAILED', 'ERROR', 'DECLINED', 'CANCELLED')");
  if (filters.state === "refunded") conditions.push("(upper(p.status) = 'REFUNDED' or exists (select 1 from payments r where r.provider_ref = 'REFUND_' || p.id::text))");

  const fromSql = " from payments p join bookings b on b.id = p.booking_id join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id ";
  const whereSql = conditions.length ? ` where ${conditions.join(" and ")}` : "";

  try {
    const summaryResult = await dbQuery<{
      total_count: number;
      collected_amount: number;
      refund_amount: number;
      net_amount: number;
      successful_count: number;
      attention_count: number;
    }>(
      "select count(*)::int as total_count, " +
        "coalesce(sum(case when p.deleted_at is null and upper(p.status) in ('DEPOSIT_PAID','PAID_IN_FULL') and p.deposit_amount_cents > 0 then p.deposit_amount_cents else 0 end),0)::float8 as collected_amount, " +
        "coalesce(sum(case when p.deleted_at is null and (upper(p.status) = 'REFUNDED' or p.deposit_amount_cents < 0) then abs(p.deposit_amount_cents) else 0 end),0)::float8 as refund_amount, " +
        "coalesce(sum(case when p.deleted_at is null and (upper(p.status) in ('DEPOSIT_PAID','PAID_IN_FULL','REFUNDED')) then p.deposit_amount_cents else 0 end),0)::float8 as net_amount, " +
        "count(*) filter (where p.deleted_at is null and upper(p.status) in ('DEPOSIT_PAID','PAID_IN_FULL'))::int as successful_count, " +
        "count(*) filter (where p.deleted_at is null and upper(p.status) in ('INITIATED','PENDING','PROCESSING','FAILED','ERROR','DECLINED','CANCELLED'))::int as attention_count" +
        fromSql + whereSql,
      values,
    );

    const rowConditions = [...conditions];
    const rowValues = [...values];
    const cursor = parseCursor(filters.cursor);
    if (cursor) {
      rowValues.push(cursor.createdAt, cursor.id);
      rowConditions.push(`(p.created_at, p.id) < ($${rowValues.length - 1}::timestamptz, $${rowValues.length}::uuid)`);
    }
    rowValues.push(filters.limit + 1);
    const rows = await dbQuery<PaymentListRow>(
      "select p.id, p.public_id, p.booking_id, b.public_id as booking_public_id, p.provider, p.status, p.deposit_amount_cents, p.currency, p.provider_ref, p.provider_transaction_id, p.metadata_json, p.deleted_at, p.deleted_reason, p.created_at, p.updated_at, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, exists (select 1 from payments r where r.provider_ref = 'REFUND_' || p.id::text) as is_refunded" +
        fromSql +
        (rowConditions.length ? ` where ${rowConditions.join(" and ")}` : "") +
        ` order by p.created_at desc, p.id desc limit $${rowValues.length}`,
      rowValues,
    );

    const hasMore = rows.rows.length > filters.limit;
    const visibleRows = rows.rows.slice(0, filters.limit);
    const items = visibleRows.map((row: PaymentListRow) => {
      const paymentType = readPaymentType(row.metadata_json);
      const formattedError = formatPaymentMetadataError(row.metadata_json);
      return {
        id: row.id,
        publicId: row.public_id,
        bookingId: row.booking_id,
        bookingPublicId: row.booking_public_id,
        provider: row.provider,
        providerLabel: providerLabel(row.provider, row.metadata_json),
        status: row.status,
        statusLabel: formatPaymentStatus(row.status, { paymentType }),
        paymentType,
        amount: Number(row.deposit_amount_cents) || 0,
        currency: row.currency,
        providerReference: row.provider_ref,
        transactionId: row.provider_transaction_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
        deletedReason: row.deleted_reason,
        isRefunded: Boolean(row.is_refunded),
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        vehicleLabel: `${row.vehicle_make} ${row.vehicle_model}`.trim(),
        error: formattedError,
      };
    });
    const last = visibleRows.at(-1);
    const { settings } = await loadAdminSettings();

    return NextResponse.json({
      items,
      summary: summaryResult.rows[0] ?? { total_count: 0, collected_amount: 0, refund_amount: 0, net_amount: 0, successful_count: 0, attention_count: 0 },
      totalCount: Number(summaryResult.rows[0]?.total_count ?? 0),
      hasMore,
      nextCursor: hasMore && last ? `${new Date(last.created_at).toISOString()}|${last.id}` : null,
      requireRestoreReason: settings.requireRestoreReason,
      filters: { q: filters.q, type: filters.type, state: filters.state, provider: filters.provider },
    });
  } catch (error) {
    logError("api.admin.payments.GET", error, { userId: auth.actor.userId, ...filters, cursor: Boolean(filters.cursor) });
    return NextResponse.json({ error: "Failed to load payments" }, { status: 500 });
  }
}
