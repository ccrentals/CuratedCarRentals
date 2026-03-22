import { loadAdminSettings } from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
import { logWarn } from "@/lib/log";
import {
  parseEmailList,
  sendContactMessageCreatedAlert,
  sendContactMessagesDigestAlert,
  type ContactMessageAlertResult,
} from "@/lib/notifications/contactMessageAlert";
import { consumeRateLimit } from "@/lib/rateLimitStore";

type UnreadMessageRow = {
  id: string;
  created_at: string;
  name: string;
  email: string;
  message: string;
};

export type ContactNotificationMessageItem = {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  message: string;
};

export type ContactNotificationSummary = {
  totalNew: number;
  items: ContactNotificationMessageItem[];
};

export type ContactMessageNotifierDeps = {
  loadSettings: () => Promise<{
    settings: {
      contactNotificationEmails: string;
      contactNotifyCooldownMinutes: number;
    };
  }>;
  nowMs: () => number;
  allowByThrottle: (input: { cooldownMinutes: number; nowMs: number }) => Promise<boolean>;
  loadUnreadSummary: () => Promise<ContactNotificationSummary>;
  sendSingle: (input: {
    recipients?: string[];
    message: ContactNotificationMessageItem;
  }) => Promise<ContactMessageAlertResult>;
  sendDigest: (input: {
    recipients?: string[];
    totalNew: number;
    items: ContactNotificationMessageItem[];
  }) => Promise<ContactMessageAlertResult>;
  envHasRecipients: () => boolean;
  warnNoRecipients: () => void;
};

let recipientWarningShown = false;
let fallbackLastNotificationAtMs = 0;

function normalizeCooldownMinutes(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(120, Math.max(1, Math.floor(parsed)));
}

function isRateLimitsTableMissingError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return code === "42P01" && message.includes("rate_limits");
}

export type ContactMessageNotifierQuery = typeof dbQuery;

async function allowByNotificationThrottle(input: { cooldownMinutes: number; nowMs: number }) {
  const windowSeconds = input.cooldownMinutes * 60;
  try {
    const result = await consumeRateLimit({
      scope: "CONTACT_NOTIFY",
      subjectKey: "global",
      limit: 1,
      windowSeconds,
      nowMs: input.nowMs,
    });
    return result.allowed;
  } catch (error) {
    if (!isRateLimitsTableMissingError(error)) {
      throw error;
    }

    if (fallbackLastNotificationAtMs > 0) {
      const elapsed = input.nowMs - fallbackLastNotificationAtMs;
      if (elapsed < input.cooldownMinutes * 60 * 1000) {
        return false;
      }
    }

    fallbackLastNotificationAtMs = input.nowMs;
    return true;
  }
}

export async function loadUnreadContactSummary(
  query: ContactMessageNotifierQuery = dbQuery,
): Promise<ContactNotificationSummary> {
  const countResult = await query<{ count: unknown }>(
    "select count(*)::int as count from contact_messages where status = 'NEW' and coalesce(source, 'contact_page') = 'contact_page'",
  );
  const totalNew = Number(countResult.rows[0]?.count ?? 0);

  const previewRows = await query<UnreadMessageRow>(
    "select id, created_at, name, email, message from contact_messages where status = 'NEW' and coalesce(source, 'contact_page') = 'contact_page' order by created_at desc, id::text desc limit 3",
  );

  return {
    totalNew,
    items: previewRows.rows.map((row: UnreadMessageRow) => ({
      id: row.id,
      createdAt: row.created_at,
      name: row.name,
      email: row.email,
      message: row.message,
    })),
  };
}

function defaultWarnNoRecipients() {
  if (recipientWarningShown) return;
  recipientWarningShown = true;
  logWarn("contact_message_notification_recipients_missing", {
    settingKey: "contactNotificationEmails",
    envFallback: "ADMIN_NOTIFY_EMAILS",
  });
}

const DEFAULT_DEPS: ContactMessageNotifierDeps = {
  loadSettings: () => loadAdminSettings(),
  nowMs: () => Date.now(),
  allowByThrottle: (input) => allowByNotificationThrottle(input),
  loadUnreadSummary: () => loadUnreadContactSummary(),
  sendSingle: ({ recipients, message }) =>
    sendContactMessageCreatedAlert({
      messageId: message.id,
      createdAt: message.createdAt,
      name: message.name,
      email: message.email,
      message: message.message,
      source: "contact_page",
      recipients,
    }),
  sendDigest: ({ recipients, totalNew, items }) =>
    sendContactMessagesDigestAlert({
      totalNew,
      recipients,
      items,
    }),
  envHasRecipients: () =>
    Boolean(process.env.ADMIN_NOTIFY_EMAILS?.trim() || process.env.CONTACT_ALERT_RECIPIENTS?.trim()),
  warnNoRecipients: () => defaultWarnNoRecipients(),
};

export async function maybeSendContactMessageNotification(
  deps: ContactMessageNotifierDeps = DEFAULT_DEPS,
): Promise<ContactMessageAlertResult> {
  const { settings } = await deps.loadSettings();
  const settingsRecipients = parseEmailList(settings.contactNotificationEmails);
  const recipients = settingsRecipients.length > 0 ? settingsRecipients : undefined;

  if (!recipients && !deps.envHasRecipients()) {
    deps.warnNoRecipients();
  }

  const cooldownMinutes = normalizeCooldownMinutes(settings.contactNotifyCooldownMinutes);
  const nowMs = deps.nowMs();

  const shouldSend = await deps.allowByThrottle({ cooldownMinutes, nowMs });
  if (!shouldSend) {
    return { ok: true, skipped: true };
  }

  const unread = await deps.loadUnreadSummary();
  if (unread.totalNew <= 0) {
    return { ok: true, skipped: true };
  }

  if (unread.totalNew === 1 && unread.items[0]) {
    return deps.sendSingle({
      recipients,
      message: unread.items[0],
    });
  }

  return deps.sendDigest({
    recipients,
    totalNew: unread.totalNew,
    items: unread.items,
  });
}
