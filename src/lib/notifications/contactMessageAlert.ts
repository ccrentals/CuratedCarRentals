import { logWarn } from "@/lib/log";
import { sendTrackedResendEmail } from "@/lib/notifications/emailDispatch";

let contactAlertConfigWarned = false;

export type ContactMessageAlertResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

function baseUrl() {
  return process.env.SITE_URL ?? "http://localhost:3000";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-JM", { timeZone: "America/Jamaica" });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseEmailList(value: string | undefined | null) {
  if (!value) return [];
  const deduped = new Set<string>();
  for (const entry of value.split(/[,;\n]/)) {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) continue;
    deduped.add(normalized);
  }
  return [...deduped];
}

function getEnvRecipients() {
  const configured =
    process.env.ADMIN_NOTIFY_EMAILS?.trim() ||
    process.env.CONTACT_ALERT_RECIPIENTS?.trim() ||
    process.env.INTERNAL_NOTES_EMAIL?.trim() ||
    "";
  return parseEmailList(configured);
}

export function compactMessageSnippet(message: string, maxLength = 240) {
  const compact = message.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function humanizeSourceLabel(source: string | null | undefined) {
  const normalized = String(source ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "contact_page" || normalized === "contact_inquiry") {
    return "Contact form";
  }
  if (normalized === "home_page_contact" || normalized === "home_contact_inquiry") {
    return "Home contact form";
  }
  if (normalized === "booking_inspection" || normalized === "inspection_alert") {
    return "Vehicle inspection alert";
  }
  if (normalized === "resend_webhook" || normalized === "email_delivery_issue") {
    return "Email delivery issue";
  }
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1).toLowerCase()}`)
    .join(" ");
}

function resolveAlertHeading(source: string | null | undefined) {
  const normalized = String(source ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "booking_inspection" || normalized === "inspection_alert") {
    return "New vehicle inspection alert";
  }
  if (normalized === "resend_webhook" || normalized === "email_delivery_issue") {
    return "New email delivery issue";
  }
  return "New contact message received";
}

function warnConfigOnce(reason: string) {
  if (contactAlertConfigWarned) return;
  contactAlertConfigWarned = true;
  logWarn("contact_message_alert_email_skipped", { reason });
}

async function sendResendAlertEmail(input: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  dispatch: {
    entityType?: string | null;
    entityId?: string | null;
    entityPublicId?: string | null;
    emailType: string;
    triggerSource: "contact_alert";
    metadata?: Record<string, unknown>;
  };
}): Promise<ContactMessageAlertResult> {
  const result = await sendTrackedResendEmail({
    to: input.to,
    subject: input.subject,
    html: input.html,
    replyTo: input.replyTo,
    dispatch: {
      ...input.dispatch,
      recipientName: null,
      manualResendAllowed: true,
    },
  });

  return result.ok
    ? { ok: true }
    : {
        ok: false,
        skipped: result.skipped,
        error: result.error,
      };
}

function resolveRecipients(customRecipients?: string[]) {
  if (Array.isArray(customRecipients) && customRecipients.length > 0) {
    return parseEmailList(customRecipients.join(","));
  }
  return getEnvRecipients();
}

async function sendContactAlertEmailBatch(input: {
  recipients?: string[];
  subject: string;
  html: string;
  replyTo?: string;
  dispatch: {
    entityType?: string | null;
    entityId?: string | null;
    entityPublicId?: string | null;
    emailType: string;
    triggerSource: "contact_alert";
    metadata?: Record<string, unknown>;
  };
}) {
  const recipients = resolveRecipients(input.recipients);
  if (recipients.length === 0) {
    warnConfigOnce("No configured recipients for contact alerts");
    return {
      ok: false,
      skipped: true,
      error: "No configured recipients for contact alerts",
    };
  }
  let delivered = 0;
  let firstError = "";

  for (const recipient of recipients) {
    const result = await sendResendAlertEmail({
      to: recipient,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo,
      dispatch: input.dispatch,
    });

    if (result.ok) {
      delivered += 1;
    } else if (!firstError) {
      firstError = result.error ?? "Delivery failed";
    }
  }

  if (delivered > 0) {
    return { ok: true };
  }

  return {
    ok: false,
    error: firstError || "Delivery failed",
  };
}

export async function sendContactMessageCreatedAlert(input: {
  messageId: string;
  createdAt: string;
  name: string;
  email: string;
  message: string;
  source?: string | null;
  subject?: string | null;
  recipients?: string[];
}) {
  const link = `${baseUrl()}/admin/messages/${input.messageId}`;
  const snippet = compactMessageSnippet(input.message, 260);
  const source = (input.source ?? "contact_page").trim() || "contact_page";
  const createdLabel = formatDateTime(input.createdAt);
  const sourceLabel = humanizeSourceLabel(source);
  const heading = resolveAlertHeading(source);
  const subject = input.subject?.trim() || `${sourceLabel} notification`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>${escapeHtml(heading)}</h2>
      <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
      <p><strong>Name:</strong> ${escapeHtml(input.name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(input.email)}</p>
      <p><strong>Received:</strong> ${escapeHtml(createdLabel)}</p>
      <p><strong>Type:</strong> ${escapeHtml(sourceLabel)}</p>
      <div style="margin-top:12px; padding:12px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc;">
        <p style="margin:0 0 6px; font-weight:600;">Message snippet</p>
        <p style="margin:0;">${escapeHtml(snippet)}</p>
      </div>
      <p style="margin-top: 16px;">
        <a href="${link}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">Open Message</a>
      </p>
      <p style="font-size:12px; color:#64748b;">This is an automated admin alert.</p>
    </div>
  `;

  return sendContactAlertEmailBatch({
    recipients: input.recipients,
    subject: `[Messages] ${subject}`,
    html,
    replyTo: input.email,
    dispatch: {
      entityType: "contact_message",
      entityId: input.messageId,
      emailType: "contact_message_created_alert",
      triggerSource: "contact_alert",
      metadata: {
        messageId: input.messageId,
        source,
      },
    },
  });
}

