import { readSortFromSearchParams, type SortDir } from "@/components/admin/tableSort";
import { isVehicleUnavailableWithAvailabilityRules } from "@/lib/bookings/availabilityRules";
import {
  inferBookingLocationType,
  readBookingLocationDetails,
  type BookingLocationConfig,
} from "@/lib/bookings/bookingLocations";
import {
  listActiveBookingLocationConfigs,
  toBookingLocationConfigSchemaError,
} from "@/lib/bookings/bookingLocationConfigStore";
import {
  buildBookingLocationSelectionPayload,
  normalizeBookingLocationFieldValuesInput,
  validateBookingLocationSelection,
} from "@/lib/bookings/locationConfigRuntime";
import { dbQuery, getDbPool } from "@/lib/db";
import {
  getQuoteStatusTransitionError,
  normalizeQuoteStatus,
  QUOTE_STATUSES,
  resolveEffectiveQuoteStatus,
  type QuoteStatus,
} from "@/lib/quotes/lifecycle";
import { isEmail, isNonEmptyString } from "@/lib/validators";

import {
  buildQuotePricingSnapshot,
  QuotePricingError,
  type QuotePricingSnapshot,
} from "@/lib/quotes/quotePricing";

export { QUOTE_STATUSES };
export type { QuoteStatus };

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
};

type QuoteCursor = {
  createdAt: string;
  id: string;
  offset?: number;
};

type QuoteRow = {
  id: string;
  public_id: string;
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

export const QUOTE_SORT_COLUMNS = [
  "created",
  "customer",
  "email",
  "pickup",
  "return",
  "vehicle",
  "total",
  "status",
] as const;

export type QuoteSortBy = (typeof QUOTE_SORT_COLUMNS)[number];

export type QuoteSortState = {
  sortBy: QuoteSortBy;
  sortDir: SortDir;
};

export type AdminQuoteListItem = {
  id: string;
  publicId: string;
  createdAt: string;
  status: QuoteStatus;
  expiresAt: string | null;
  customerFullName: string;
  customerEmail: string;
  customerPhone: string | null;
  startAt: string;
  endAt: string;
  pickupLocationText: string;
  dropoffLocationText: string;
  vehicleId: string | null;
  vehicleLabel: string;
  vehicleClass: string | null;
  baseTotalCents: number;
  insuranceTotalCents: number;
  discountTotalCents: number;
  subtotalCents: number;
  totalCents: number;
  depositRequiredCents: number;
  amountDueCents: number;
  promoCode: string | null;
  insuranceEnabled: boolean;
  tags: string[];
  comments: string | null;
  commissionPartnerName: string | null;
  clientPaysAtPartner: boolean;
  rackPriceCents: number | null;
  lastEmailedAt: string | null;
};

export type AdminQuoteDetailItem = AdminQuoteListItem & {
  updatedAt: string;
  pricingJson: Record<string, unknown>;
  pickupLocationId: string | null;
  dropoffLocationId: string | null;
  insurancePlanId: string | null;
  createdByAdminUserId: string | null;
  lastEmailedTo: string | null;
  convertedBookingId: string | null;
};

export type AdminQuotesPage = {
  items: AdminQuoteListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  limit: number;
};

export type FetchAdminQuotesInput = {
  q?: string | null;
  status?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  rentalFrom?: string | null;
  rentalTo?: string | null;
  sortBy?: string | null;
  sortDir?: string | null;
  limit?: unknown;
  cursor?: unknown;
};

export type CreateAdminQuoteInput = {
  customerFullName: string;
  customerEmail: string;
  customerPhone?: string | null;
  startAt: string | Date;
  endAt: string | Date;
  pickupLocationId?: string | null;
  dropoffLocationId?: string | null;
  pickupLocationText: string;
  dropoffLocationText: string;
  pickupLocationType?: string | null;
  dropoffLocationType?: string | null;
  pickupLocationTextSnapshot?: string | null;
  dropoffLocationTextSnapshot?: string | null;
  bookingLocationDetails?: Record<string, unknown> | null;
  vehicleId: string;
  insuranceEnabled?: boolean;
  insurancePlanId?: string | null;
  promoCode?: string | null;
  tags?: string[];
  comments?: string | null;
  expiresAt?: string | Date | null;
  commissionPartnerName?: string | null;
  clientPaysAtPartner?: boolean;
  rackPriceCents?: number | null;
  deliverySelected?: boolean;
  deliveryZoneLabel?: string | null;
  createdByAdminUserId?: string | null;
};

export type UpdateAdminQuoteInput = {
  id: string;
  status?: string | null;
  expiresAt?: string | Date | null;
  tags?: string[];
  comments?: string | null;
  commissionPartnerName?: string | null;
  clientPaysAtPartner?: boolean;
  rackPriceCents?: number | null;
  vehicleId?: string | null;
  startAt?: string | Date;
  endAt?: string | Date;
  pickupLocationId?: string | null;
  dropoffLocationId?: string | null;
  pickupLocationText?: string;
  dropoffLocationText?: string;
  pickupLocationType?: string | null;
  dropoffLocationType?: string | null;
  pickupLocationTextSnapshot?: string | null;
  dropoffLocationTextSnapshot?: string | null;
  bookingLocationDetails?: Record<string, unknown> | null;
  insuranceEnabled?: boolean;
  insurancePlanId?: string | null;
  promoCode?: string | null;
  deliverySelected?: boolean;
  deliveryZoneLabel?: string | null;
  actorAdminUserId?: string | null;
};

export class AdminQuoteError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEARCH_LIMIT = 50;

function toIsoTimestamp(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(String(value ?? ""));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return String(value ?? "");
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(String(value ?? ""));
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeNullableText(value: unknown) {
  const text = normalizeText(value);
  return text.length > 0 ? text : null;
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim();
    if (!tag || tag.length > 40) continue;
    seen.add(tag);
    if (seen.size >= 20) break;
  }
  return [...seen];
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeInteger(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
}

function normalizeStatus(value: unknown): QuoteStatus | null {
  return normalizeQuoteStatus(value);
}

function normalizeSortBy(value: unknown): QuoteSortBy | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (QUOTE_SORT_COLUMNS.includes(normalized as QuoteSortBy)) {
    return normalized as QuoteSortBy;
  }
  return null;
}

function normalizeSortDir(value: unknown): SortDir | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "asc") return "asc";
  if (normalized === "desc") return "desc";
  return null;
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 20;
  return Math.min(parsed, SEARCH_LIMIT);
}

