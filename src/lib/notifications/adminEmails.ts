import { dbQuery } from "@/lib/db";
import {
  sendContactMessageCreatedAlert,
  sendContactMessagesDigestAlert,
} from "@/lib/notifications/contactMessageAlert";
import {
  sendAdminUserWelcomeEmail,
  sendBookingCancelledByBlockoutEmail,
  sendBookingCreatedEmail,
  sendBookingNoteEmail,
  sendBookingOverriddenByPaidBookingEmail,
  sendDepositReceiptEmail,
  sendDropoffReminderEmail,
  sendLateDropoffAlertEmail,
  sendOperationalAlertEmail,
  sendPaymentCompleteEmail,
  sendPickupConfirmedEmail,
  sendPaymentUpdateEmail,
  sendPickupReminderEmail,
} from "@/lib/notifications/email";
import { readPromoPricingFields } from "@/lib/payments/pricing";
import {
  buildQuoteEmailContent,
  buildQuotePdfBuffer,
  fetchQuoteByIdForOps,
  insertQuoteEvent,
  recordQuoteEmailLog,
  sendQuoteEmailWithAttachment,
  updateQuoteLastEmailed,
} from "@/lib/quotes/quoteOps";

export const ADMIN_EMAIL_SORT_COLUMNS = [
  "created",
  "lastEvent",
  "recipient",
  "emailType",
  "status",
] as const;

export type AdminEmailSortBy = (typeof ADMIN_EMAIL_SORT_COLUMNS)[number];
export type AdminEmailSortDir = "asc" | "desc";
export type AdminEmailRecordKind = "dispatch" | "quote_legacy" | "notification_dispatch_legacy";

export type AdminEmailListItem = {
  id: string;
  kind: AdminEmailRecordKind;
  rawId: string;
  status: string;
  sentAt: string | null;
  lastEventAt: string | null;
  createdAt: string;
  recipientName: string | null;
  recipientEmail: string | null;
  subject: string | null;
  emailType: string;
  entityType: string | null;
  entityId: string | null;
  entityPublicId: string | null;
  triggerSource: string | null;
  relatedTransactionType: string | null;
  relatedTransactionId: string | null;
  providerMessageId: string | null;
  triggeredByUserId: string | null;
  triggeredByName: string | null;
  lastError: string | null;
  manualResendAllowed: boolean;
};

export type AdminEmailSummary = {
  total: number;
  failed: number;
  bouncedOrIssue: number;
  pendingOrUnknown: number;
};

export type AdminEmailsPage = {
  items: AdminEmailListItem[];
  totalCount: number;
  page: number;
  rowsPerPage: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  from: number;
  to: number;
  summary: AdminEmailSummary;
};

export type AdminEmailEventItem = {
  id: string;
  source: string;
  eventType: string;
  status: string | null;
  occurredAt: string;
  createdAt: string;
  details: Record<string, unknown>;
};

export type AdminEmailDetail = AdminEmailListItem & {
  metadata: Record<string, unknown>;
  events: AdminEmailEventItem[];
};

type FetchAdminEmailsInput = {
  status?: string | null;
  emailType?: string | null;
  entityType?: string | null;
  triggerSource?: string | null;
  q?: string | null;
  sortBy?: string | null;
  sortDir?: string | null;
  limit?: unknown;
  offset?: unknown;
  page?: unknown;
  dateFrom?: string | null;
  dateTo?: string | null;
};

type CombinedEmailRow = {
  id: string;
  kind: AdminEmailRecordKind;
  raw_id: string;
  status: string;
  sent_at: string | null;
  last_event_at: string | null;
  created_at: string;
  recipient_name: string | null;
  recipient_email: string | null;
  subject: string | null;
  email_type: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_public_id: string | null;
  trigger_source: string | null;
  related_transaction_type: string | null;
  related_transaction_id: string | null;
  provider_message_id: string | null;
  triggered_by_user_id: string | null;
  triggered_by_name: string | null;
  last_error: string | null;
  manual_resend_allowed: boolean;
};

type DispatchDetailRow = {
  raw_id: string;
  status: string;
  sent_at: string | null;
  last_event_at: string | null;
  created_at: string;
  recipient_name: string | null;
  recipient_email: string;
  subject: string;
  email_type: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_public_id: string | null;
  trigger_source: string;
  related_transaction_type: string | null;
  related_transaction_id: string | null;
  provider_message_id: string | null;
  triggered_by_user_id: string | null;
  triggered_by_name: string | null;
  last_error: string | null;
  manual_resend_allowed: boolean;
  metadata_json: Record<string, unknown>;
};

type EmailDispatchEventRow = {
  id: string;
  source: string;
  event_type: string;
  status: string | null;
  occurred_at: string | Date;
  created_at: string | Date;
  details_json: Record<string, unknown>;
};

