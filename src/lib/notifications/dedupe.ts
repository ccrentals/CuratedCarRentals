import { dbQuery } from "@/lib/db";

type DbQueryFn = <T = unknown>(text: string, params?: unknown[]) => Promise<{
  rows: T[];
  rowCount: number;
}>;

type KeyPart = string | number | boolean | null | undefined;

export type NotificationEntityType = "booking" | "payment" | "quote" | "cron_run";

export type NotificationDispatchStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

export function computeDedupeKey(input: {
  entityType: NotificationEntityType | string;
  entityId: string;
  eventType: string;
  extra?: KeyPart | KeyPart[] | Record<string, KeyPart>;
}) {
  const base = `${String(input.entityType).trim()}:${String(input.entityId).trim()}:${String(input.eventType).trim()}`;
  const { extra } = input;
  if (extra === undefined || extra === null) return base;

  if (Array.isArray(extra)) {
    const encoded = extra
      .map((value) => (value === null || value === undefined ? "" : String(value).trim()))
      .join(":");
    return encoded ? `${base}:${encoded}` : base;
  }

  if (typeof extra === "object") {
    const encoded = Object.keys(extra)
      .sort()
      .map((key) => `${key}=${extra[key] === null || extra[key] === undefined ? "" : String(extra[key]).trim()}`)
      .join("|");
    return encoded ? `${base}:${encoded}` : base;
  }

  const encoded = String(extra).trim();
  return encoded ? `${base}:${encoded}` : base;
}

export async function tryAcquireDedupe(
  input: {
    dedupeKey: string;
    entityType: NotificationEntityType | string;
    entityId: string;
    eventType: string;
    channel?: string;
    provider?: string | null;
    initialStatus?: NotificationDispatchStatus;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  try {
    await queryFn(
      "insert into notification_dispatch_log (entity_type, entity_id, event_type, dedupe_key, channel, provider, status) values ($1, $2::uuid, $3, $4, $5, $6, $7)",
      [
        input.entityType,
        input.entityId,
        input.eventType,
        input.dedupeKey,
        input.channel ?? "email",
        input.provider ?? null,
        input.initialStatus ?? "PENDING",
      ],
    );
    return { ok: true, acquired: true };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "23505") {
      return { ok: false, acquired: false };
    }
    throw error;
  }
}

export async function markDedupeResult(
  input: {
    dedupeKey: string;
    status: NotificationDispatchStatus;
    provider?: string | null;
    providerMessageId?: string | null;
    error?: string | null;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  await queryFn(
    "update notification_dispatch_log set status = $2, provider = coalesce($3, provider), provider_message_id = coalesce($4, provider_message_id), error = $5 where dedupe_key = $1",
    [
      input.dedupeKey,
      input.status,
      input.provider ?? null,
      input.providerMessageId ?? null,
      input.error ? input.error.slice(0, 1000) : null,
    ],
  );
}

// Compatibility wrapper for existing call sites.
export async function shouldSendNotification(
  input: Parameters<typeof tryAcquireDedupe>[0],
  queryFn: DbQueryFn = dbQuery,
) {
  const result = await tryAcquireDedupe(input, queryFn);
  return { shouldSend: result.acquired };
}

// Compatibility wrapper for existing call sites.
export async function markNotificationResult(
  input: Parameters<typeof markDedupeResult>[0],
  queryFn: DbQueryFn = dbQuery,
) {
  return markDedupeResult(input, queryFn);
}