function normalizeCursor(value: unknown): QuoteCursor | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value.trim(), "base64url").toString("utf8"),
    ) as Partial<QuoteCursor>;
    if (!parsed || typeof parsed !== "object") return null;
    const id = normalizeText(parsed.id);
    const createdAt = normalizeText(parsed.createdAt);
    if (!id || !createdAt) return null;
    const offset = Number.isInteger(parsed.offset) && Number(parsed.offset) >= 0
      ? Number(parsed.offset)
      : 0;
    return { id, createdAt, offset };
  } catch {
    return null;
  }
}

function encodeCursor(cursor: QuoteCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function parseDateBoundary(value: unknown, boundary: "start" | "end") {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (DATE_ONLY_RE.test(trimmed)) {
    return boundary === "start"
      ? `${trimmed}T00:00:00.000Z`
      : `${trimmed}T23:59:59.999Z`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeUuidOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!UUID_REGEX.test(trimmed)) {
    throw new AdminQuoteError("INVALID_UUID", "Invalid UUID supplied.", 400);
  }
  return trimmed;
}

function mapListItem(row: QuoteRow): AdminQuoteListItem {
  const status = resolveEffectiveQuoteStatus(row.status, row.expires_at);
  return {
    id: row.id,
    publicId: normalizeText(row.public_id),
    createdAt: toIsoTimestamp(row.created_at),
    status,
    expiresAt: row.expires_at ? toIsoTimestamp(row.expires_at) : null,
    customerFullName: normalizeText(row.customer_full_name),
    customerEmail: normalizeText(row.customer_email),
    customerPhone: normalizeNullableText(row.customer_phone),
    startAt: toIsoTimestamp(row.start_at),
    endAt: toIsoTimestamp(row.end_at),
    pickupLocationText: normalizeText(row.pickup_location_text),
    dropoffLocationText: normalizeText(row.dropoff_location_text),
    vehicleId: normalizeNullableText(row.vehicle_id),
    vehicleLabel: normalizeText(row.vehicle_label),
    vehicleClass: normalizeNullableText(row.vehicle_class),
    baseTotalCents: Number(row.base_total_cents ?? 0),
    insuranceTotalCents: Number(row.insurance_total_cents ?? 0),
    discountTotalCents: Number(row.discount_total_cents ?? 0),
    subtotalCents: Number(row.subtotal_cents ?? 0),
    totalCents: Number(row.total_cents ?? 0),
    depositRequiredCents: Number(row.deposit_required_cents ?? 0),
    amountDueCents: Number(row.amount_due_cents ?? 0),
    promoCode: normalizeNullableText(row.promo_code),
    insuranceEnabled: normalizeBoolean(row.insurance_enabled),
    tags: Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === "string") : [],
    comments: normalizeNullableText(row.comments),
    commissionPartnerName: normalizeNullableText(row.commission_partner_name),
    clientPaysAtPartner: normalizeBoolean(row.client_pays_at_partner),
    rackPriceCents: row.rack_price_cents == null ? null : Number(row.rack_price_cents),
    lastEmailedAt: row.last_emailed_at ? toIsoTimestamp(row.last_emailed_at) : null,
  };
}

function mapDetailItem(row: QuoteRow): AdminQuoteDetailItem {
  const list = mapListItem(row);
  return {
    ...list,
    updatedAt: toIsoTimestamp(row.updated_at),
    pricingJson: row.pricing_json ?? {},
    pickupLocationId: normalizeNullableText(row.pickup_location_id),
    dropoffLocationId: normalizeNullableText(row.dropoff_location_id),
    insurancePlanId: normalizeNullableText(row.insurance_plan_id),
    createdByAdminUserId: normalizeNullableText(row.created_by_admin_user_id),
    lastEmailedTo: normalizeNullableText(row.last_emailed_to),
    convertedBookingId: normalizeNullableText(row.converted_booking_id),
  };
}

function rethrowPricingError(error: unknown): never {
  if (error instanceof QuotePricingError) {
    throw new AdminQuoteError(error.code, error.message, error.status);
  }
  throw error;
}

async function insertQuoteEvent(
  client: Queryable,
  input: {
    quoteId: string;
    eventType: "CREATED" | "UPDATED" | "EMAILED" | "STATUS_CHANGED" | "CONVERTED";
    actorAdminUserId?: string | null;
    meta?: Record<string, unknown>;
  },
) {
  await client.query(
    "insert into quote_events (quote_id, event_type, actor_admin_user_id, meta) values ($1, $2, $3::uuid, $4::jsonb)",
    [
      input.quoteId,
      input.eventType,
      input.actorAdminUserId ?? null,
      JSON.stringify(input.meta ?? {}),
    ],
  );
}

export function normalizeQuoteSort(searchParams: URLSearchParams): QuoteSortState {
  const sort = readSortFromSearchParams(searchParams, {
    allowedSortBy: QUOTE_SORT_COLUMNS,
    defaultSortBy: "created",
    defaultSortDir: "desc",
  });

  return {
    sortBy: (sort.sortBy as QuoteSortBy | undefined) ?? "created",
    sortDir: (sort.sortDir as SortDir | undefined) ?? "desc",
  };
}

