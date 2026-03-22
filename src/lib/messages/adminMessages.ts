import { dbQuery } from "@/lib/db";

export const CONTACT_MESSAGE_STATUSES = ["NEW", "READ", "ARCHIVED"] as const;
export const ADMIN_MESSAGE_SOURCE_OPTIONS = [
  { value: "contact_page", label: "Contact form" },
  { value: "booking_inspection", label: "Vehicle inspection alert" },
  { value: "resend_webhook", label: "Email delivery issue" },
] as const;

export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number];
export type AdminMessageSourceFilter = (typeof ADMIN_MESSAGE_SOURCE_OPTIONS)[number]["value"];
export type AdminMessageVisibleStatus = "NEW" | "READ" | "TRASH";

export type ContactMessageAction =
  | "MARK_READ"
  | "MARK_NEW"
  | "ARCHIVE"
  | "UNARCHIVE"
  | "DELETE_PERMANENT";

export type ContactMessageStatusChange = {
  id: string;
  previousStatus: ContactMessageStatus;
  nextStatus: ContactMessageStatus;
};

type ContactMessageRow = {
  id: string;
  created_at: string | Date;
  name: string;
  email: string;
  message: string;
  status: string;
  read_at: string | Date | null;
  read_by_user_id: string | null;
  source: string | null;
};

type ContactMessageRelatedAuditRow = {
  notification_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details_json: unknown;
  created_at: string | Date;
};

type MessageCursor = {
  createdAt: string;
  offset?: number;
  id: string;
};

export const ADMIN_MESSAGE_SORT_COLUMNS = ["received", "name", "email", "status"] as const;
export type AdminMessageSortBy = (typeof ADMIN_MESSAGE_SORT_COLUMNS)[number];
export type AdminMessageSortDir = "asc" | "desc";

export type AdminMessageListItem = {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  status: ContactMessageStatus;
  visibleStatus: AdminMessageVisibleStatus;
  statusLabel: string;
  snippet: string;
  source: string;
  sourceKey: string;
  sourceLabel: string;
  isTrashed: boolean;
  displayName: string;
  displayEmail: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  relatedEntityPublicId: string | null;
  relatedEntityLabel: string | null;
  relatedEntityHref: string | null;
};

export type AdminMessageDetailItem = AdminMessageListItem & {
  message: string;
  readAt: string | null;
  readByUserId: string | null;
};

export type AdminMessagesPage = {
  items: AdminMessageListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  limit: number;
};

export type FetchAdminMessagesInput = {
  status?: string | null;
  source?: string | null;
  q?: string | null;
  sortBy?: string | null;
  sortDir?: string | null;
  limit?: unknown;
  cursor?: unknown;
  offset?: unknown;
  dateFrom?: string | null;
  dateTo?: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeUserId(value?: string | null) {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

function isUuid(value: string) {
  return UUID_RE.test(value);
}

function toIsoTimestamp(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const date = new Date(String(value ?? ""));
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString();
  }
  return String(value ?? "");
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toStatus(value: unknown): ContactMessageStatus {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "READ") return "READ";
  if (normalized === "ARCHIVED") return "ARCHIVED";
  return "NEW";
}

export function normalizeContactMessageStatusFilter(value: unknown): ContactMessageStatus | null {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "NEW") return "NEW";
  if (normalized === "READ") return "READ";
  if (normalized === "ARCHIVED" || normalized === "TRASH" || normalized === "TRASHED") {
    return "ARCHIVED";
  }
  return null;
}

export function normalizeAdminMessageSourceFilter(value: unknown): AdminMessageSourceFilter | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    ADMIN_MESSAGE_SOURCE_OPTIONS.some((option) => option.value === normalized)
  ) {
    return normalized as AdminMessageSourceFilter;
  }
  return null;
}

export function normalizeAdminMessageSortBy(value: unknown): AdminMessageSortBy | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "received") return "received";
  if (normalized === "name") return "name";
  if (normalized === "email") return "email";
  if (normalized === "status") return "status";
  return null;
}

export function normalizeAdminMessageSortDir(value: unknown): AdminMessageSortDir | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "asc") return "asc";
  if (normalized === "desc") return "desc";
  return null;
}

export function normalizeMessageAction(value: unknown): ContactMessageAction | null {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "MARK_READ") return "MARK_READ";
  if (normalized === "MARK_NEW") return "MARK_NEW";
  if (normalized === "ARCHIVE") return "ARCHIVE";
  if (normalized === "UNARCHIVE") return "UNARCHIVE";
  if (normalized === "DELETE_PERMANENT") return "DELETE_PERMANENT";
  return null;
}