export async function sendContactMessagesDigestAlert(input: {
  totalNew: number;
  recipients?: string[];
  items: Array<{
    id: string;
    name: string;
    email: string;
    message: string;
    createdAt: string;
    source?: string | null;
    subject?: string | null;
  }>;
}) {
  const rows = input.items
    .slice(0, 3)
    .map((item) => {
      const itemLink = `${baseUrl()}/admin/messages/${item.id}`;
      return `
        <li style="margin-bottom:10px;">
          <div><strong>${escapeHtml(item.subject?.trim() || item.name)}</strong></div>
          <div style="font-size:12px; color:#475569;">${escapeHtml(humanizeSourceLabel(item.source))}</div>
          <div style="font-size:12px; color:#475569;">${escapeHtml(item.name)} (${escapeHtml(item.email)})</div>
          <div style="font-size:12px; color:#475569;">${escapeHtml(formatDateTime(item.createdAt))}</div>
          <div>${escapeHtml(compactMessageSnippet(item.message, 180))}</div>
          <div style="margin-top:4px;"><a href="${itemLink}">Open message</a></div>
        </li>
      `;
    })
    .join("\n");

  const inboxLink = `${baseUrl()}/admin/messages`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Messages inbox update</h2>
      <p>You currently have <strong>${input.totalNew}</strong> new inbox item(s).</p>
      <p>Recent items:</p>
      <ul style="padding-left:18px;">
        ${rows || "<li>No preview available.</li>"}
      </ul>
      <p style="margin-top: 16px;">
        <a href="${inboxLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">Open Messages Inbox</a>
      </p>
      <p style="font-size:12px; color:#64748b;">This is an automated admin digest alert.</p>
    </div>
  `;

  return sendContactAlertEmailBatch({
    recipients: input.recipients,
    subject: `[Messages] ${input.totalNew} new message${input.totalNew === 1 ? "" : "s"} in inbox`,
    html,
    dispatch: {
      entityType: "system",
      entityId: null,
      emailType: "contact_messages_digest_alert",
      triggerSource: "contact_alert",
      metadata: {
        totalNew: input.totalNew,
        itemIds: input.items.map((item) => item.id),
      },
    },
  });
}