export function quoteWindowsOverlap(input: {
  quoteStartAt: string | Date;
  quoteEndAt: string | Date;
  rentalFrom: string | Date;
  rentalTo: string | Date;
}) {
  const quoteStart = toDate(input.quoteStartAt);
  const quoteEnd = toDate(input.quoteEndAt);
  const rentalFrom = toDate(input.rentalFrom);
  const rentalTo = toDate(input.rentalTo);
  if (!quoteStart || !quoteEnd || !rentalFrom || !rentalTo) return false;
  return quoteStart < rentalTo && quoteEnd > rentalFrom;
}

export async function fetchAdminQuotesPage(input: FetchAdminQuotesInput): Promise<AdminQuotesPage> {
  const limit = normalizeLimit(input.limit);
  const cursor = normalizeCursor(input.cursor);
  const offset = cursor?.offset ?? 0;
  const status = normalizeStatus(input.status);
  const sortBy = normalizeSortBy(input.sortBy) ?? "created";
  const sortDir = normalizeSortDir(input.sortDir) ?? "desc";
  const q = normalizeText(input.q);

  const createdFrom = parseDateBoundary(input.createdFrom, "start");
  const createdTo = parseDateBoundary(input.createdTo, "end");
  if ((input.createdFrom && !createdFrom) || (input.createdTo && !createdTo)) {
    throw new AdminQuoteError("INVALID_CREATED_RANGE", "Invalid created date range.", 400);
  }

  const rentalFrom = parseDateBoundary(input.rentalFrom, "start");
  const rentalTo = parseDateBoundary(input.rentalTo, "end");
  if ((input.rentalFrom && !rentalFrom) || (input.rentalTo && !rentalTo)) {
    throw new AdminQuoteError("INVALID_RENTAL_RANGE", "Invalid rental date range.", 400);
  }
  if ((rentalFrom && !rentalTo) || (!rentalFrom && rentalTo)) {
    throw new AdminQuoteError(
      "INVALID_RENTAL_RANGE",
      "Both rentalFrom and rentalTo are required for overlap filtering.",
      400,
    );
  }

  const whereClauses: string[] = [];
  const values: Array<string | number> = [];
  let paramIndex = 1;

  if (status === "EXPIRED") {
    whereClauses.push(
      "(q.status = 'EXPIRED' or (q.status in ('DRAFT', 'SENT', 'ACCEPTED') and q.expires_at is not null and now() > q.expires_at))",
    );
  } else if (status === "DRAFT" || status === "SENT" || status === "ACCEPTED") {
    whereClauses.push(`(q.status = $${paramIndex} and (q.expires_at is null or now() <= q.expires_at))`);
    values.push(status);
    paramIndex += 1;
  } else if (status) {
    whereClauses.push(`q.status = $${paramIndex}`);
    values.push(status);
    paramIndex += 1;
  }

  if (q) {
    whereClauses.push(
      `(q.customer_full_name ilike $${paramIndex} or q.customer_email ilike $${paramIndex} or coalesce(q.customer_phone, '') ilike $${paramIndex} or q.id::text ilike $${paramIndex} or q.public_id ilike $${paramIndex})`,
    );
    values.push(`%${q}%`);
    paramIndex += 1;
  }

  if (createdFrom) {
    whereClauses.push(`q.created_at >= $${paramIndex}::timestamptz`);
    values.push(createdFrom);
    paramIndex += 1;
  }
  if (createdTo) {
    whereClauses.push(`q.created_at <= $${paramIndex}::timestamptz`);
    values.push(createdTo);
    paramIndex += 1;
  }

  if (rentalFrom && rentalTo) {
    whereClauses.push(
      `(q.start_at < $${paramIndex + 1}::timestamptz and q.end_at > $${paramIndex}::timestamptz)`,
    );
    values.push(rentalFrom, rentalTo);
    paramIndex += 2;
  }

  const whereSql = whereClauses.length > 0 ? ` where ${whereClauses.join(" and ")}` : "";
  const directionSql = sortDir === "asc" ? "asc" : "desc";
  const orderBySql =
    sortBy === "customer"
      ? `order by lower(q.customer_full_name) ${directionSql}, q.id::text ${directionSql}`
      : sortBy === "email"
        ? `order by lower(q.customer_email) ${directionSql}, q.id::text ${directionSql}`
        : sortBy === "pickup"
          ? `order by q.start_at ${directionSql}, q.id::text ${directionSql}`
          : sortBy === "return"
            ? `order by q.end_at ${directionSql}, q.id::text ${directionSql}`
            : sortBy === "vehicle"
              ? `order by lower(q.vehicle_label) ${directionSql}, q.id::text ${directionSql}`
              : sortBy === "total"
                ? `order by q.total_cents ${directionSql}, q.id::text ${directionSql}`
                : sortBy === "status"
                  ? `order by upper(q.status) ${directionSql}, q.id::text ${directionSql}`
                  : `order by q.created_at ${directionSql}, q.id::text ${directionSql}`;

  values.push(limit + 1);
  const limitIndex = values.length;
  values.push(offset);
  const offsetIndex = values.length;

  const rowsResult = await dbQuery<QuoteRow>(
    `select id, public_id, created_at, updated_at, status, expires_at, customer_full_name, customer_email, customer_phone, start_at, end_at, pickup_location_id, dropoff_location_id, pickup_location_text, dropoff_location_text, vehicle_id, vehicle_label, vehicle_class, pricing_json, base_total_cents, insurance_total_cents, discount_total_cents, subtotal_cents, total_cents, deposit_required_cents, amount_due_cents, promo_code, insurance_plan_id, insurance_enabled, tags, comments, commission_partner_name, client_pays_at_partner, rack_price_cents, created_by_admin_user_id, last_emailed_at, last_emailed_to, converted_booking_id from quotes q${whereSql} ${orderBySql} limit $${limitIndex} offset $${offsetIndex}`,
    values,
  );

  const countResult = await dbQuery<{ total_count: unknown }>(
    `select count(*)::int as total_count from quotes q${whereSql}`,
    values.slice(0, limitIndex - 1),
  );

  const hasMore = rowsResult.rows.length > limit;
  const visibleRows = hasMore ? rowsResult.rows.slice(0, limit) : rowsResult.rows;
  const nextCursor =
    hasMore && visibleRows.length > 0
      ? encodeCursor({
          id: visibleRows[visibleRows.length - 1].id,
          createdAt: toIsoTimestamp(visibleRows[visibleRows.length - 1].created_at),
          offset: offset + visibleRows.length,
        })
      : null;

  return {
    items: visibleRows.map(mapListItem),
    nextCursor,
    hasMore: Boolean(nextCursor),
    totalCount: Number(countResult.rows[0]?.total_count ?? 0),
    limit,
  };
}

