import { dbQuery } from "@/lib/db";

export const CONTACT_MESSAGE_STATUSES = ["NEW", "READ", "ARCHIVED"] as const;

export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number];

export type ContactMessageAction =
  | "MARK_READ"
  | "MARK_NEW"
  | "ARCHIVE"
  | "UNARCHIVE";

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
  snippet: string;
  source: string;
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
  q?: string | null;
  sortBy?: string | null;
  sortDir?: string | null;
  limit?: unknown;
  cursor?: unknown;
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
  if (normalized === "ARCHIVED") return "ARCHIVED";
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

function mapListItem(row: ContactMessageRow): AdminMessageListItem {
  const message = normalizeText(row.message);
  return {
    id: row.id,
    createdAt: toIsoTimestamp(row.created_at),
    name: normalizeText(row.name),
    email: normalizeText(row.email),
    status: toStatus(row.status),
    snippet: buildSnippet(message),
    source: normalizeText(row.source) || "contact_page",
  };
}

function mapDetailItem(row: ContactMessageRow): AdminMessageDetailItem {
  const list = mapListItem(row);
  return {
    ...list,
    message: normalizeText(row.message),
    readAt: row.read_at ? toIsoTimestamp(row.read_at) : null,
    readByUserId: normalizeText(row.read_by_user_id) || null,
  };
}

function buildFilters(input: FetchAdminMessagesInput) {
  const status = normalizeContactMessageStatusFilter(input.status);
  const q = normalizeText(input.q);

  const whereParts: string[] = [];
  const values: Array<string | number> = [];
  let index = 1;

  if (status) {
    whereParts.push(`status = $${index}`);
    values.push(status);
    index += 1;
  }

  if (q) {
    whereParts.push(`(name ilike $${index} or email ilike $${index} or message ilike $${index})`);
    values.push(`%${q}%`);
    index += 1;
  }

  return { whereParts, values, index, status, q };
}

export async function fetchAdminMessagesPage(
  input: FetchAdminMessagesInput,
): Promise<AdminMessagesPage> {
  const limit = normalizeContactMessagesLimit(input.limit);
  const cursor = decodeContactMessagesCursor(input.cursor);
  const offset =
    cursor && Number.isInteger(cursor.offset) && Number(cursor.offset) >= 0
      ? Number(cursor.offset)
      : 0;
  const sortBy = normalizeAdminMessageSortBy(input.sortBy) ?? "received";
  const sortDir = normalizeAdminMessageSortDir(input.sortDir) ?? "desc";
  const direction = sortDir === "asc" ? "asc" : "desc";

  const filters = buildFilters(input);
  const whereParts = [...filters.whereParts];
  const values: Array<string | number> = [...filters.values];

  values.push(limit + 1);
  const limitIndex = values.length;
  values.push(offset);
  const offsetIndex = values.length;
  const orderBySql =
    sortBy === "name"
      ? `order by lower(name) ${direction}, id::text ${direction}`
      : sortBy === "email"
        ? `order by lower(email) ${direction}, id::text ${direction}`
        : sortBy === "status"
          ? `order by upper(status) ${direction}, id::text ${direction}`
          : `order by created_at ${direction}, id::text ${direction}`;

  const whereSql = whereParts.length > 0 ? ` where ${whereParts.join(" and ")}` : "";

  const result = await dbQuery<ContactMessageRow>(
    `select id, created_at, name, email, message, status, read_at, read_by_user_id, source from contact_messages${whereSql} ${orderBySql} limit $${limitIndex} offset $${offsetIndex}`,
    values,
  );

  const countWhereSql =
    filters.whereParts.length > 0
      ? ` where ${filters.whereParts.join(" and ")}`
      : "";

  const countResult = await dbQuery<{ total_count: unknown }>(
    `select count(*)::int as total_count from contact_messages${countWhereSql}`,
    filters.values,
  );

  const hasMore = result.rows.length > limit;
  const visibleRows = hasMore ? result.rows.slice(0, limit) : result.rows;

  const nextCursor =
    hasMore && visibleRows.length > 0
      ? encodeContactMessagesCursor({
          createdAt: toIsoTimestamp(visibleRows[visibleRows.length - 1].created_at),
          offset: offset + visibleRows.length,
          id: visibleRows[visibleRows.length - 1].id,
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

export async function fetchAdminMessageById(id: string) {
  const result = await dbQuery<ContactMessageRow>(
    "select id, created_at, name, email, message, status, read_at, read_by_user_id, source from contact_messages where id = $1 limit 1",
    [id],
  );
  const row = result.rows[0];
  return row ? mapDetailItem(row) : null;
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
    return {
      item: mapDetailItem(updated),
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
    item: updateResult.rows[0] ? mapDetailItem(updateResult.rows[0]) : null,
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
