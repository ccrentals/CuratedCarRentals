import { createHmac, timingSafeEqual } from "node:crypto";

import { getDbPool } from "@/lib/db";
import { redactText } from "@/lib/log";
import { applyProviderEventToEmailDispatch } from "@/lib/notifications/emailDispatch";

type QueryResult<T = unknown> = Promise<{ rows: T[]; rowCount: number }>;

type DbClient = {
  query: <T = unknown>(text: string, params?: unknown[]) => QueryResult<T>;
  release?: () => void;
};

type DbPoolLike = {
  connect: () => Promise<DbClient>;
};

type ContactMessageInsertRow = {
  id: string;
  created_at: string | Date;
};

type QuoteEmailCorrelationRow = {
  id: string;
  quote_id: string;
  quote_public_id: string | null;
  to_email: string | null;
  subject: string | null;
};

type EmailDispatchCorrelationRow = {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_public_id: string | null;
  email_type: string | null;
};

type DispatchCorrelationRow = {
  entity_type: string;
  entity_id: string;
  event_type: string | null;
};

type PublicIdRow = {
  public_id: string | null;
};

type ResendWebhookVerificationInput = {
  rawBody: string;
  headers: Headers;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
};

export type ResendWebhookVerificationResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export type ResendWebhookEvent = {
  webhookMessageId: string | null;
  eventType: string;
  occurredAt: string;
  providerEmailId: string | null;
  recipientEmails: string[];
  primaryRecipient: string | null;
  subject: string | null;
  tags: Record<string, string>;
  reason: string | null;
  category: string | null;
  providerData: Record<string, unknown>;
};

export type ResendWebhookCorrelation = {
  emailDispatchId: string | null;
  entityType: string | null;
  entityId: string | null;
  entityPublicId: string | null;
  source: "tags" | "email_dispatch" | "quote_email" | "notification_dispatch_log" | "none";
  relatedEventType: string | null;
};

export type ResendWebhookProcessResult =
  | {
      handled: false;
      duplicate: false;
      eventType: string;
    }
  | {
      handled: true;
      duplicate: boolean;
      eventType: string;
      notificationId: string | null;
      correlation: ResendWebhookCorrelation;
    };

type ResendWebhookProcessDeps = {
  getDbPoolFn?: () => DbPoolLike;
};

const SUPPORTED_RESEND_EVENT_TYPES = new Set(["email.bounced", "email.failed"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeEmail(value: string | null) {
  const normalized = asString(value);
  return normalized || "unknown@delivery.invalid";
}

function normalizeEventType(value: unknown) {
  return asString(value).toLowerCase();
}

function normalizeTimestamp(value: unknown) {
  const text = asString(value);
  if (!text) return new Date().toISOString();
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString();
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => asString(entry))
      .filter(Boolean);
  }
  const text = asString(value);
  return text ? [text] : [];
}

function sanitizeDetailText(value: unknown) {
  const text = redactText(asString(value)).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 500) : "";
}

function tryReadString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = sanitizeDetailText(record[key]);
    if (value) return value;
  }
  return "";
}

function normalizeTagKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function extractTags(value: unknown) {
  const out: Record<string, string> = {};

  if (Array.isArray(value)) {
    for (const entry of value) {
      const tag = asRecord(entry);
      if (!tag) continue;
      const name = asString(tag.name || tag.key);
      const tagValue = asString(tag.value);
      if (!name || !tagValue) continue;
      out[normalizeTagKey(name)] = tagValue;
    }
    return out;
  }

  const record = asRecord(value);
  if (!record) return out;
  for (const [key, rawValue] of Object.entries(record)) {
    const tagValue = asString(rawValue);
    if (!tagValue) continue;
    out[normalizeTagKey(key)] = tagValue;
  }
  return out;
}

function readTag(tags: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = tags[normalizeTagKey(key)];
    if (value) return value;
  }
  return "";
}