export async function fetchAdminQuoteById(id: string) {
  if (!UUID_REGEX.test(id)) {
    throw new AdminQuoteError("INVALID_ID", "Invalid quote id.", 400);
  }

  const result = await dbQuery<QuoteRow>(
    "select id, public_id, created_at, updated_at, status, expires_at, customer_full_name, customer_email, customer_phone, start_at, end_at, pickup_location_id, dropoff_location_id, pickup_location_text, dropoff_location_text, vehicle_id, vehicle_label, vehicle_class, pricing_json, base_total_cents, insurance_total_cents, discount_total_cents, subtotal_cents, total_cents, deposit_required_cents, amount_due_cents, promo_code, insurance_plan_id, insurance_enabled, tags, comments, commission_partner_name, client_pays_at_partner, rack_price_cents, created_by_admin_user_id, last_emailed_at, last_emailed_to, converted_booking_id from quotes where id = $1 limit 1",
    [id],
  );

  const row = result.rows[0];
  return row ? mapDetailItem(row) : null;
}

function requireValidCreateInput(input: CreateAdminQuoteInput) {
  if (!isNonEmptyString(input.customerFullName, 2)) {
    throw new AdminQuoteError("INVALID_CUSTOMER_NAME", "Customer full name is required.", 400);
  }

  const email = normalizeText(input.customerEmail).toLowerCase();
  if (!isEmail(email)) {
    throw new AdminQuoteError("INVALID_CUSTOMER_EMAIL", "Customer email is invalid.", 400);
  }

  if (!UUID_REGEX.test(input.vehicleId)) {
    throw new AdminQuoteError("INVALID_VEHICLE_ID", "Vehicle id is invalid.", 400);
  }
}

async function ensureVehicleAvailability(input: {
  vehicleId: string;
  startAt: Date;
  endAt: Date;
  client: Queryable;
}) {
  const result = await isVehicleUnavailableWithAvailabilityRules(
    {
      vehicleId: input.vehicleId,
      startAt: input.startAt.toISOString(),
      endAt: input.endAt.toISOString(),
    },
    { client: input.client, includeBlockouts: true },
  );

  if (result.unavailable) {
    const message =
      result.reasons[0] ??
      "Vehicle unavailable for the selected rental window.";
    throw new AdminQuoteError(
      "VEHICLE_UNAVAILABLE",
      message,
      409,
    );
  }
}

function normalizeExpiresAt(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = toDate(value);
  if (!date) {
    throw new AdminQuoteError("INVALID_EXPIRES_AT", "Invalid expiry date.", 400);
  }
  return date.toISOString();
}

