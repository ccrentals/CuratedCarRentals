import { loadAdminSettings } from "@/lib/adminSettings";
import { logWarn } from "@/lib/log";
import {
  parseEmailList,
  sendContactMessageCreatedAlert,
  type ContactMessageAlertResult,
} from "@/lib/notifications/contactMessageAlert";

export type ContactNotificationMessageItem = {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  message: string;
  source: string;
  subject: string;
  priority: string;
};

export type ContactMessageNotifierDeps = {
  loadSettings: () => Promise<{
    settings: {
      contactNotificationEmails: string;
    };
  }>;
  sendSingle: (input: {
    recipients?: string[];
    message: ContactNotificationMessageItem;
  }) => Promise<ContactMessageAlertResult>;
  envHasRecipients: () => boolean;
  warnNoRecipients: () => void;
};

let recipientWarningShown = false;

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
  sendSingle: ({ recipients, message }) =>
    sendContactMessageCreatedAlert({
      messageId: message.id,
      createdAt: message.createdAt,
      name: message.name,
      email: message.email,
      message: message.message,
      source: message.source,
      subject: message.subject,
      recipients,
    }),
  envHasRecipients: () =>
    Boolean(process.env.ADMIN_NOTIFY_EMAILS?.trim() || process.env.CONTACT_ALERT_RECIPIENTS?.trim()),
  warnNoRecipients: () => defaultWarnNoRecipients(),
};

export async function maybeSendContactMessageNotification(
  message: ContactNotificationMessageItem,
  deps: ContactMessageNotifierDeps = DEFAULT_DEPS,
): Promise<ContactMessageAlertResult> {
  const { settings } = await deps.loadSettings();
  const settingsRecipients = parseEmailList(settings.contactNotificationEmails);
  const recipients = settingsRecipients.length > 0 ? settingsRecipients : undefined;

  if (!recipients && !deps.envHasRecipients()) {
    deps.warnNoRecipients();
  }

  return deps.sendSingle({
    recipients,
    message,
  });
}