type LegacyQuoteDetailRow = {
  id: string;
  quote_id: string;
  quote_public_id: string | null;
  customer_full_name: string;
  to_email: string;
  subject: string;
  status: string;
  provider_message_id: string | null;
  error: string | null;
  created_at: string | Date;
};

type LegacyNotificationDispatchDetailRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_public_id: string | null;
  event_type: string;
  provider: string | null;
  provider_message_id: string | null;
  status: string;
  error: string | null;
  created_at: string | Date;
};

type BookingEmailContextRow = {
  id: string;
  public_id: string | null;
  start_date: string;
  end_date: string;
  pickup_location: string;
  customer_phone_snapshot: string | null;
  payment_option: string | null;
  pricing_json: Record<string, unknown> | null;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  daily_rate_cents: number;
  deposit_cents: number;
};

type ContactMessageDetailRow = {
  id: string;
  created_at: string;
  name: string;
  email: string;
  message: string;
  source: string | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableText(value: unknown) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeIdentifierFilter(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;

  return text
    .toLowerCase()
    .replace(/[.\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSortBy(value: string | null | undefined): AdminEmailSortBy {
  return ADMIN_EMAIL_SORT_COLUMNS.includes(value as AdminEmailSortBy)
    ? (value as AdminEmailSortBy)
    : "lastEvent";
}

function normalizeSortDir(value: string | null | undefined): AdminEmailSortDir {
  return value === "asc" ? "asc" : "desc";
}

function normalizeRowsPerPage(value: unknown) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0 && numeric <= 100) return numeric;
  return 20;
}

function normalizePage(value: unknown) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  return 1;
}

function isDateOnly(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function encodeEmailRecordId(kind: AdminEmailRecordKind, rawId: string) {
  return `${kind}:${rawId}`;
}

export function decodeEmailRecordId(value: string) {
  const rawValue = String(value || "");
  let decodedValue = rawValue;
  try {
    decodedValue = decodeURIComponent(rawValue);
  } catch {
    decodedValue = rawValue;
  }

  const [kind, ...rest] = decodedValue.split(":");
  const rawId = rest.join(":").trim();
  if (!rawId) return null;
  if (kind === "dispatch" || kind === "quote_legacy" || kind === "notification_dispatch_legacy") {
    return { kind, rawId } as const;
  }
  return null;
}

function mapCombinedRow(row: CombinedEmailRow): AdminEmailListItem {
  return {
    id: row.id,
    kind: row.kind,
    rawId: row.raw_id,
    status: row.status,
    sentAt: row.sent_at,
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    emailType: row.email_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityPublicId: row.entity_public_id,
    triggerSource: row.trigger_source,
    relatedTransactionType: row.related_transaction_type,
    relatedTransactionId: row.related_transaction_id,
    providerMessageId: row.provider_message_id,
    triggeredByUserId: row.triggered_by_user_id,
    triggeredByName: row.triggered_by_name,
    lastError: row.last_error,
    manualResendAllowed: row.manual_resend_allowed,
  };
}

function baseCombinedSql() {
  return `
    with combined as (
      select
        'dispatch:' || ed.id::text as id,
        'dispatch'::text as kind,
        ed.id::text as raw_id,
        ed.status,
        ed.sent_at::text as sent_at,
        ed.last_event_at::text as last_event_at,
        ed.created_at::text as created_at,
        ed.recipient_name,
        ed.to_email as recipient_email,
        ed.subject,
        ed.email_type,
        ed.entity_type,
        ed.entity_id::text as entity_id,
        ed.entity_public_id,
        ed.trigger_source,
        ed.related_transaction_type,
        ed.related_transaction_id,
        ed.provider_message_id,
        ed.triggered_by_user_id::text as triggered_by_user_id,
        u.full_name as triggered_by_name,
        coalesce(ed.provider_error_reason, ed.error) as last_error,
        ed.manual_resend_allowed
      from email_dispatches ed
      left join users u on u.id = ed.triggered_by_user_id

      union all

      select
        'quote_legacy:' || qe.id::text as id,
        'quote_legacy'::text as kind,
        qe.id::text as raw_id,
        qe.status,
        case when qe.status = 'SENT' then qe.created_at::text else null end as sent_at,
        null::text as last_event_at,
        qe.created_at::text as created_at,
        q.customer_full_name as recipient_name,
        qe.to_email as recipient_email,
        qe.subject,
        'quote_email'::text as email_type,
        'quote'::text as entity_type,
        qe.quote_id::text as entity_id,
        q.public_id as entity_public_id,
        'legacy_quote'::text as trigger_source,
        null::text as related_transaction_type,
        null::text as related_transaction_id,
        qe.provider_message_id,
        null::text as triggered_by_user_id,
        null::text as triggered_by_name,
        qe.error as last_error,
        true as manual_resend_allowed
      from quote_emails qe
      join quotes q on q.id = qe.quote_id

      union all

      select
        'notification_dispatch_legacy:' || ndl.id::text as id,
        'notification_dispatch_legacy'::text as kind,
        ndl.id::text as raw_id,
        ndl.status,
        case when ndl.status = 'SENT' then ndl.created_at::text else null end as sent_at,
        null::text as last_event_at,
        ndl.created_at::text as created_at,
        null::text as recipient_name,
        null::text as recipient_email,
        null::text as subject,
        ndl.event_type as email_type,
        ndl.entity_type,
        ndl.entity_id::text as entity_id,
        coalesce(b.public_id, q.public_id) as entity_public_id,
        'legacy_notification_dispatch'::text as trigger_source,
        null::text as related_transaction_type,
        null::text as related_transaction_id,
        ndl.provider_message_id,
        null::text as triggered_by_user_id,
        null::text as triggered_by_name,
        ndl.error as last_error,
        false as manual_resend_allowed
      from notification_dispatch_log ndl
      left join bookings b on ndl.entity_type = 'booking' and b.id = ndl.entity_id
      left join quotes q on ndl.entity_type = 'quote' and q.id = ndl.entity_id
    )
  `;
}

function buildWhereClause(input: FetchAdminEmailsInput) {
  const whereParts: string[] = [];
  const values: unknown[] = [];

  const status = normalizeNullableText(input.status);
  if (status) {
    values.push(status);
    whereParts.push(`status = $${values.length}`);
  }

  const emailType = normalizeIdentifierFilter(input.emailType);
  if (emailType) {
    values.push(emailType);
    whereParts.push(`email_type = $${values.length}`);
  }

  const entityType = normalizeIdentifierFilter(input.entityType);
  if (entityType) {
    values.push(entityType);
    whereParts.push(`entity_type = $${values.length}`);
  }

  const triggerSource = normalizeIdentifierFilter(input.triggerSource);
  if (triggerSource) {
    values.push(triggerSource);
    whereParts.push(`trigger_source = $${values.length}`);
  }

  const q = normalizeNullableText(input.q);
  if (q) {
    values.push(`%${q.toLowerCase()}%`);
    const index = values.length;
    whereParts.push(
      `(lower(coalesce(recipient_name, '')) like $${index} or lower(coalesce(recipient_email, '')) like $${index} or lower(coalesce(subject, '')) like $${index} or lower(coalesce(entity_public_id, '')) like $${index} or lower(coalesce(provider_message_id, '')) like $${index} or lower(coalesce(related_transaction_id, '')) like $${index})`,
    );
  }

  if (isDateOnly(input.dateFrom ?? null)) {
    values.push(input.dateFrom);
    whereParts.push(`created_at::date >= $${values.length}::date`);
  }

  if (isDateOnly(input.dateTo ?? null)) {
    values.push(input.dateTo);
    whereParts.push(`created_at::date <= $${values.length}::date`);
  }

  return {
    whereSql: whereParts.length ? ` where ${whereParts.join(" and ")}` : "",
    values,
  };
}

function buildOrderBySql(sortBy: AdminEmailSortBy, sortDir: AdminEmailSortDir) {
  const direction = sortDir === "asc" ? "asc" : "desc";
  if (sortBy === "created") return `order by created_at ${direction}, id desc`;
  if (sortBy === "recipient") return `order by lower(coalesce(recipient_email, '')) ${direction}, created_at desc`;
  if (sortBy === "emailType") return `order by lower(email_type) ${direction}, created_at desc`;
  if (sortBy === "status") return `order by lower(status) ${direction}, created_at desc`;
  return `order by coalesce(last_event_at, sent_at, created_at) ${direction}, created_at desc`;
}

export async function fetchAdminEmailsPage(input: FetchAdminEmailsInput): Promise<AdminEmailsPage> {
  const sortBy = normalizeSortBy(normalizeNullableText(input.sortBy));
  const sortDir = normalizeSortDir(normalizeNullableText(input.sortDir));
  const rowsPerPage = normalizeRowsPerPage(input.limit);
  const page = normalizePage(input.page);
  const { whereSql, values } = buildWhereClause(input);
  const combinedSql = baseCombinedSql();

  const countResult = await dbQuery<{ count: number }>(
    `${combinedSql} select count(*)::int as count from combined${whereSql}`,
    values,
  );
  const totalCount = Number(countResult.rows[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const safeOffset = (safePage - 1) * rowsPerPage;

  const summaryResult = await dbQuery<AdminEmailSummary>(
    `${combinedSql}
      select
        count(*)::int as total,
        count(*) filter (where status = 'FAILED')::int as failed,
        count(*) filter (where status in ('BOUNCED', 'DELIVERY_ISSUE'))::int as "bouncedOrIssue",
        count(*) filter (where status in ('PENDING', 'SKIPPED'))::int as "pendingOrUnknown"
      from combined${whereSql}`,
    values,
  );

  const dataValues = [...values, rowsPerPage, safeOffset];
  const dataResult = await dbQuery<CombinedEmailRow>(
    `${combinedSql}
      select id, kind, raw_id, status, sent_at, last_event_at, created_at, recipient_name, recipient_email, subject, email_type, entity_type, entity_id, entity_public_id, trigger_source, related_transaction_type, related_transaction_id, provider_message_id, triggered_by_user_id, triggered_by_name, last_error, manual_resend_allowed
      from combined${whereSql}
      ${buildOrderBySql(sortBy, sortDir)}
      limit $${dataValues.length - 1} offset $${dataValues.length}`,
    dataValues,
  );

  const items = dataResult.rows.map(mapCombinedRow);
  const from = totalCount === 0 ? 0 : safeOffset + 1;
  const to = Math.min(safeOffset + items.length, totalCount);

  return {
    items,
    totalCount,
    page: safePage,
    rowsPerPage,
    totalPages,
    hasPrev: safePage > 1,
    hasNext: safePage < totalPages,
    from,
    to,
    summary: {
      total: Number(summaryResult.rows[0]?.total ?? 0),
      failed: Number(summaryResult.rows[0]?.failed ?? 0),
      bouncedOrIssue: Number(summaryResult.rows[0]?.bouncedOrIssue ?? 0),
      pendingOrUnknown: Number(summaryResult.rows[0]?.pendingOrUnknown ?? 0),
    },
  };
}

async function fetchDispatchDetail(rawId: string): Promise<AdminEmailDetail | null> {
  const detailResult = await dbQuery<DispatchDetailRow>(
    "select ed.id::text as raw_id, ed.status, ed.sent_at::text as sent_at, ed.last_event_at::text as last_event_at, ed.created_at::text as created_at, ed.recipient_name, ed.to_email as recipient_email, ed.subject, ed.email_type, ed.entity_type, ed.entity_id::text as entity_id, ed.entity_public_id, ed.trigger_source, ed.related_transaction_type, ed.related_transaction_id, ed.provider_message_id, ed.triggered_by_user_id::text as triggered_by_user_id, u.full_name as triggered_by_name, coalesce(ed.provider_error_reason, ed.error) as last_error, ed.manual_resend_allowed, ed.metadata_json from email_dispatches ed left join users u on u.id = ed.triggered_by_user_id where ed.id = $1::uuid limit 1",
    [rawId],
  );
  const row = detailResult.rows[0];
  if (!row) return null;

  const eventsResult = await dbQuery<EmailDispatchEventRow>(
    "select id::text, source, event_type, status, occurred_at, created_at, details_json from email_dispatch_events where email_dispatch_id = $1::uuid order by occurred_at desc, created_at desc",
    [rawId],
  );

  return {
    id: encodeEmailRecordId("dispatch", rawId),
    kind: "dispatch",
    rawId,
    status: row.status,
    sentAt: row.sent_at,
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    emailType: row.email_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityPublicId: row.entity_public_id,
    triggerSource: row.trigger_source,
    relatedTransactionType: row.related_transaction_type,
    relatedTransactionId: row.related_transaction_id,
    providerMessageId: row.provider_message_id,
    triggeredByUserId: row.triggered_by_user_id,
    triggeredByName: row.triggered_by_name,
    lastError: row.last_error,
    manualResendAllowed: row.manual_resend_allowed,
    metadata: row.metadata_json ?? {},
    events: eventsResult.rows.map((event: EmailDispatchEventRow) => ({
      id: event.id,
      source: event.source,
      eventType: event.event_type,
      status: event.status,
      occurredAt: new Date(event.occurred_at).toISOString(),
      createdAt: new Date(event.created_at).toISOString(),
      details: event.details_json ?? {},
    })),
  };
}

async function fetchQuoteLegacyDetail(rawId: string): Promise<AdminEmailDetail | null> {
  const result = await dbQuery<LegacyQuoteDetailRow>(
    "select qe.id::text as id, qe.quote_id::text as quote_id, q.public_id as quote_public_id, q.customer_full_name, qe.to_email, qe.subject, qe.status, qe.provider_message_id, qe.error, qe.created_at from quote_emails qe join quotes q on q.id = qe.quote_id where qe.id = $1::uuid limit 1",
    [rawId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    id: encodeEmailRecordId("quote_legacy", rawId),
    kind: "quote_legacy",
    rawId,
    status: row.status,
    sentAt: row.status === "SENT" ? new Date(row.created_at).toISOString() : null,
    lastEventAt: null,
    createdAt: new Date(row.created_at).toISOString(),
    recipientName: row.customer_full_name,
    recipientEmail: row.to_email,
    subject: row.subject,
    emailType: "quote_email",
    entityType: "quote",
    entityId: row.quote_id,
    entityPublicId: row.quote_public_id,
    triggerSource: "legacy_quote",
    relatedTransactionType: null,
    relatedTransactionId: null,
    providerMessageId: row.provider_message_id,
    triggeredByUserId: null,
    triggeredByName: null,
    lastError: row.error,
    manualResendAllowed: true,
    metadata: {},
    events: [],
  };
}

async function fetchLegacyNotificationDispatchDetail(rawId: string): Promise<AdminEmailDetail | null> {
  const result = await dbQuery<LegacyNotificationDispatchDetailRow>(
    "select ndl.id::text as id, ndl.entity_type, ndl.entity_id::text as entity_id, coalesce(b.public_id, q.public_id) as entity_public_id, ndl.event_type, ndl.provider, ndl.provider_message_id, ndl.status, ndl.error, ndl.created_at from notification_dispatch_log ndl left join bookings b on ndl.entity_type = 'booking' and b.id = ndl.entity_id left join quotes q on ndl.entity_type = 'quote' and q.id = ndl.entity_id where ndl.id = $1::uuid limit 1",
    [rawId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    id: encodeEmailRecordId("notification_dispatch_legacy", rawId),
    kind: "notification_dispatch_legacy",
    rawId,
    status: row.status,
    sentAt: row.status === "SENT" ? new Date(row.created_at).toISOString() : null,
    lastEventAt: null,
    createdAt: new Date(row.created_at).toISOString(),
    recipientName: null,
    recipientEmail: null,
    subject: null,
    emailType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityPublicId: row.entity_public_id,
    triggerSource: "legacy_notification_dispatch",
    relatedTransactionType: null,
    relatedTransactionId: null,
    providerMessageId: row.provider_message_id,
    triggeredByUserId: null,
    triggeredByName: null,
    lastError: row.error,
    manualResendAllowed: false,
    metadata: {
      provider: row.provider,
    },
    events: [],
  };
}

export async function fetchAdminEmailDetail(recordId: string): Promise<AdminEmailDetail | null> {
  const decoded = decodeEmailRecordId(recordId);
  if (!decoded) return null;

  if (decoded.kind === "dispatch") return fetchDispatchDetail(decoded.rawId);
  if (decoded.kind === "quote_legacy") return fetchQuoteLegacyDetail(decoded.rawId);
  return fetchLegacyNotificationDispatchDetail(decoded.rawId);
}

async function loadBookingEmailContext(bookingId: string) {
  const result = await dbQuery<BookingEmailContextRow>(
    "select b.id, b.public_id, b.start_date, b.end_date, b.pickup_location, b.customer_phone_snapshot, b.payment_option, b.pricing_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1::uuid limit 1",
    [bookingId],
  );
  return result.rows[0] ?? null;
}

async function loadContactMessageById(messageId: string) {
  const result = await dbQuery<ContactMessageDetailRow>(
    "select id::text as id, created_at::text as created_at, name, email, message, source from contact_messages where id = $1::uuid limit 1",
    [messageId],
  );
  return result.rows[0] ?? null;
}

async function loadContactMessagesByIds(messageIds: string[]) {
  if (messageIds.length === 0) return [];
  const result = await dbQuery<ContactMessageDetailRow>(
    "select id::text as id, created_at::text as created_at, name, email, message, source from contact_messages where id = any($1::uuid[]) order by created_at desc, id::text desc",
    [messageIds],
  );
  return result.rows;
}

async function loadBookingPaidToDate(bookingId: string) {
  const result = await dbQuery<{ amount: number }>(
    "select coalesce(sum(deposit_amount_cents), 0)::int as amount from payments where booking_id = $1::uuid and status not in ('FAILED', 'CANCELLED', 'REFUNDED')",
    [bookingId],
  );
  return Number(result.rows[0]?.amount ?? 0);
}

function vehicleLabelFromBookingContext(booking: BookingEmailContextRow) {
  return `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim();
}

function readBookingPromoFields(pricing: Record<string, unknown> | null) {
  return readPromoPricingFields(pricing ?? {});
}

export async function resendAdminEmail(recordId: string, actorUserId: string) {
  const detail = await fetchAdminEmailDetail(recordId);
  if (!detail) {
    return { ok: false, status: 404, error: "Email record not found." } as const;
  }
  if (!detail.manualResendAllowed) {
    return { ok: false, status: 409, error: "Manual resend is not allowed for this email." } as const;
  }

  const resendDispatch = {
    triggerSource: "admin_resend" as const,
    triggeredByUserId: actorUserId,
    metadata: {
      resendOfEmailDispatchId: detail.id,
    },
  };

  if (detail.kind === "quote_legacy" || detail.emailType === "quote_email") {
    const quoteId = detail.entityId;
    if (!quoteId) {
      return { ok: false, status: 409, error: "Quote resend context is missing." } as const;
    }
    const quote = await fetchQuoteByIdForOps(quoteId);
    if (!quote) {
      return { ok: false, status: 404, error: "Quote not found." } as const;
    }
    const emailContent = buildQuoteEmailContent({
      quote,
      toEmail: detail.recipientEmail ?? quote.customerEmail,
      message: null,
    });
    const pdf = buildQuotePdfBuffer(quote);
    const result = await sendQuoteEmailWithAttachment({
      toEmail: detail.recipientEmail ?? quote.customerEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      attachmentFilename: `quote-${quote.publicId || quote.id.slice(0, 8)}.pdf`,
      attachmentBase64: Buffer.from(pdf).toString("base64"),
      dispatch: {
        entityType: "quote",
        entityId: quote.id,
        entityPublicId: quote.publicId,
        emailType: "quote_email",
        recipientName: quote.customerFullName,
        triggeredByUserId: actorUserId,
        triggerSource: "admin_quote",
        manualResendAllowed: true,
        metadata: {
          quoteId: quote.id,
          quotePublicId: quote.publicId,
          resendOfEmailDispatchId: detail.id,
        },
      },
    });
    await recordQuoteEmailLog({
      quoteId: quote.id,
      toEmail: detail.recipientEmail ?? quote.customerEmail,
      subject: emailContent.subject,
      status: result.ok ? "SENT" : "FAILED",
      providerMessageId: result.providerMessageId ?? null,
      error: result.error ?? null,
    });
    if (result.ok) {
      await updateQuoteLastEmailed({ quoteId: quote.id, toEmail: detail.recipientEmail ?? quote.customerEmail });
      await insertQuoteEvent(quote.id, "EMAILED", {
        actorAdminUserId: actorUserId,
        meta: { toEmail: detail.recipientEmail ?? quote.customerEmail, resendOfEmailDispatchId: detail.id },
      });
      return { ok: true, status: 200 } as const;
    }
    return { ok: false, status: result.skipped ? 400 : 500, error: result.error ?? "Failed to resend quote email." } as const;
  }

  if (!detail.entityId || detail.entityType !== "booking") {
    if (detail.emailType === "admin_user_welcome") {
      const setupUrl = normalizeText(detail.metadata.setupUrl);
      const username = normalizeText(detail.metadata.username);
      const emailAddress = normalizeText(detail.metadata.emailAddress) || normalizeText(detail.recipientEmail);

      if (!detail.entityId || !emailAddress || !username || !setupUrl) {
        return { ok: false, status: 409, error: "Admin welcome email context is incomplete." } as const;
      }

      const result = await sendAdminUserWelcomeEmail({
        userId: detail.entityId,
        userPublicId: detail.entityPublicId,
        userEmail: emailAddress,
        username,
        fullName: normalizeText(detail.recipientName) || emailAddress,
        setupUrl,
        actorUserId,
      });

      return result.ok
        ? ({ ok: true, status: 200 } as const)
        : ({
            ok: false,
            status: result.skipped ? 400 : 500,
            error: result.error ?? "Failed to resend welcome email.",
          } as const);
    }

    if (detail.emailType === "contact_message_created_alert" || detail.emailType === "contact_messages_digest_alert") {
      if (!detail.recipientEmail) {
        return { ok: false, status: 409, error: "Contact alert recipient is missing." } as const;
      }

      if (detail.emailType === "contact_message_created_alert") {
        if (!detail.entityId) {
          return { ok: false, status: 409, error: "Contact message context is missing." } as const;
        }
        const message = await loadContactMessageById(detail.entityId);
        if (!message) {
          return { ok: false, status: 404, error: "Contact message not found." } as const;
        }
        const result = await sendContactMessageCreatedAlert({
          messageId: message.id,
          createdAt: message.created_at,
          name: message.name,
          email: message.email,
          message: message.message,
          source: message.source,
          recipients: [detail.recipientEmail],
        });
        return result.ok
          ? ({ ok: true, status: 200 } as const)
          : ({
              ok: false,
              status: result.skipped ? 400 : 500,
              error: result.error ?? "Failed to resend contact alert.",
            } as const);
      }

      const rawItemIds = Array.isArray(detail.metadata.itemIds)
        ? detail.metadata.itemIds.map((item) => normalizeText(item)).filter(Boolean)
        : [];
      const messages = await loadContactMessagesByIds(rawItemIds);
      if (messages.length === 0) {
        return { ok: false, status: 409, error: "Contact digest preview items are unavailable." } as const;
      }
      const totalNew = Math.max(messages.length, normalizeNumber(detail.metadata.totalNew, messages.length));
      const result = await sendContactMessagesDigestAlert({
        totalNew,
        recipients: [detail.recipientEmail],
        items: messages.map((message: ContactMessageDetailRow) => ({
          id: message.id,
          createdAt: message.created_at,
          name: message.name,
          email: message.email,
          message: message.message,
          source: message.source?.trim() || "contact_page",
        })),
      });
      return result.ok
        ? ({ ok: true, status: 200 } as const)
        : ({
            ok: false,
            status: result.skipped ? 400 : 500,
            error: result.error ?? "Failed to resend contact digest alert.",
          } as const);
    }
    if (detail.emailType === "operational_alert") {
      const html = normalizeText(detail.metadata.html);
      if (!html || !detail.recipientEmail || !detail.subject) {
        return { ok: false, status: 409, error: "Operational alert context is incomplete." } as const;
      }
      const result = await sendOperationalAlertEmail({
        recipientEmails: [detail.recipientEmail],
        subject: detail.subject,
        html,
        replyTo: normalizeText(detail.metadata.replyTo) || undefined,
        dispatch: {
          entityType: detail.entityType,
          entityId: detail.entityId,
          entityPublicId: detail.entityPublicId,
          ...resendDispatch,
          manualResendAllowed: true,
        },
      });
      return result.ok
        ? ({ ok: true, status: 200 } as const)
        : ({ ok: false, status: result.skipped ? 400 : 500, error: result.error ?? "Failed to resend operational alert." } as const);
    }

    return { ok: false, status: 409, error: "Unsupported resend type." } as const;
  }

  const booking = await loadBookingEmailContext(detail.entityId);
  if (!booking) {
    return { ok: false, status: 404, error: "Booking not found." } as const;
  }

  const pricing = booking.pricing_json ?? {};
  const promo = readBookingPromoFields(pricing);
  const vehicleLabel = vehicleLabelFromBookingContext(booking);
  const depositValue = normalizeNumber(pricing.deposit_cents ?? booking.deposit_cents, 0);
  const totalValue = normalizeNumber(pricing.total_cents ?? pricing.total_amount ?? pricing.amount_due_cents, 0);
  const paidToDate =
    normalizeNumber(pricing.paid_to_date ?? pricing.amount_paid, NaN) || (await loadBookingPaidToDate(booking.id));
  const balanceDue = normalizeNumber(pricing.balance_due, Math.max(0, totalValue - paidToDate));
  const recipientType = normalizeText(detail.metadata.recipientType) === "internal" ? "internal" : "customer";

  const commonDispatch = {
    entityType: "booking" as const,
    entityId: booking.id,
    entityPublicId: booking.public_id,
    ...resendDispatch,
    manualResendAllowed: true,
  };

  let result:
    | Awaited<ReturnType<typeof sendBookingCreatedEmail>>
    | Awaited<ReturnType<typeof sendDepositReceiptEmail>>
    | Awaited<ReturnType<typeof sendPaymentUpdateEmail>>
    | Awaited<ReturnType<typeof sendPaymentCompleteEmail>>
    | Awaited<ReturnType<typeof sendPickupConfirmedEmail>>
    | Awaited<ReturnType<typeof sendPickupReminderEmail>>
    | Awaited<ReturnType<typeof sendDropoffReminderEmail>>
    | Awaited<ReturnType<typeof sendLateDropoffAlertEmail>>
    | Awaited<ReturnType<typeof sendBookingCancelledByBlockoutEmail>>
    | Awaited<ReturnType<typeof sendBookingOverriddenByPaidBookingEmail>>
    | Awaited<ReturnType<typeof sendBookingNoteEmail>>;

  switch (detail.emailType) {
    case "booking_created":
      result = await sendBookingCreatedEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone_snapshot ?? "",
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        dailyRate: Number(booking.daily_rate_cents || 0),
        deposit: depositValue,
        paymentOption: booking.payment_option,
        recipientType,
        recipientEmail: detail.recipientEmail ?? booking.customer_email,
        promoCode: promo.promoCode,
        promoDiscount: promo.promoDiscount,
        dispatch: { ...commonDispatch },
      });
      break;
    case "deposit_receipt":
      result = await sendDepositReceiptEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone_snapshot ?? "",
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        dailyRate: Number(booking.daily_rate_cents || 0),
        deposit: depositValue,
        paidToDate,
        recipientType,
        recipientEmail: detail.recipientEmail ?? booking.customer_email,
        promoCode: promo.promoCode,
        promoDiscount: promo.promoDiscount,
        dispatch: {
          ...commonDispatch,
          relatedTransactionType: detail.relatedTransactionType,
          relatedTransactionId: detail.relatedTransactionId,
        },
      });
      break;
    case "payment_update":
      result = await sendPaymentUpdateEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone_snapshot ?? "",
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        dailyRate: Number(booking.daily_rate_cents || 0),
        deposit: depositValue,
        total: totalValue,
        paidToDate,
        balanceDue,
        recipientType,
        recipientEmail: detail.recipientEmail ?? booking.customer_email,
        paymentAmount: normalizeNumber(detail.metadata.paymentAmount, 0),
        paymentMethod: normalizeText(detail.metadata.paymentMethod) || undefined,
        paymentDateTime: normalizeText(detail.metadata.paymentDateTime) || undefined,
        paymentReference: normalizeText(detail.metadata.paymentReference) || undefined,
        dispatch: {
          ...commonDispatch,
          relatedTransactionType: detail.relatedTransactionType,
          relatedTransactionId: detail.relatedTransactionId,
        },
      });
      break;
    case "payment_complete":
      result = await sendPaymentCompleteEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone_snapshot ?? "",
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        dailyRate: Number(booking.daily_rate_cents || 0),
        deposit: depositValue,
        total: totalValue,
        paidToDate,
        balanceDue,
        recipientType,
        recipientEmail: detail.recipientEmail ?? booking.customer_email,
        paymentAmount: normalizeNumber(detail.metadata.paymentAmount, 0),
        paymentMethod: normalizeText(detail.metadata.paymentMethod) || undefined,
        paymentDateTime: normalizeText(detail.metadata.paymentDateTime) || undefined,
        paymentReference: normalizeText(detail.metadata.paymentReference) || undefined,
        dispatch: {
          ...commonDispatch,
          relatedTransactionType: detail.relatedTransactionType,
          relatedTransactionId: detail.relatedTransactionId,
        },
      });
      break;
    case "pickup_reminder":
      result = await sendPickupReminderEmail({
        bookingId: booking.id,
        customerEmail: detail.recipientEmail ?? booking.customer_email,
        customerName: booking.customer_name,
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        balanceDue,
        dispatch: { ...commonDispatch },
      });
      break;
    case "pickup_confirmed":
      result = await sendPickupConfirmedEmail({
        bookingId: booking.id,
        customerEmail: detail.recipientEmail ?? booking.customer_email,
        customerName: booking.customer_name,
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        paidToDate,
        balanceDue,
        dispatch: { ...commonDispatch },
      });
      break;
    case "dropoff_reminder":
      result = await sendDropoffReminderEmail({
        bookingId: booking.id,
        customerEmail: detail.recipientEmail ?? booking.customer_email,
        customerName: booking.customer_name,
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        balanceDue,
        dispatch: { ...commonDispatch },
      });
      break;
    case "late_dropoff_alert":
      result = await sendLateDropoffAlertEmail({
        bookingId: booking.id,
        customerEmail: detail.recipientEmail ?? booking.customer_email,
        customerName: booking.customer_name,
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        balanceDue,
        dispatch: { ...commonDispatch },
      });
      break;
    case "booking_cancelled_by_blockout":
      result = await sendBookingCancelledByBlockoutEmail({
        recipientType: normalizeText(detail.metadata.recipientType) === "internal" ? "internal" : "customer",
        recipientEmail: detail.recipientEmail ?? booking.customer_email,
        bookingId: booking.id,
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        blockoutReason: normalizeText(detail.metadata.blockoutReason),
        blockoutStart: normalizeText(detail.metadata.blockoutStart),
        blockoutEnd: normalizeText(detail.metadata.blockoutEnd),
        dispatch: { ...commonDispatch },
      });
      break;
    case "booking_overridden_by_paid_booking":
      result = await sendBookingOverriddenByPaidBookingEmail({
        recipientType: normalizeText(detail.metadata.recipientType) === "internal" ? "internal" : "customer",
        recipientEmail: detail.recipientEmail ?? booking.customer_email,
        bookingId: booking.id,
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        overriddenByBookingId:
          normalizeText(detail.metadata.overriddenByBookingId) || normalizeText(detail.relatedTransactionId),
        dispatch: { ...commonDispatch },
      });
      break;
    case "booking_note":
      result = await sendBookingNoteEmail({
        bookingId: booking.id,
        recipientEmail: detail.recipientEmail ?? booking.customer_email,
        recipientType: normalizeText(detail.metadata.recipientType) === "internal" ? "internal" : "customer",
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        vehicleLabel,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        noteMessage: normalizeText(detail.metadata.noteMessage),
        sentByUserId: actorUserId,
        scheduledFor: normalizeNullableText(detail.metadata.scheduledFor),
        dispatch: { ...commonDispatch },
      });
      break;
    default:
      return { ok: false, status: 409, error: "Unsupported resend type." } as const;
  }

  return result.ok
    ? ({ ok: true, status: 200 } as const)
    : ({
        ok: false,
        status: result.skipped ? 400 : 500,
        error: result.error ?? "Failed to resend email.",
      } as const);
}