function humanizeEventType(eventType: string) {
  if (eventType === "email.bounced") return "Email bounced";
  if (eventType === "email.failed") return "Email failed";
  return eventType;
}

function buildSyntheticEventId(event: ResendWebhookEvent) {
  return [
    event.eventType,
    event.providerEmailId || "",
    event.primaryRecipient || "",
    event.occurredAt,
  ].join(":");
}

function buildAdminMessageBody(input: {
  event: ResendWebhookEvent;
  correlation: ResendWebhookCorrelation;
}) {
  const relatedEntity =
    input.correlation.entityType && (input.correlation.entityPublicId || input.correlation.entityId)
      ? `${input.correlation.entityType} ${input.correlation.entityPublicId || input.correlation.entityId}`
      : "Unknown";
  const lines = [
    `${humanizeEventType(input.event.eventType)} reported by Resend.`,
    `Recipient: ${input.event.primaryRecipient || "Unknown"}`,
    `Occurred: ${input.event.occurredAt}`,
    `Related entity: ${relatedEntity}`,
  ];

  if (input.event.subject) {
    lines.push(`Subject: ${input.event.subject}`);
  }
  if (input.event.reason) {
    lines.push(`Reason: ${input.event.reason}`);
  }
  if (input.event.category) {
    lines.push(`Category: ${input.event.category}`);
  }
  if (input.event.providerEmailId) {
    lines.push(`Provider email ID: ${input.event.providerEmailId}`);
  }

  return lines.join("\n");
}

function getSignatureCandidates(signatureHeader: string) {
  return signatureHeader
    .split(/\s+/)
    .flatMap((entry) => {
      const [version, signature] = entry.split(",");
      if (version === "v1" && signature) return [signature.trim()];
      return [];
    })
    .filter(Boolean);
}

function decodeWebhookSecret(secret: string) {
  const normalized = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return Buffer.from(normalized, "base64");
}

function safeCompareBase64(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyResendWebhookSignature({
  rawBody,
  headers,
  secret,
  nowMs = Date.now(),
  toleranceSeconds = 5 * 60,
}: ResendWebhookVerificationInput): ResendWebhookVerificationResult {
  const webhookId = asString(headers.get("svix-id"));
  const webhookTimestamp = asString(headers.get("svix-timestamp"));
  const webhookSignature = asString(headers.get("svix-signature"));

  if (!secret.trim()) {
    return { ok: false, status: 503, error: "RESEND_WEBHOOK_SECRET is not configured." };
  }

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return { ok: false, status: 401, error: "Missing Resend webhook signature headers." };
  }

  const timestampSeconds = Number(webhookTimestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, status: 401, error: "Invalid Resend webhook timestamp." };
  }

  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestampSeconds);
  if (ageSeconds > toleranceSeconds) {
    return { ok: false, status: 401, error: "Resend webhook timestamp is outside the allowed tolerance." };
  }

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", decodeWebhookSecret(secret))
    .update(signedContent)
    .digest("base64");

  const candidates = getSignatureCandidates(webhookSignature);
  if (!candidates.some((candidate) => safeCompareBase64(candidate, expected))) {
    return { ok: false, status: 401, error: "Invalid Resend webhook signature." };
  }

  return { ok: true };
}

