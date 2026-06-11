import { dbQuery } from "@/lib/db";
import { logError, logWarn, redactText } from "@/lib/log";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "onboarding@resend.dev";

type DbQueryFn = <T = unknown>(text: string, params?: unknown[]) => Promise<{
  rows: T[];
  rowCount: number;
}>;

export const EMAIL_DISPATCH_STATUSES = [
  "PENDING",
  "SENT",
  "FAILED",
  "BOUNCED",
  "DELIVERY_ISSUE",
  "SKIPPED",
] as const;

export type EmailDispatchStatus = (typeof EMAIL_DISPATCH_STATUSES)[number];

export type EmailDispatchSource =
  | "public_booking"
  | "admin_booking"
  | "admin_payment"
  | "admin_quote"
  | "admin_resend"
  | "wipay_reconcile"
  | "cron"
  | "contact_alert"
  | "public_returning_customer"
  | "system";

export type EmailDispatchEventSource =
  | "dispatch"
  | "provider_webhook"
  | "admin_resend"
  | "legacy"
  | "system";

export type EmailDispatchAttachment = {
  filename: string;
  content: string;
};

export type EmailDispatchContext = {
  entityType?: string | null;
  entityId?: string | null;
  entityPublicId?: string | null;
  emailType: string;
  recipientName?: string | null;
  triggeredByUserId?: string | null;
  triggerSource: EmailDispatchSource | string;
  relatedTransactionType?: string | null;
  relatedTransactionId?: string | null;
  manualResendAllowed?: boolean;
  metadata?: Record<string, unknown> | null;
};

export type EmailDispatchRow = {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_public_id: string | null;
  email_type: string;
  channel: string;
  provider: string;
  provider_message_id: string | null;
  status: EmailDispatchStatus;
  to_email: string;
  subject: string;
  recipient_name: string | null;
  triggered_by_user_id: string | null;
  trigger_source: string;
  related_transaction_type: string | null;
  related_transaction_id: string | null;
  error: string | null;
  provider_error_category: string | null;
  provider_error_reason: string | null;
  manual_resend_allowed: boolean;
  metadata_json: Record<string, unknown>;
  sent_at: string | Date | null;
  last_event_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type CreateEmailDispatchRow = {
  id: string;
};

type SendTrackedResendEmailInput = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string | null;
  attachments?: EmailDispatchAttachment[];
  dispatch: EmailDispatchContext;
};

export type SendTrackedEmailResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  providerMessageId?: string | null;
  emailDispatchId?: string | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function sanitizeErrorText(value: unknown, maxLength = 1000) {
  const safe = redactText(String(value ?? "")).replace(/\s+/g, " ").trim();
  return safe ? safe.slice(0, maxLength) : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMetadata(value: unknown) {
  return isPlainObject(value) ? value : {};
}

function makeTagValue(value: unknown, maxLength = 240) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : "";
}

export function buildEmailDispatchTags(
  dispatchId: string,
  context: EmailDispatchContext,
) {
  const tags: Array<{ name: string; value: string }> = [];
  const push = (name: string, value: unknown) => {
    const normalized = makeTagValue(value);
    if (!normalized) return;
    tags.push({ name, value: normalized });
  };

  push("dispatchId", dispatchId);
  push("entityType", context.entityType);
  push("entityId", context.entityId);
  push("entityPublicId", context.entityPublicId);
  push("emailType", context.emailType);
  push("transactionType", context.relatedTransactionType);
  push("transactionId", context.relatedTransactionId);
  push("triggerSource", context.triggerSource);

  return tags;
}