export function normalizeContactMessagesLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 20;
  if (parsed < 1) return 20;
  return Math.min(parsed, 50);
}

export function encodeContactMessagesCursor(cursor: MessageCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeContactMessagesCursor(cursor: unknown): MessageCursor | null {
  if (typeof cursor !== "string" || !cursor.trim()) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor.trim(), "base64url").toString("utf8"),
    ) as { createdAt?: unknown; id?: unknown; offset?: unknown };

    const createdAt = toIsoTimestamp(parsed.createdAt);
    const id = normalizeText(parsed.id);
    if (!createdAt || !id) return null;
    const cursorOffset =
      Number.isInteger(parsed.offset) && Number(parsed.offset) >= 0
        ? Number(parsed.offset)
        : undefined;
    return { createdAt, id, offset: cursorOffset };
  } catch {
    return null;
  }
}

function buildSnippet(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  if (compact.length <= 120) return compact;
  return `${compact.slice(0, 117)}...`;
}

function normalizeMessageOffset(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

function isIsoDate(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildOrderBySql(sortBy: AdminMessageSortBy, sortDir: AdminMessageSortDir) {
  const direction = sortDir === "asc" ? "asc" : "desc";
  if (sortBy === "name") {
    return `order by lower(m.name) ${direction}, m.id::text ${direction}`;
  }
  if (sortBy === "email") {
    return `order by lower(m.email) ${direction}, m.id::text ${direction}`;
  }
  if (sortBy === "status") {
    return `order by upper(m.status) ${direction}, m.id::text ${direction}`;
  }
  return `order by m.created_at ${direction}, m.id::text ${direction}`;
}

function humanizeFallbackLabel(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => {
      if (segment.toLowerCase() === "id") return "ID";
      if (segment.toLowerCase() === "pdf") return "PDF";
      return `${segment.slice(0, 1).toUpperCase()}${segment.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

export function humanizeAdminMessageSource(value: unknown) {
  const sourceKey = normalizeText(value).toLowerCase();
  const known = ADMIN_MESSAGE_SOURCE_OPTIONS.find((option) => option.value === sourceKey);
  if (known) return known.label;
  return sourceKey ? humanizeFallbackLabel(sourceKey) : "Contact form";
}

export function getAdminMessageVisibleStatus(status: unknown): AdminMessageVisibleStatus {
  const normalized = toStatus(status);
  if (normalized === "ARCHIVED") return "TRASH";
  return normalized;
}

export function getAdminMessageStatusLabel(status: unknown) {
  return getAdminMessageVisibleStatus(status) === "TRASH"
    ? "Trash"
    : getAdminMessageVisibleStatus(status);
}

function buildRelatedEntityHref(entityType: string, entityId: string) {
  if (!isUuid(entityId)) return null;
  if (entityType === "booking") return `/admin/bookings/${entityId}`;
  if (entityType === "quote") return `/admin/bookings/quotes/${entityId}`;
  return null;
}

function buildRelatedEntityLabel(entityType: string, publicId: string, entityId: string) {
  const displayValue = publicId || entityId;
  if (!displayValue) return null;
  if (entityType === "booking") return `Booking ${displayValue}`;
  if (entityType === "quote") return `Quote ${displayValue}`;
  if (entityType === "email") return `Email ${displayValue}`;
  return `${humanizeFallbackLabel(entityType)} ${displayValue}`;
}

type AdminMessageEnrichment = {
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  relatedEntityPublicId: string | null;
  relatedEntityLabel: string | null;
  relatedEntityHref: string | null;
};

function mapMessageAuditEnrichment(
  row: ContactMessageRelatedAuditRow,
): AdminMessageEnrichment {
  const details = asRecord(row.details_json);
  const correlation = asRecord(details?.correlation);
  const relatedEntityType =
    asString(row.entity_type).toLowerCase() ||
    asString(correlation?.entityType).toLowerCase() ||
    null;
  const relatedEntityId = asString(row.entity_id) || asString(correlation?.entityId) || null;
  const relatedEntityPublicId =
    asString(details?.bookingPublicId) ||
    asString(details?.quotePublicId) ||
    asString(correlation?.entityPublicId) ||
    null;
  const relatedEntityLabel = relatedEntityType
    ? buildRelatedEntityLabel(
        relatedEntityType,
        relatedEntityPublicId ?? "",
        relatedEntityId ?? "",
      )
    : null;
  const relatedEntityHref =
    relatedEntityType && relatedEntityId
      ? buildRelatedEntityHref(relatedEntityType, relatedEntityId)
      : null;

  return {
    relatedEntityType,
    relatedEntityId,
    relatedEntityPublicId,
    relatedEntityLabel,
    relatedEntityHref,
  };
}

async function loadAdminMessageEnrichmentByNotificationIds(
  ids: string[],
): Promise<Map<string, AdminMessageEnrichment>> {
  if (ids.length === 0) return new Map();

  const result = await dbQuery<ContactMessageRelatedAuditRow>(
    `select
        coalesce(details_json->>'notificationId', '') as notification_id,
        action,
        entity_type,
        entity_id::text as entity_id,
        details_json,
        created_at
      from audit_logs
      where coalesce(details_json->>'notificationId', '') = any($1::text[])
      order by created_at desc`,
    [ids],
  );

  const map = new Map<string, AdminMessageEnrichment>();
  for (const row of result.rows) {
    if (!row.notification_id || map.has(row.notification_id)) continue;
    map.set(row.notification_id, mapMessageAuditEnrichment(row));
  }

  return map;
}

function buildPresentationFields(
  row: ContactMessageRow,
  sourceKey: string,
  sourceLabel: string,
  enrichment: AdminMessageEnrichment | undefined,
) {
  const rawName = normalizeText(row.name);
  const rawEmail = normalizeText(row.email);

  if (sourceKey === "contact_page") {
    return {
      displayName: rawName || "Unknown sender",
      displayEmail: rawEmail || "No email provided",
    };
  }

  if (sourceKey === "booking_inspection") {
    return {
      displayName:
        enrichment?.relatedEntityPublicId
          ? `Vehicle inspection alert · ${enrichment.relatedEntityPublicId}`
          : sourceLabel,
      displayEmail: rawEmail ? `Recipient: ${rawEmail}` : "Internal alert",
    };
  }

  if (sourceKey === "resend_webhook") {
    return {
      displayName:
        enrichment?.relatedEntityPublicId
          ? `Email delivery issue · ${enrichment.relatedEntityPublicId}`
          : sourceLabel,
      displayEmail: rawEmail ? `Recipient: ${rawEmail}` : "System email event",
    };
  }

  return {
    displayName: rawName || sourceLabel,
    displayEmail: rawEmail || "System message",
  };
}

async function hydrateAdminMessageRows(rows: ContactMessageRow[]) {
  const enrichmentById = await loadAdminMessageEnrichmentByNotificationIds(
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const message = normalizeText(row.message);
    const sourceKey = normalizeText(row.source) || "contact_page";
    const sourceLabel = humanizeAdminMessageSource(sourceKey);
    const enrichment = enrichmentById.get(row.id);
    const presentation = buildPresentationFields(row, sourceKey, sourceLabel, enrichment);
    return {
      id: row.id,
      createdAt: toIsoTimestamp(row.created_at),
      name: normalizeText(row.name),
      email: normalizeText(row.email),
      displayName: presentation.displayName,
      displayEmail: presentation.displayEmail,
      status: toStatus(row.status),
      visibleStatus: getAdminMessageVisibleStatus(row.status),
      statusLabel: getAdminMessageStatusLabel(row.status),
      snippet: buildSnippet(message),
      source: sourceKey,
      sourceKey,
      sourceLabel,
      isTrashed: toStatus(row.status) === "ARCHIVED",
      relatedEntityType: enrichment?.relatedEntityType ?? null,
      relatedEntityId: enrichment?.relatedEntityId ?? null,
      relatedEntityPublicId: enrichment?.relatedEntityPublicId ?? null,
      relatedEntityLabel: enrichment?.relatedEntityLabel ?? null,
      relatedEntityHref: enrichment?.relatedEntityHref ?? null,
      message,
      readAt: row.read_at ? toIsoTimestamp(row.read_at) : null,
      readByUserId: normalizeText(row.read_by_user_id) || null,
    } satisfies AdminMessageDetailItem;
  });
}

function buildFilters(input: FetchAdminMessagesInput) {
  const status = normalizeContactMessageStatusFilter(input.status);
  const source = normalizeAdminMessageSourceFilter(input.source);
  const q = normalizeText(input.q);
  const dateFrom = isIsoDate(normalizeText(input.dateFrom)) ? normalizeText(input.dateFrom) : null;
  const dateTo = isIsoDate(normalizeText(input.dateTo)) ? normalizeText(input.dateTo) : null;

  const whereParts: string[] = [];
  const values: Array<string | number> = [];
  let index = 1;

  if (status) {
    whereParts.push(`m.status = $${index}`);
    values.push(status);
    index += 1;
  } else {
    whereParts.push(`m.status <> 'ARCHIVED'`);
  }

  if (source) {
    whereParts.push(`coalesce(m.source, 'contact_page') = $${index}`);
    values.push(source);
    index += 1;
  }

  if (q) {
    whereParts.push(`(
      m.name ilike $${index}
      or m.email ilike $${index}
      or m.message ilike $${index}
      or coalesce(m.source, 'contact_page') ilike $${index}
      or exists (
        select 1
        from audit_logs a
        where coalesce(a.details_json->>'notificationId', '') = m.id::text
          and (
            coalesce(a.entity_type, '') ilike $${index}
            or coalesce(a.details_json->>'bookingPublicId', '') ilike $${index}
            or coalesce(a.details_json->'correlation'->>'entityPublicId', '') ilike $${index}
            or coalesce(a.action, '') ilike $${index}
          )
      )
    )`);
    values.push(`%${q}%`);
    index += 1;
  }

  if (dateFrom) {
    whereParts.push(`m.created_at >= $${index}::date`);
    values.push(dateFrom);
    index += 1;
  }

  if (dateTo) {
    whereParts.push(`m.created_at < ($${index}::date + interval '1 day')`);
    values.push(dateTo);
    index += 1;
  }

  return { whereParts, values, index, status, q, source, dateFrom, dateTo };
}

export async function fetchAdminMessagesPage(
  input: FetchAdminMessagesInput,
): Promise<AdminMessagesPage> {
  const limit = normalizeContactMessagesLimit(input.limit);
  const cursor = decodeContactMessagesCursor(input.cursor);
  const offset = normalizeMessageOffset(
    input.offset ??
      (cursor && Number.isInteger(cursor.offset) && Number(cursor.offset) >= 0
        ? Number(cursor.offset)
        : 0),
  );
  const sortBy = normalizeAdminMessageSortBy(input.sortBy) ?? "received";
  const sortDir = normalizeAdminMessageSortDir(input.sortDir) ?? "desc";

  const filters = buildFilters(input);
  const values: Array<string | number> = [...filters.values];

  values.push(limit + 1);
  const limitIndex = values.length;
  values.push(offset);
  const offsetIndex = values.length;
  const orderBySql = buildOrderBySql(sortBy, sortDir);

  const whereSql =
    filters.whereParts.length > 0 ? ` where ${filters.whereParts.join(" and ")}` : "";

  const result = await dbQuery<ContactMessageRow>(
    `select
        m.id,
        m.created_at,
        m.name,
        m.email,
        m.message,
        m.status,
        m.read_at,
        m.read_by_user_id,
        m.source
      from contact_messages m${whereSql} ${orderBySql} limit $${limitIndex} offset $${offsetIndex}`,
    values,
  );

  const countWhereSql =
    filters.whereParts.length > 0
      ? ` where ${filters.whereParts.join(" and ")}`
      : "";

  const countResult = await dbQuery<{ total_count: unknown }>(
    `select count(*)::int as total_count from contact_messages m${countWhereSql}`,
    filters.values,
  );

  const hasMore = result.rows.length > limit;
  const visibleRows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const hydratedRows = await hydrateAdminMessageRows(visibleRows);

  const nextCursor =
    hasMore && hydratedRows.length > 0
      ? encodeContactMessagesCursor({
          createdAt: hydratedRows[hydratedRows.length - 1].createdAt,
          offset: offset + hydratedRows.length,
          id: hydratedRows[hydratedRows.length - 1].id,
        })
      : null;

  return {
    items: hydratedRows,
    nextCursor,
    hasMore: Boolean(nextCursor),
    totalCount: Number(countResult.rows[0]?.total_count ?? 0),
    limit,
  };
}

export async function fetchAdminMessageById(id: string) {
  const result = await dbQuery<ContactMessageRow>(
    "select id, created_at, name, email, message, status, read_at, read_by_user_id, source from contact_messages where id = $1 limit 1",
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const hydrated = await hydrateAdminMessageRows([row]);
  return hydrated[0] ?? null;
}

export type AdminMessageExportRow = AdminMessageDetailItem;

export async function fetchAdminMessageExportRows(input: FetchAdminMessagesInput) {
  const sortBy = normalizeAdminMessageSortBy(input.sortBy) ?? "received";
  const sortDir = normalizeAdminMessageSortDir(input.sortDir) ?? "desc";
  const filters = buildFilters(input);
  const orderBySql = buildOrderBySql(sortBy, sortDir);
  const whereSql =
    filters.whereParts.length > 0 ? ` where ${filters.whereParts.join(" and ")}` : "";

  const result = await dbQuery<ContactMessageRow>(
    `select
        m.id,
        m.created_at,
        m.name,
        m.email,
        m.message,
        m.status,
        m.read_at,
        m.read_by_user_id,
        m.source
      from contact_messages m${whereSql} ${orderBySql}`,
    filters.values,
  );

  return hydrateAdminMessageRows(result.rows);
}

export async function fetchAdminMessageByIdWithOptionalMarkRead(input: {
  id: string;
  markRead?: boolean;
  actorUserId?: string | null;
}) {
  const markRead = Boolean(input.markRead);
  const actorUserId = normalizeUserId(input.actorUserId);

  if (!markRead) {
    const existing = await fetchAdminMessageById(input.id);
    return {
      item: existing,
      statusChanged: false,
      previousStatus: existing?.status ?? null,
    };
  }

  const updateResult = await dbQuery<ContactMessageRow>(
    "update contact_messages set status = 'READ', read_at = coalesce(read_at, now()), read_by_user_id = coalesce(read_by_user_id, $2::uuid) where id = $1 and status = 'NEW' returning id, created_at, name, email, message, status, read_at, read_by_user_id, source",
    [input.id, actorUserId],
  );

  const updated = updateResult.rows[0];
  if (updated) {
    const hydrated = await hydrateAdminMessageRows([updated]);
    return {
      item: hydrated[0] ?? null,
      statusChanged: true,
      previousStatus: "NEW" as ContactMessageStatus,
    };
  }

  const existing = await fetchAdminMessageById(input.id);
  return {
    item: existing,
    statusChanged: false,
    previousStatus: existing?.status ?? null,
  };
}

export async function updateAdminMessageStatus(input: {
  id: string;
  action: ContactMessageAction;
  actorUserId?: string | null;
}) {
  const actorUserId = normalizeUserId(input.actorUserId);

  const existingResult = await dbQuery<{ status: string }>(
    "select status from contact_messages where id = $1 limit 1",
    [input.id],
  );

  const existingStatus = existingResult.rows[0]?.status;
  if (!existingStatus) {
    return {
      item: null,
      previousStatus: null,
    };
  }

  const previousStatus = toStatus(existingStatus);

  let query =
    "update contact_messages set status = status where id = $1 returning id, created_at, name, email, message, status, read_at, read_by_user_id, source";
  let values: Array<string | null> = [input.id];

  if (input.action === "MARK_READ") {
    query =
      "update contact_messages set status = 'READ', read_at = coalesce(read_at, now()), read_by_user_id = coalesce(read_by_user_id, $2::uuid) where id = $1 returning id, created_at, name, email, message, status, read_at, read_by_user_id, source";
    values = [input.id, actorUserId];
  } else if (input.action === "MARK_NEW") {
    query =
      "update contact_messages set status = 'NEW', read_at = null, read_by_user_id = null where id = $1 returning id, created_at, name, email, message, status, read_at, read_by_user_id, source";
  } else if (input.action === "ARCHIVE") {
    query =
      "update contact_messages set status = 'ARCHIVED' where id = $1 returning id, created_at, name, email, message, status, read_at, read_by_user_id, source";
  } else if (input.action === "UNARCHIVE") {
    query =
      "update contact_messages set status = 'READ', read_at = coalesce(read_at, now()), read_by_user_id = coalesce(read_by_user_id, $2::uuid) where id = $1 returning id, created_at, name, email, message, status, read_at, read_by_user_id, source";
    values = [input.id, actorUserId];
  }

  const updateResult = await dbQuery<ContactMessageRow>(query, values);

  return {
    item: updateResult.rows[0] ? (await hydrateAdminMessageRows([updateResult.rows[0]]))[0] ?? null : null,
    previousStatus,
  };
}

function buildBulkUpdateQuery(action: ContactMessageAction) {
  if (action === "MARK_READ") {
    return {
      text: "update contact_messages set status = 'READ', read_at = coalesce(read_at, now()), read_by_user_id = coalesce(read_by_user_id, $2::uuid) where id = any($1::uuid[]) returning id, status",
      usesActorUserId: true,
    };
  }
  if (action === "MARK_NEW") {
    return {
      text: "update contact_messages set status = 'NEW', read_at = null, read_by_user_id = null where id = any($1::uuid[]) returning id, status",
      usesActorUserId: false,
    };
  }
  if (action === "ARCHIVE") {
    return {
      text: "update contact_messages set status = 'ARCHIVED' where id = any($1::uuid[]) returning id, status",
      usesActorUserId: false,
    };
  }
  return {
    text: "update contact_messages set status = 'READ', read_at = coalesce(read_at, now()), read_by_user_id = coalesce(read_by_user_id, $2::uuid) where id = any($1::uuid[]) returning id, status",
    usesActorUserId: true,
  };
}

export async function bulkUpdateAdminMessagesStatus(input: {
  ids: string[];
  action: ContactMessageAction;
  actorUserId?: string | null;
}) {
  const actorUserId = normalizeUserId(input.actorUserId);
  const ids = [...new Set(input.ids.map((id) => id.trim()).filter((id) => isUuid(id)))];

  if (ids.length === 0) {
    return {
      updatedCount: 0,
      changes: [] as ContactMessageStatusChange[],
    };
  }

  const existingResult = await dbQuery<{ id: string; status: string }>(
    "select id, status from contact_messages where id = any($1::uuid[])",
    [ids],
  );
  const previousStatusById = new Map<string, ContactMessageStatus>();
  for (const row of existingResult.rows) {
    previousStatusById.set(row.id, toStatus(row.status));
  }

  if (previousStatusById.size === 0) {
    return {
      updatedCount: 0,
      changes: [] as ContactMessageStatusChange[],
    };
  }

  const query = buildBulkUpdateQuery(input.action);
  const values = query.usesActorUserId ? [ids, actorUserId] : [ids];
  const updateResult = await dbQuery<{ id: string; status: string }>(query.text, values);

  const changes: ContactMessageStatusChange[] = [];
  for (const row of updateResult.rows) {
    const previousStatus = previousStatusById.get(row.id);
    if (!previousStatus) continue;
    changes.push({
      id: row.id,
      previousStatus,
      nextStatus: toStatus(row.status),
    });
  }

  return {
    updatedCount: changes.length,
    changes,
  };
}

export async function deleteAdminMessagePermanently(input: { id: string }) {
  const result = await dbQuery<ContactMessageRow>(
    `delete from contact_messages
      where id = $1
        and status = 'ARCHIVED'
      returning id, created_at, name, email, message, status, read_at, read_by_user_id, source`,
    [input.id],
  );

  const row = result.rows[0];
  if (!row) return null;
  const hydrated = await hydrateAdminMessageRows([row]);
  return hydrated[0] ?? null;
}

export async function bulkDeleteAdminMessagesPermanently(input: { ids: string[] }) {
  const ids = [...new Set(input.ids.map((id) => id.trim()).filter((id) => isUuid(id)))];
  if (ids.length === 0) {
    return { deletedCount: 0, deletedIds: [] as string[], blockedIds: [] as string[] };
  }

  const existingResult = await dbQuery<{ id: string; status: string }>(
    "select id, status from contact_messages where id = any($1::uuid[])",
    [ids],
  );
  const blockedIds = existingResult.rows
    .filter((row: { id: string; status: string }) => toStatus(row.status) !== "ARCHIVED")
    .map((row: { id: string; status: string }) => row.id);

  if (blockedIds.length > 0) {
    return {
      deletedCount: 0,
      deletedIds: [] as string[],
      blockedIds,
    };
  }

  const deleteResult = await dbQuery<{ id: string }>(
    "delete from contact_messages where id = any($1::uuid[]) and status = 'ARCHIVED' returning id",
    [ids],
  );

  return {
    deletedCount: deleteResult.rows.length,
    deletedIds: deleteResult.rows.map((row: { id: string }) => row.id),
    blockedIds: [] as string[],
  };
}

export async function getUnreadContactMessagesCount() {
  const result = await dbQuery<{ count: unknown }>(
    "select count(*)::int as count from contact_messages where status = 'NEW'",
  );
  return Number(result.rows[0]?.count ?? 0);
}

export function isContactMessagesMissingTableError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return code === "42P01" && message.includes("contact_messages");
}