export function normalizeResendWebhookEvent(payload: unknown, webhookMessageId?: string | null) {
  const root = asRecord(payload);
  if (!root) return null;

  const eventType = normalizeEventType(root.type);
  if (!eventType) return null;

  const providerData = asRecord(root.data) ?? {};
  const recipientEmails = normalizeStringArray(providerData.to ?? root.to);
  const primaryRecipient = recipientEmails[0] ?? null;

  const errorRecord = asRecord(providerData.error);
  const bounceRecord = asRecord(providerData.bounce);
  const failureRecord = asRecord(providerData.failure);

  const reason =
    tryReadString(providerData, ["reason", "failure_reason", "status_message", "message"]) ||
    (errorRecord
      ? tryReadString(errorRecord, ["message", "detail", "error", "name"])
      : "") ||
    (bounceRecord
      ? tryReadString(bounceRecord, ["reason", "diagnostic_code", "description", "sub_type"])
      : "") ||
    (failureRecord
      ? tryReadString(failureRecord, ["reason", "message", "detail"])
      : "") ||
    "";

  const category =
    (bounceRecord ? tryReadString(bounceRecord, ["type", "sub_type"]) : "") ||
    (errorRecord ? tryReadString(errorRecord, ["name", "code", "type"]) : "") ||
    tryReadString(providerData, ["category", "last_event"]);

  return {
    webhookMessageId: asString(webhookMessageId),
    eventType,
    occurredAt: normalizeTimestamp(root.created_at ?? providerData.created_at),
    providerEmailId:
      asString(providerData.email_id) ||
      asString(providerData.id) ||
      asString(root.email_id) ||
      null,
    recipientEmails,
    primaryRecipient,
    subject: asString(providerData.subject) || null,
    tags: extractTags(providerData.tags ?? providerData.metadata ?? root.tags),
    reason: reason || null,
    category: category || null,
    providerData,
  } satisfies ResendWebhookEvent;
}

async function lookupQuoteCorrelation(client: DbClient, providerEmailId: string) {
  const result = await client.query(
    "select qe.id, qe.quote_id, q.public_id as quote_public_id, qe.to_email, qe.subject from quote_emails qe join quotes q on q.id = qe.quote_id where qe.provider_message_id = $1 limit 1",
    [providerEmailId],
  );
  return (result.rows[0] as QuoteEmailCorrelationRow | undefined) ?? null;
}

async function lookupEmailDispatchById(client: DbClient, dispatchId: string) {
  const result = await client.query(
    "select id, entity_type, entity_id, entity_public_id, email_type from email_dispatches where id = $1::uuid limit 1",
    [dispatchId],
  );
  return (result.rows[0] as EmailDispatchCorrelationRow | undefined) ?? null;
}

async function lookupEmailDispatchByProviderMessageId(client: DbClient, providerEmailId: string) {
  const result = await client.query(
    "select id, entity_type, entity_id, entity_public_id, email_type from email_dispatches where provider = 'resend' and provider_message_id = $1 order by created_at desc limit 1",
    [providerEmailId],
  );
  return (result.rows[0] as EmailDispatchCorrelationRow | undefined) ?? null;
}

async function lookupDispatchCorrelation(client: DbClient, providerEmailId: string) {
  const result = await client.query(
    "select entity_type, entity_id, event_type from notification_dispatch_log where provider_message_id = $1 limit 1",
    [providerEmailId],
  );
  return (result.rows[0] as DispatchCorrelationRow | undefined) ?? null;
}

async function lookupEntityPublicId(
  client: DbClient,
  entityType: string,
  entityId: string,
) {
  if (!UUID_RE.test(entityId)) return null;

  if (entityType === "booking") {
    const result = await client.query(
      "select public_id from bookings where id = $1::uuid limit 1",
      [entityId],
    );
    return asString((result.rows[0] as PublicIdRow | undefined)?.public_id) || null;
  }

  if (entityType === "quote") {
    const result = await client.query(
      "select public_id from quotes where id = $1::uuid limit 1",
      [entityId],
    );
    return asString((result.rows[0] as PublicIdRow | undefined)?.public_id) || null;
  }

  return null;
}