function normalizePricingSummary(snapshot: QuotePricingSnapshot) {
  return {
    pricing_json: snapshot.pricingJson,
    base_total_cents: snapshot.summary.baseTotalCents,
    insurance_total_cents: snapshot.summary.insuranceTotalCents,
    discount_total_cents: snapshot.summary.discountTotalCents,
    subtotal_cents: snapshot.summary.subtotalCents,
    total_cents: snapshot.summary.totalCents,
    deposit_required_cents: snapshot.summary.depositRequiredCents,
    amount_due_cents: snapshot.summary.amountDueCents,
    promo_code: snapshot.promoCode,
    insurance_plan_id: snapshot.insurancePlanId,
    insurance_enabled: snapshot.insuranceEnabled,
    vehicle_label: snapshot.vehicleLabel,
    vehicle_class: snapshot.vehicleClass,
    rack_price_cents: snapshot.rackPriceCents,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readPricingBoolean(pricing: unknown, key: string, fallback = false) {
  const value = asRecord(pricing)[key];
  return normalizeBoolean(value, fallback);
}

function readPricingText(pricing: unknown, key: string, fallback: string | null = null) {
  const value = normalizeNullableText(asRecord(pricing)[key]);
  return value ?? fallback;
}

function buildLocationDefaultsFromDate(date: Date) {
  const iso = date.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
  };
}

function readLocationDetailsObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function buildQuoteLocationSelection(input: {
  client: Queryable;
  startAt: Date;
  endAt: Date;
  pickupLocationId?: string | null;
  dropoffLocationId?: string | null;
  pickupLocationText?: string | null;
  dropoffLocationText?: string | null;
  pickupLocationType?: string | null;
  dropoffLocationType?: string | null;
  bookingLocationDetails?: Record<string, unknown> | null;
  existingPricingJson?: Record<string, unknown> | null;
}) {
  let configs: BookingLocationConfig[];
  try {
    configs = await listActiveBookingLocationConfigs(input.client);
  } catch (error) {
    const schemaError = toBookingLocationConfigSchemaError(error);
    if (schemaError) {
      throw new AdminQuoteError(schemaError.code, schemaError.message, schemaError.status);
    }
    throw error;
  }
  const pickupDefaults = buildLocationDefaultsFromDate(input.startAt);
  const dropoffDefaults = buildLocationDefaultsFromDate(input.endAt);
  const currentDetails = readBookingLocationDetails(input.existingPricingJson ?? {}, {
    pickupLabel: input.pickupLocationText ?? null,
    dropoffLabel: input.dropoffLocationText ?? null,
    pickupLocationId: input.pickupLocationId ?? null,
    dropoffLocationId: input.dropoffLocationId ?? null,
  });
  const rawDetails = readLocationDetailsObject(input.bookingLocationDetails);
  const pickupRaw = readLocationDetailsObject(rawDetails?.pickup);
  const dropoffRaw = readLocationDetailsObject(rawDetails?.dropoff);

  const pickupTypeKey =
    normalizeText(input.pickupLocationType).toUpperCase() ||
    currentDetails.pickup.typeKey ||
    inferBookingLocationType({ label: input.pickupLocationText ?? null }) ||
    "OFFICE";
  const dropoffTypeKey =
    normalizeText(input.dropoffLocationType).toUpperCase() ||
    currentDetails.dropoff.typeKey ||
    inferBookingLocationType({ label: input.dropoffLocationText ?? null }) ||
    pickupTypeKey;

  const locationSelection = buildBookingLocationSelectionPayload({
    configs,
    pickupTypeKey,
    dropoffTypeKey,
    pickupLocationId: normalizeUuidOrNull(input.pickupLocationId) ?? currentDetails.pickup.locationId,
    dropoffLocationId: normalizeUuidOrNull(input.dropoffLocationId) ?? currentDetails.dropoff.locationId,
    pickupValues: normalizeBookingLocationFieldValuesInput(pickupRaw?.values, {
      ...currentDetails.pickup.values,
      address:
        pickupTypeKey === "CUSTOM_ADDRESS"
          ? normalizeText(input.pickupLocationText) || currentDetails.pickup.values.address || null
          : currentDetails.pickup.values.address ?? null,
    }),
    dropoffValues: normalizeBookingLocationFieldValuesInput(dropoffRaw?.values, {
      ...currentDetails.dropoff.values,
      address:
        dropoffTypeKey === "CUSTOM_ADDRESS"
          ? normalizeText(input.dropoffLocationText) || currentDetails.dropoff.values.address || null
          : currentDetails.dropoff.values.address ?? null,
    }),
    context: {
      pickupDate: pickupDefaults.date,
      pickupTime: pickupDefaults.time,
      dropoffDate: dropoffDefaults.date,
      dropoffTime: dropoffDefaults.time,
    },
  });

  const pickupError = validateBookingLocationSelection(
    locationSelection.pickupConfig,
    "pickup",
    locationSelection.pickupValues,
  );
  if (pickupError) {
    throw new AdminQuoteError("INVALID_PICKUP_LOCATION", pickupError, 400);
  }

  const dropoffError = validateBookingLocationSelection(
    locationSelection.dropoffConfig,
    "dropoff",
    locationSelection.dropoffValues,
  );
  if (dropoffError) {
    throw new AdminQuoteError("INVALID_DROPOFF_LOCATION", dropoffError, 400);
  }

  return locationSelection;
}

export async function createAdminQuote(input: CreateAdminQuoteInput) {
  requireValidCreateInput(input);

  const startAt = toDate(input.startAt);
  const endAt = toDate(input.endAt);
  if (!startAt || !endAt || endAt <= startAt) {
    throw new AdminQuoteError(
      "INVALID_WINDOW",
      "Return date and time must be later than pickup date and time.",
      400,
    );
  }

  const email = normalizeText(input.customerEmail).toLowerCase();
  const customerPhone = normalizeNullableText(input.customerPhone);
  const tags = normalizeTags(input.tags);
  const comments = normalizeNullableText(input.comments);
  const expiresAt = normalizeExpiresAt(input.expiresAt);
  const commissionPartnerName = normalizeNullableText(input.commissionPartnerName);
  const clientPaysAtPartner = normalizeBoolean(input.clientPaysAtPartner);
  const rackPriceCents = normalizeInteger(input.rackPriceCents);

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const locationSelection = await buildQuoteLocationSelection({
      client,
      startAt,
      endAt,
      pickupLocationId: input.pickupLocationId ?? null,
      dropoffLocationId: input.dropoffLocationId ?? null,
      pickupLocationText:
        input.pickupLocationTextSnapshot ?? input.pickupLocationText ?? null,
      dropoffLocationText:
        input.dropoffLocationTextSnapshot ?? input.dropoffLocationText ?? null,
      pickupLocationType: input.pickupLocationType ?? null,
      dropoffLocationType: input.dropoffLocationType ?? null,
      bookingLocationDetails: input.bookingLocationDetails ?? null,
    });

    await ensureVehicleAvailability({
      vehicleId: input.vehicleId,
      startAt,
      endAt,
      client,
    });

    let pricingSnapshot: QuotePricingSnapshot;
    try {
      pricingSnapshot = await buildQuotePricingSnapshot(
        {
          vehicleId: input.vehicleId,
          startAt,
          endAt,
          insuranceEnabled: input.insuranceEnabled,
          insurancePlanId: input.insurancePlanId,
            promoCode: input.promoCode,
            customerEmail: email,
            rackPriceCents,
            deliverySelected: input.deliverySelected,
            deliveryZoneLabel: input.deliveryZoneLabel,
          },
          { client },
        );
    } catch (error) {
      rethrowPricingError(error);
    }

    const pricing = normalizePricingSummary(pricingSnapshot);
    const nextPricingJson = {
      ...(pricing.pricing_json ?? {}),
      booking_location_details: locationSelection.details,
    };

    const insertResult = await client.query(
      "insert into quotes (status, expires_at, customer_full_name, customer_email, customer_phone, start_at, end_at, pickup_location_id, dropoff_location_id, pickup_location_text, dropoff_location_text, vehicle_id, vehicle_label, vehicle_class, pricing_json, base_total_cents, insurance_total_cents, discount_total_cents, subtotal_cents, total_cents, deposit_required_cents, amount_due_cents, promo_code, insurance_plan_id, insurance_enabled, tags, comments, commission_partner_name, client_pays_at_partner, rack_price_cents, created_by_admin_user_id) values ('DRAFT', $1::timestamptz, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::uuid, $8::uuid, $9, $10, $11::uuid, $12, $13, $14::jsonb, $15, $16, $17, $18, $19, $20, $21, $22, $23::uuid, $24, $25::text[], $26, $27, $28, $29, $30::uuid) returning id, public_id, created_at, updated_at, status, expires_at, customer_full_name, customer_email, customer_phone, start_at, end_at, pickup_location_id, dropoff_location_id, pickup_location_text, dropoff_location_text, vehicle_id, vehicle_label, vehicle_class, pricing_json, base_total_cents, insurance_total_cents, discount_total_cents, subtotal_cents, total_cents, deposit_required_cents, amount_due_cents, promo_code, insurance_plan_id, insurance_enabled, tags, comments, commission_partner_name, client_pays_at_partner, rack_price_cents, created_by_admin_user_id, last_emailed_at, last_emailed_to, converted_booking_id",
      [
        expiresAt,
        normalizeText(input.customerFullName),
        email,
        customerPhone,
        startAt.toISOString(),
        endAt.toISOString(),
        locationSelection.pickupConfig?.id ?? normalizeUuidOrNull(input.pickupLocationId),
        locationSelection.dropoffConfig?.id ?? normalizeUuidOrNull(input.dropoffLocationId),
        locationSelection.pickupLocationTextSnapshot,
        locationSelection.dropoffLocationTextSnapshot,
        input.vehicleId,
        pricing.vehicle_label,
        pricing.vehicle_class,
        JSON.stringify(nextPricingJson),
        pricing.base_total_cents,
        pricing.insurance_total_cents,
        pricing.discount_total_cents,
        pricing.subtotal_cents,
        pricing.total_cents,
        pricing.deposit_required_cents,
        pricing.amount_due_cents,
        pricing.promo_code,
        pricing.insurance_plan_id,
        pricing.insurance_enabled,
        tags,
        comments,
        commissionPartnerName,
        clientPaysAtPartner,
        pricing.rack_price_cents,
        normalizeUuidOrNull(input.createdByAdminUserId),
      ],
    );

    const inserted = insertResult.rows[0] as QuoteRow | undefined;
    if (!inserted) {
      throw new AdminQuoteError("CREATE_FAILED", "Failed to create quote.", 500);
    }

    await insertQuoteEvent(client, {
      quoteId: inserted.id,
      eventType: "CREATED",
      actorAdminUserId: normalizeUuidOrNull(input.createdByAdminUserId),
      meta: {
        status: inserted.status,
      },
    });

    await client.query("commit");
    return mapDetailItem(inserted);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function hasPricingImpact(input: UpdateAdminQuoteInput) {
  return (
    input.vehicleId !== undefined ||
    input.startAt !== undefined ||
    input.endAt !== undefined ||
    input.insuranceEnabled !== undefined ||
    input.insurancePlanId !== undefined ||
    input.promoCode !== undefined ||
    input.rackPriceCents !== undefined ||
    input.deliverySelected !== undefined ||
    input.deliveryZoneLabel !== undefined
  );
}

function hasStatusChange(previousStatus: string, nextStatus: string) {
  return String(previousStatus).trim().toUpperCase() !== String(nextStatus).trim().toUpperCase();
}

export function assertAdminQuoteMutable(input: {
  status: string;
  expiresAt?: string | Date | null;
  convertedBookingId?: string | null;
}) {
  const effectiveStatus = resolveEffectiveQuoteStatus(input.status, input.expiresAt);
  if (input.convertedBookingId || effectiveStatus === "CONVERTED") {
    throw new AdminQuoteError(
      "QUOTE_IMMUTABLE",
      "Converted quotes are read-only. Update the booking instead.",
      409,
    );
  }
}

export async function updateAdminQuote(input: UpdateAdminQuoteInput) {
  if (!UUID_REGEX.test(input.id)) {
    throw new AdminQuoteError("INVALID_ID", "Invalid quote id.", 400);
  }

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      "select id, public_id, created_at, updated_at, status, expires_at, customer_full_name, customer_email, customer_phone, start_at, end_at, pickup_location_id, dropoff_location_id, pickup_location_text, dropoff_location_text, vehicle_id, vehicle_label, vehicle_class, pricing_json, base_total_cents, insurance_total_cents, discount_total_cents, subtotal_cents, total_cents, deposit_required_cents, amount_due_cents, promo_code, insurance_plan_id, insurance_enabled, tags, comments, commission_partner_name, client_pays_at_partner, rack_price_cents, created_by_admin_user_id, last_emailed_at, last_emailed_to, converted_booking_id from quotes where id = $1 for update",
      [input.id],
    );

    const existing = existingResult.rows[0] as QuoteRow | undefined;
    if (!existing) {
      await client.query("rollback");
      return null;
    }

    const existingStatus = normalizeStatus(existing.status) ?? "DRAFT";
    const effectiveExistingStatus = resolveEffectiveQuoteStatus(existingStatus, existing.expires_at);
    assertAdminQuoteMutable({
      status: effectiveExistingStatus,
      expiresAt: existing.expires_at,
      convertedBookingId: existing.converted_booking_id,
    });
    const requestedStatus = input.status !== undefined ? normalizeStatus(input.status) : null;
    if (input.status !== undefined && !requestedStatus) {
      throw new AdminQuoteError("INVALID_STATUS", "Invalid quote status.", 400);
    }
    const nextStatus = requestedStatus ?? existingStatus;

    if (requestedStatus) {
      const transitionError = getQuoteStatusTransitionError(effectiveExistingStatus, requestedStatus);
      if (transitionError) {
        throw new AdminQuoteError("INVALID_STATUS_TRANSITION", transitionError, 400);
      }
    }

    const nextStartAt = input.startAt !== undefined ? toDate(input.startAt) : toDate(existing.start_at);
    const nextEndAt = input.endAt !== undefined ? toDate(input.endAt) : toDate(existing.end_at);
    if (!nextStartAt || !nextEndAt || nextEndAt <= nextStartAt) {
      throw new AdminQuoteError(
        "INVALID_WINDOW",
        "Return date and time must be later than pickup date and time.",
        400,
      );
    }

    const nextVehicleId = input.vehicleId !== undefined
      ? normalizeUuidOrNull(input.vehicleId)
      : normalizeUuidOrNull(existing.vehicle_id);
    if (!nextVehicleId) {
      throw new AdminQuoteError("INVALID_VEHICLE_ID", "Vehicle id is required.", 400);
    }

    const nextCustomerEmail = normalizeText(existing.customer_email).toLowerCase();
    const locationSelection = await buildQuoteLocationSelection({
      client,
      startAt: nextStartAt,
      endAt: nextEndAt,
      pickupLocationId:
        input.pickupLocationId !== undefined
          ? input.pickupLocationId
          : normalizeUuidOrNull(existing.pickup_location_id),
      dropoffLocationId:
        input.dropoffLocationId !== undefined
          ? input.dropoffLocationId
          : normalizeUuidOrNull(existing.dropoff_location_id),
      pickupLocationText:
        input.pickupLocationTextSnapshot ??
        input.pickupLocationText ??
        normalizeText(existing.pickup_location_text),
      dropoffLocationText:
        input.dropoffLocationTextSnapshot ??
        input.dropoffLocationText ??
        normalizeText(existing.dropoff_location_text),
      pickupLocationType: input.pickupLocationType ?? null,
      dropoffLocationType: input.dropoffLocationType ?? null,
      bookingLocationDetails: input.bookingLocationDetails ?? null,
      existingPricingJson: existing.pricing_json,
    });
    const nextPickupLocationId = locationSelection.pickupConfig?.id ?? normalizeUuidOrNull(existing.pickup_location_id);
    const nextDropoffLocationId = locationSelection.dropoffConfig?.id ?? normalizeUuidOrNull(existing.dropoff_location_id);
    const nextPickupLocationText = locationSelection.pickupLocationTextSnapshot;
    const nextDropoffLocationText = locationSelection.dropoffLocationTextSnapshot;

    const nextExpiresAt =
      input.expiresAt !== undefined
        ? normalizeExpiresAt(input.expiresAt)
        : existing.expires_at
          ? toIsoTimestamp(existing.expires_at)
          : null;

    const nextTags = input.tags !== undefined ? normalizeTags(input.tags) : normalizeTags(existing.tags);
    const nextComments =
      input.comments !== undefined ? normalizeNullableText(input.comments) : normalizeNullableText(existing.comments);
    const nextCommissionPartnerName =
      input.commissionPartnerName !== undefined
        ? normalizeNullableText(input.commissionPartnerName)
        : normalizeNullableText(existing.commission_partner_name);
    const nextClientPaysAtPartner =
      input.clientPaysAtPartner !== undefined
        ? normalizeBoolean(input.clientPaysAtPartner)
        : normalizeBoolean(existing.client_pays_at_partner);

    let pricingJson = existing.pricing_json;
    let baseTotalCents = Number(existing.base_total_cents ?? 0);
    let insuranceTotalCents = Number(existing.insurance_total_cents ?? 0);
    let discountTotalCents = Number(existing.discount_total_cents ?? 0);
    let subtotalCents = Number(existing.subtotal_cents ?? 0);
    let totalCents = Number(existing.total_cents ?? 0);
    let depositRequiredCents = Number(existing.deposit_required_cents ?? 0);
    let amountDueCents = Number(existing.amount_due_cents ?? 0);
    let promoCode = normalizeNullableText(existing.promo_code);
    let insurancePlanId = normalizeUuidOrNull(existing.insurance_plan_id);
    let insuranceEnabled = normalizeBoolean(existing.insurance_enabled);
    let deliverySelected = readPricingBoolean(existing.pricing_json, "delivery_selected");
    let deliveryZoneLabel = readPricingText(existing.pricing_json, "delivery_zone_label");
    let vehicleLabel = normalizeText(existing.vehicle_label);
    let vehicleClass = normalizeNullableText(existing.vehicle_class);
    let rackPriceCents = existing.rack_price_cents == null ? null : Number(existing.rack_price_cents);

    if (hasPricingImpact(input)) {
      await ensureVehicleAvailability({
        vehicleId: nextVehicleId,
        startAt: nextStartAt,
        endAt: nextEndAt,
        client,
      });

      let pricingSnapshot: QuotePricingSnapshot;
      try {
        pricingSnapshot = await buildQuotePricingSnapshot(
          {
            vehicleId: nextVehicleId,
            startAt: nextStartAt,
            endAt: nextEndAt,
            insuranceEnabled:
              input.insuranceEnabled !== undefined ? input.insuranceEnabled : insuranceEnabled,
            insurancePlanId:
              input.insurancePlanId !== undefined ? input.insurancePlanId : insurancePlanId,
            promoCode: input.promoCode !== undefined ? input.promoCode : promoCode,
            customerEmail: nextCustomerEmail,
            rackPriceCents:
              input.rackPriceCents !== undefined
                ? normalizeInteger(input.rackPriceCents)
                : rackPriceCents,
            deliverySelected:
              input.deliverySelected !== undefined ? normalizeBoolean(input.deliverySelected) : deliverySelected,
            deliveryZoneLabel:
              input.deliveryZoneLabel !== undefined
                ? normalizeNullableText(input.deliveryZoneLabel)
                : deliveryZoneLabel,
          },
          { client },
        );
      } catch (error) {
        rethrowPricingError(error);
      }

      const summary = normalizePricingSummary(pricingSnapshot);
      pricingJson = {
        ...(summary.pricing_json ?? {}),
        booking_location_details: locationSelection.details,
      };
      baseTotalCents = summary.base_total_cents;
      insuranceTotalCents = summary.insurance_total_cents;
      discountTotalCents = summary.discount_total_cents;
      subtotalCents = summary.subtotal_cents;
      totalCents = summary.total_cents;
      depositRequiredCents = summary.deposit_required_cents;
      amountDueCents = summary.amount_due_cents;
      promoCode = normalizeNullableText(summary.promo_code);
      insurancePlanId = normalizeUuidOrNull(summary.insurance_plan_id);
      insuranceEnabled = normalizeBoolean(summary.insurance_enabled);
      deliverySelected = readPricingBoolean(summary.pricing_json, "delivery_selected", deliverySelected);
      deliveryZoneLabel = readPricingText(summary.pricing_json, "delivery_zone_label", deliveryZoneLabel);
      vehicleLabel = normalizeText(summary.vehicle_label);
      vehicleClass = normalizeNullableText(summary.vehicle_class);
      rackPriceCents = summary.rack_price_cents == null ? null : Number(summary.rack_price_cents);
    } else {
      pricingJson = {
        ...(pricingJson ?? {}),
        booking_location_details: locationSelection.details,
      };
    }

    const updateResult = await client.query(
      "update quotes set status = $2, expires_at = $3::timestamptz, start_at = $4::timestamptz, end_at = $5::timestamptz, pickup_location_id = $6::uuid, dropoff_location_id = $7::uuid, pickup_location_text = $8, dropoff_location_text = $9, vehicle_id = $10::uuid, vehicle_label = $11, vehicle_class = $12, pricing_json = $13::jsonb, base_total_cents = $14, insurance_total_cents = $15, discount_total_cents = $16, subtotal_cents = $17, total_cents = $18, deposit_required_cents = $19, amount_due_cents = $20, promo_code = $21, insurance_plan_id = $22::uuid, insurance_enabled = $23, tags = $24::text[], comments = $25, commission_partner_name = $26, client_pays_at_partner = $27, rack_price_cents = $28, updated_at = now() where id = $1 returning id, public_id, created_at, updated_at, status, expires_at, customer_full_name, customer_email, customer_phone, start_at, end_at, pickup_location_id, dropoff_location_id, pickup_location_text, dropoff_location_text, vehicle_id, vehicle_label, vehicle_class, pricing_json, base_total_cents, insurance_total_cents, discount_total_cents, subtotal_cents, total_cents, deposit_required_cents, amount_due_cents, promo_code, insurance_plan_id, insurance_enabled, tags, comments, commission_partner_name, client_pays_at_partner, rack_price_cents, created_by_admin_user_id, last_emailed_at, last_emailed_to, converted_booking_id",
      [
        input.id,
        nextStatus,
        nextExpiresAt,
        nextStartAt.toISOString(),
        nextEndAt.toISOString(),
        nextPickupLocationId,
        nextDropoffLocationId,
        nextPickupLocationText,
        nextDropoffLocationText,
        nextVehicleId,
        vehicleLabel,
        vehicleClass,
        JSON.stringify(pricingJson ?? {}),
        baseTotalCents,
        insuranceTotalCents,
        discountTotalCents,
        subtotalCents,
        totalCents,
        depositRequiredCents,
        amountDueCents,
        promoCode,
        insurancePlanId,
        insuranceEnabled,
        nextTags,
        nextComments,
        nextCommissionPartnerName,
        nextClientPaysAtPartner,
        rackPriceCents,
      ],
    );

    const updated = updateResult.rows[0] as QuoteRow | undefined;
    if (!updated) {
      throw new AdminQuoteError("UPDATE_FAILED", "Failed to update quote.", 500);
    }

    const actorAdminUserId = normalizeUuidOrNull(input.actorAdminUserId);

    await insertQuoteEvent(client, {
      quoteId: input.id,
      eventType: "UPDATED",
      actorAdminUserId,
      meta: {
        repriced: hasPricingImpact(input),
      },
    });

    if (hasStatusChange(effectiveExistingStatus, nextStatus)) {
      await insertQuoteEvent(client, {
        quoteId: input.id,
        eventType: "STATUS_CHANGED",
        actorAdminUserId,
        meta: {
          fromStatus: effectiveExistingStatus,
          toStatus: nextStatus,
        },
      });
    }

    await client.query("commit");
    return mapDetailItem(updated);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function isQuotesMissingTableError(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "").toUpperCase();
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return code === "42P01" && (message.includes("quotes") || message.includes("quote_events"));
}
