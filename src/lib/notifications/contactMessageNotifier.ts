import { loadAdminSettings } from "@/lib/adminSettings";
import { logWarn } from "@/lib/log";
import {
  parseEmailList,
  sendContactMessageCreatedAlert,
  type ContactMessageAlertResult,
} from "@/lib/notifications/contactMessageAlert";
import { loadOperationalNotificationRoutingSummary } from "@/lib/notifications/operationalRouting";

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
      primaryAdminUserId: string | null;
      primaryDeveloperUserId: string | null;
      defaultOperationalNotificationEmail: string;
      additionalOperationalNotificationEmails: string[];
    };
  }>;
  loadOperationalRecipients: (input: {
    primaryAdminUserId: string | null;
    primaryDeveloperUserId: string | null;
    defaultOperationalNotificationEmail: string;
    additionalOperationalNotificationEmails: string[];
  }) => Promise<string[]>;
  sendSingle: (input: {
    recipients?: string[];
    message: ContactNotificationMessageItem;
  }) => Promise<ContactMessageAlertResult>;
  warnNoRecipients: () => void;
};

let recipientWarningShown = false;

function defaultWarnNoRecipients() {
  if (recipientWarningShown) return;
  recipientWarningShown = true;
  logWarn("contact_message_notification_recipients_missing", {
    settingKey: "contactNotificationEmails",
    fallback: "operational_notification_routing",
  });
}

const DEFAULT_DEPS: ContactMessageNotifierDeps = {
  loadSettings: () => loadAdminSettings(),
  loadOperationalRecipients: async (settings) => {
    const routing = await loadOperationalNotificationRoutingSummary(settings);
    return routing.effectiveRecipients;
  },
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
  warnNoRecipients: () => defaultWarnNoRecipients(),
};

export async function maybeSendContactMessageNotification(
  message: ContactNotificationMessageItem,
  deps: ContactMessageNotifierDeps = DEFAULT_DEPS,
): Promise<ContactMessageAlertResult> {
  const { settings } = await deps.loadSettings();
  const settingsRecipients = parseEmailList(settings.contactNotificationEmails);
  const operationalRecipients =
    settingsRecipients.length === 0
      ? await deps.loadOperationalRecipients({
          primaryAdminUserId: settings.primaryAdminUserId,
          primaryDeveloperUserId: settings.primaryDeveloperUserId,
          defaultOperationalNotificationEmail: settings.defaultOperationalNotificationEmail,
          additionalOperationalNotificationEmails: settings.additionalOperationalNotificationEmails,
        })
      : [];
  const recipients =
    settingsRecipients.length > 0
      ? settingsRecipients
      : operationalRecipients.length > 0
        ? operationalRecipients
        : undefined;

  if (!recipients) {
    deps.warnNoRecipients();
  }

  return deps.sendSingle({
    recipients,
    message,
  });
}