async function correlateResendWebhookEvent(
  client: DbClient,
  event: ResendWebhookEvent,
): Promise<ResendWebhookCorrelation> {
  const tagDispatchId = readTag(event.tags, ["dispatchId", "emailDispatchId", "email_dispatch_id"]);
  const tagBookingId = readTag(event.tags, ["bookingId", "booking_id"]);
  const tagQuoteId = readTag(event.tags, ["quoteId", "quote_id"]);
  const tagCustomerId = readTag(event.tags, ["customerId", "customer_id"]);
  const tagUserId = readTag(event.tags, ["userId", "user_id"]);
  const tagBookingPublicId = readTag(event.tags, ["bookingPublicId", "booking_public_id", "bookingReference"]);
  const tagQuotePublicId = readTag(event.tags, ["quotePublicId", "quote_public_id", "quoteReference"]);

  if (UUID_RE.test(tagDispatchId)) {
    const emailDispatch = await lookupEmailDispatchById(client, tagDispatchId);
    if (emailDispatch) {
      return {
        emailDispatchId: emailDispatch.id,
        entityType: asString(emailDispatch.entity_type) || null,
        entityId: asString(emailDispatch.entity_id) || null,
        entityPublicId: asString(emailDispatch.entity_public_id) || null,
        source: "tags",
        relatedEventType: asString(emailDispatch.email_type) || null,
      };
    }
  }

  if (tagBookingId || tagBookingPublicId) {
    return {
      emailDispatchId: null,
      entityType: "booking",
      entityId: tagBookingId || null,
      entityPublicId: tagBookingPublicId || null,
      source: "tags",
      relatedEventType: readTag(event.tags, ["emailType", "eventType"]) || null,
    };
  }

  if (tagQuoteId || tagQuotePublicId) {
    return {
      emailDispatchId: null,
      entityType: "quote",
      entityId: tagQuoteId || null,
      entityPublicId: tagQuotePublicId || null,
      source: "tags",
      relatedEventType: readTag(event.tags, ["emailType", "eventType"]) || null,
    };
  }

  if (tagCustomerId) {
    return {
      emailDispatchId: null,
      entityType: "customer",
      entityId: tagCustomerId,
      entityPublicId: null,
      source: "tags",
      relatedEventType: readTag(event.tags, ["emailType", "eventType"]) || null,
    };
  }

  if (tagUserId) {
    return {
      emailDispatchId: null,
      entityType: "user",
      entityId: tagUserId,
      entityPublicId: null,
      source: "tags",
      relatedEventType: readTag(event.tags, ["emailType", "eventType"]) || null,
    };
  }

  if (event.providerEmailId) {
    const emailDispatch = await lookupEmailDispatchByProviderMessageId(client, event.providerEmailId);
    if (emailDispatch) {
      return {
        emailDispatchId: emailDispatch.id,
        entityType: asString(emailDispatch.entity_type) || null,
        entityId: asString(emailDispatch.entity_id) || null,
        entityPublicId: asString(emailDispatch.entity_public_id) || null,
        source: "email_dispatch",
        relatedEventType: asString(emailDispatch.email_type) || null,
      };
    }

    const quote = await lookupQuoteCorrelation(client, event.providerEmailId);
    if (quote) {
      return {
        emailDispatchId: null,
        entityType: "quote",
        entityId: quote.quote_id,
        entityPublicId: asString(quote.quote_public_id) || null,
        source: "quote_email",
        relatedEventType: null,
      };
    }

    const dispatch = await lookupDispatchCorrelation(client, event.providerEmailId);
    if (dispatch) {
      return {
        emailDispatchId: null,
        entityType: asString(dispatch.entity_type) || null,
        entityId: asString(dispatch.entity_id) || null,
        entityPublicId:
          (await lookupEntityPublicId(
            client,
            asString(dispatch.entity_type),
            asString(dispatch.entity_id),
          )) || null,
        source: "notification_dispatch_log",
        relatedEventType: asString(dispatch.event_type) || null,
      };
    }
  }

  return {
    emailDispatchId: null,
    entityType: null,
    entityId: null,
    entityPublicId: null,
    source: "none",
    relatedEventType: null,
  };
}