export async function recordEmailDispatchEvent(
  input: {
    emailDispatchId: string;
    source: EmailDispatchEventSource | string;
    eventType: string;
    status?: string | null;
    occurredAt?: string | Date | null;
    details?: Record<string, unknown> | null;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  await queryFn(
    "insert into email_dispatch_events (email_dispatch_id, source, event_type, status, occurred_at, details_json) values ($1::uuid, $2, $3, $4, coalesce($5::timestamptz, now()), $6::jsonb)",
    [
      input.emailDispatchId,
      normalizeText(input.source),
      normalizeText(input.eventType),
      normalizeNullableText(input.status),
      input.occurredAt ? new Date(input.occurredAt).toISOString() : null,
      JSON.stringify(normalizeMetadata(input.details)),
    ],
  );
}

export async function createEmailDispatch(
  input: {
    toEmail: string;
    subject: string;
    provider?: string | null;
    channel?: string | null;
    status?: EmailDispatchStatus;
    context: EmailDispatchContext;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  const result = await queryFn<CreateEmailDispatchRow>(
    "insert into email_dispatches (entity_type, entity_id, entity_public_id, email_type, channel, provider, status, to_email, subject, recipient_name, triggered_by_user_id, trigger_source, related_transaction_type, related_transaction_id, manual_resend_allowed, metadata_json) values ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid, $12, $13, $14, $15, $16::jsonb) returning id",
    [
      normalizeNullableText(input.context.entityType),
      normalizeNullableText(input.context.entityId),
      normalizeNullableText(input.context.entityPublicId),
      normalizeText(input.context.emailType),
      normalizeText(input.channel) || "email",
      normalizeText(input.provider) || "resend",
      input.status ?? "PENDING",
      normalizeText(input.toEmail),
      normalizeText(input.subject),
      normalizeNullableText(input.context.recipientName),
      normalizeNullableText(input.context.triggeredByUserId),
      normalizeText(input.context.triggerSource) || "system",
      normalizeNullableText(input.context.relatedTransactionType),
      normalizeNullableText(input.context.relatedTransactionId),
      Boolean(input.context.manualResendAllowed),
      JSON.stringify(normalizeMetadata(input.context.metadata)),
    ],
  );

  const dispatchId = result.rows[0]?.id ?? null;
  if (!dispatchId) {
    throw new Error("Failed to create email dispatch row");
  }

  await recordEmailDispatchEvent(
    {
      emailDispatchId: dispatchId,
      source: "dispatch",
      eventType: "dispatch.created",
      status: input.status ?? "PENDING",
      details: {
        channel: normalizeText(input.channel) || "email",
        provider: normalizeText(input.provider) || "resend",
      },
    },
    queryFn,
  );

  return dispatchId;
}

async function updateEmailDispatch(
  input: {
    id: string;
    status: EmailDispatchStatus;
    providerMessageId?: string | null;
    error?: string | null;
    providerErrorCategory?: string | null;
    providerErrorReason?: string | null;
    sentAt?: string | Date | null;
    lastEventAt?: string | Date | null;
    eventType: string;
    eventSource?: EmailDispatchEventSource | string;
    eventDetails?: Record<string, unknown> | null;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  await queryFn(
    "update email_dispatches set status = $2, provider_message_id = coalesce($3, provider_message_id), error = $4, provider_error_category = $5, provider_error_reason = $6, sent_at = case when $7::timestamptz is not null then $7::timestamptz when $2 = 'SENT' and sent_at is null then now() else sent_at end, last_event_at = coalesce($8::timestamptz, now()), updated_at = now() where id = $1::uuid",
    [
      input.id,
      input.status,
      normalizeNullableText(input.providerMessageId),
      sanitizeErrorText(input.error),
      sanitizeErrorText(input.providerErrorCategory, 255),
      sanitizeErrorText(input.providerErrorReason, 1000),
      input.sentAt ? new Date(input.sentAt).toISOString() : null,
      input.lastEventAt ? new Date(input.lastEventAt).toISOString() : null,
    ],
  );

  await recordEmailDispatchEvent(
    {
      emailDispatchId: input.id,
      source: input.eventSource ?? "dispatch",
      eventType: input.eventType,
      status: input.status,
      occurredAt: input.lastEventAt ?? input.sentAt ?? null,
      details: {
        providerMessageId: normalizeNullableText(input.providerMessageId),
        error: sanitizeErrorText(input.error),
        providerErrorCategory: sanitizeErrorText(input.providerErrorCategory, 255),
        providerErrorReason: sanitizeErrorText(input.providerErrorReason, 1000),
        ...normalizeMetadata(input.eventDetails),
      },
    },
    queryFn,
  );
}

export async function markEmailDispatchSent(
  input: {
    id: string;
    providerMessageId?: string | null;
    sentAt?: string | Date | null;
    eventDetails?: Record<string, unknown> | null;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  return updateEmailDispatch(
    {
      id: input.id,
      status: "SENT",
      providerMessageId: input.providerMessageId ?? null,
      sentAt: input.sentAt ?? null,
      eventType: "dispatch.sent",
      eventDetails: input.eventDetails,
    },
    queryFn,
  );
}

export async function markEmailDispatchFailed(
  input: {
    id: string;
    error?: string | null;
    providerMessageId?: string | null;
    providerErrorCategory?: string | null;
    providerErrorReason?: string | null;
    lastEventAt?: string | Date | null;
    eventSource?: EmailDispatchEventSource | string;
    eventType?: string;
    eventDetails?: Record<string, unknown> | null;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  return updateEmailDispatch(
    {
      id: input.id,
      status: "FAILED",
      providerMessageId: input.providerMessageId ?? null,
      error: input.error ?? null,
      providerErrorCategory: input.providerErrorCategory ?? null,
      providerErrorReason: input.providerErrorReason ?? null,
      lastEventAt: input.lastEventAt ?? null,
      eventSource: input.eventSource ?? "dispatch",
      eventType: input.eventType ?? "dispatch.failed",
      eventDetails: input.eventDetails,
    },
    queryFn,
  );
}

export async function markEmailDispatchSkipped(
  input: {
    id: string;
    error?: string | null;
    eventDetails?: Record<string, unknown> | null;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  return updateEmailDispatch(
    {
      id: input.id,
      status: "SKIPPED",
      error: input.error ?? null,
      eventType: "dispatch.skipped",
      eventDetails: input.eventDetails,
    },
    queryFn,
  );
}

export async function applyProviderEventToEmailDispatch(
  input: {
    id: string;
    eventType: string;
    occurredAt: string;
    providerMessageId?: string | null;
    status: Extract<
      EmailDispatchStatus,
      "SENT" | "FAILED" | "BOUNCED" | "DELIVERY_ISSUE"
    >;
    error?: string | null;
    providerErrorCategory?: string | null;
    providerErrorReason?: string | null;
    details?: Record<string, unknown> | null;
  },
  queryFn: DbQueryFn = dbQuery,
) {
  return updateEmailDispatch(
    {
      id: input.id,
      status: input.status,
      providerMessageId: input.providerMessageId ?? null,
      error: input.error ?? null,
      providerErrorCategory: input.providerErrorCategory ?? null,
      providerErrorReason: input.providerErrorReason ?? null,
      lastEventAt: input.occurredAt,
      eventSource: "provider_webhook",
      eventType: input.eventType,
      eventDetails: input.details,
    },
    queryFn,
  );
}

export async function fetchEmailDispatchByProviderMessageId(
  provider: string,
  providerMessageId: string,
  queryFn: DbQueryFn = dbQuery,
) {
  const result = await queryFn<EmailDispatchRow>(
    "select id, entity_type, entity_id, entity_public_id, email_type, channel, provider, provider_message_id, status, to_email, subject, recipient_name, triggered_by_user_id, trigger_source, related_transaction_type, related_transaction_id, error, provider_error_category, provider_error_reason, manual_resend_allowed, metadata_json, sent_at, last_event_at, created_at, updated_at from email_dispatches where provider = $1 and provider_message_id = $2 order by created_at desc limit 1",
    [normalizeText(provider), normalizeText(providerMessageId)],
  );
  return result.rows[0] ?? null;
}

export async function sendTrackedResendEmail(
  input: SendTrackedResendEmailInput,
  queryFn: DbQueryFn = dbQuery,
): Promise<SendTrackedEmailResult> {
  const dispatchId = await createEmailDispatch(
    {
      toEmail: input.to,
      subject: input.subject,
      provider: "resend",
      context: input.dispatch,
    },
    queryFn,
  );

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM?.trim() || DEFAULT_FROM;

  if (!apiKey) {
    logWarn("resend_email_skipped", {
      reason: "RESEND_API_KEY not set",
      emailType: input.dispatch.emailType,
      dispatchId,
    });
    await markEmailDispatchSkipped(
      {
        id: dispatchId,
        error: "RESEND_API_KEY not set",
      },
      queryFn,
    );
    return {
      ok: false,
      skipped: true,
      error: "RESEND_API_KEY not set",
      emailDispatchId: dispatchId,
    };
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      reply_to: input.replyTo ?? from,
      attachments: input.attachments,
      tags: buildEmailDispatchTags(dispatchId, input.dispatch),
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { id?: unknown; message?: unknown; name?: unknown }
    | null;
  const providerMessageId = typeof payload?.id === "string" ? payload.id : null;

  if (!response.ok) {
    const safeError = sanitizeErrorText(payload?.message ?? `HTTP ${response.status}`, 300) ?? `HTTP ${response.status}`;
    logError("resend_email_failed", new Error(`HTTP ${response.status}`), {
      status: response.status,
      responseBody: payload?.message ?? null,
      to: input.to,
      subject: input.subject,
      emailType: input.dispatch.emailType,
      dispatchId,
    });
    await markEmailDispatchFailed(
      {
        id: dispatchId,
        error: safeError,
        providerMessageId,
        providerErrorCategory: typeof payload?.name === "string" ? payload.name : null,
        providerErrorReason: safeError,
        eventDetails: { statusCode: response.status },
      },
      queryFn,
    );
    return {
      ok: false,
      error: safeError,
      providerMessageId,
      emailDispatchId: dispatchId,
    };
  }

  await markEmailDispatchSent(
    {
      id: dispatchId,
      providerMessageId,
    },
    queryFn,
  );

  return {
    ok: true,
    providerMessageId,
    emailDispatchId: dispatchId,
  };
}