async function insertAdminNotificationMessage(
  client: DbClient,
  input: {
    recipientEmail: string | null;
    message: string;
  },
) {
  const result = await client.query(
    "insert into contact_messages (name, email, message, source) values ($1, $2, $3, $4) returning id, created_at",
    [
      "Email delivery issue",
      safeEmail(input.recipientEmail),
      input.message,
      "resend_webhook",
    ],
  );
  return (result.rows[0] as ContactMessageInsertRow | undefined) ?? null;
}

async function insertResendIssueAuditLog(
  client: DbClient,
  input: {
    event: ResendWebhookEvent;
    correlation: ResendWebhookCorrelation;
    notificationId: string | null;
  },
) {
  const entityType = input.correlation.entityType || "email";
  const entityId =
    input.correlation.entityId ||
    input.event.providerEmailId ||
    input.event.primaryRecipient ||
    input.event.webhookMessageId ||
    null;

  await client.query(
    "insert into audit_logs (user_id, action, entity_type, entity_id, details_json) values ($1, $2, $3, $4, $5)",
    [
      null,
      "RESEND_EMAIL_DELIVERY_ISSUE",
      entityType,
      entityId,
      {
        provider: "resend",
        eventType: input.event.eventType,
        occurredAt: input.event.occurredAt,
        recipientEmail: input.event.primaryRecipient,
        recipientEmails: input.event.recipientEmails,
        subject: input.event.subject,
        reason: input.event.reason,
        category: input.event.category,
        providerEmailId: input.event.providerEmailId,
        webhookMessageId: input.event.webhookMessageId,
        correlation: input.correlation,
        notificationId: input.notificationId,
        tags: input.event.tags,
        providerData: input.event.providerData,
      },
    ],
  );
}

export async function processResendWebhookEvent(
  event: ResendWebhookEvent,
  deps: ResendWebhookProcessDeps = {},
): Promise<ResendWebhookProcessResult> {
  if (!SUPPORTED_RESEND_EVENT_TYPES.has(event.eventType)) {
    return {
      handled: false,
      duplicate: false,
      eventType: event.eventType,
    };
  }

  const pool = (deps.getDbPoolFn ?? getDbPool)();
  const client = await pool.connect();
  try {
    await client.query("begin");

    const eventId = event.webhookMessageId || buildSyntheticEventId(event);
    const inserted = await client.query(
      "insert into webhook_events (provider, event_id) values ($1, $2) on conflict (provider, event_id) do nothing returning id",
      ["RESEND", eventId],
    );

    if (inserted.rowCount === 0) {
      await client.query("rollback");
      return {
        handled: true,
        duplicate: true,
        eventType: event.eventType,
        notificationId: null,
        correlation: {
          emailDispatchId: null,
          entityType: null,
          entityId: null,
          entityPublicId: null,
          source: "none",
          relatedEventType: null,
        },
      };
    }

    const correlation = await correlateResendWebhookEvent(client, event);
    if (correlation.emailDispatchId) {
      await applyProviderEventToEmailDispatch(
        {
          id: correlation.emailDispatchId,
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          providerMessageId: event.providerEmailId,
          status: event.eventType === "email.bounced" ? "BOUNCED" : "FAILED",
          error: event.reason,
          providerErrorCategory: event.category,
          providerErrorReason: event.reason,
          details: {
            webhookMessageId: event.webhookMessageId,
            primaryRecipient: event.primaryRecipient,
            subject: event.subject,
            tags: event.tags,
            providerData: event.providerData,
          },
        },
        client.query.bind(client),
      );
    }

    const notification = await insertAdminNotificationMessage(client, {
      recipientEmail: event.primaryRecipient,
      message: buildAdminMessageBody({ event, correlation }),
    });

    await insertResendIssueAuditLog(client, {
      event,
      correlation,
      notificationId: notification?.id ?? null,
    });

    await client.query("commit");

    return {
      handled: true,
      duplicate: false,
      eventType: event.eventType,
      notificationId: notification?.id ?? null,
      correlation,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
}
