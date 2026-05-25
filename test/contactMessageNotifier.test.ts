import assert from "node:assert/strict";
import test from "node:test";

import { maybeSendContactMessageNotification } from "@/lib/notifications/contactMessageNotifier";

const MESSAGE = {
  id: "m1",
  createdAt: "2026-02-22T01:00:00.000Z",
  name: "Alice",
  email: "alice@example.com",
  message: "Hello from Alice",
  source: "contact_page",
  subject: "New contact message from Alice",
  priority: "normal",
} as const;

test("contact notifier: uses explicit message notification recipients when configured", async () => {
  let capturedRecipients: string[] | undefined;
  let operationalLoadCalls = 0;

  const result = await maybeSendContactMessageNotification(MESSAGE, {
    loadSettings: async () => ({
      settings: {
        contactNotificationEmails: "owner@example.com, ops@example.com",
        primaryAdminUserId: null,
        primaryDeveloperUserId: null,
        defaultOperationalNotificationEmail: "",
        additionalOperationalNotificationEmails: [],
      },
    }),
    loadOperationalRecipients: async () => {
      operationalLoadCalls += 1;
      return ["fallback@example.com"];
    },
    sendSingle: async ({ recipients }) => {
      capturedRecipients = recipients;
      return { ok: true };
    },
    warnNoRecipients: () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(operationalLoadCalls, 0);
  assert.deepEqual(capturedRecipients, ["owner@example.com", "ops@example.com"]);
});

test("contact notifier: falls back to operational recipients when message recipients are blank", async () => {
  let capturedRecipients: string[] | undefined;
  let capturedSettings:
    | {
        primaryAdminUserId: string | null;
        primaryDeveloperUserId: string | null;
        defaultOperationalNotificationEmail: string;
        additionalOperationalNotificationEmails: string[];
      }
    | undefined;

  const result = await maybeSendContactMessageNotification(MESSAGE, {
    loadSettings: async () => ({
      settings: {
        contactNotificationEmails: "",
        primaryAdminUserId: "admin-id",
        primaryDeveloperUserId: "developer-id",
        defaultOperationalNotificationEmail: "ops@example.com",
        additionalOperationalNotificationEmails: ["backup@example.com"],
      },
    }),
    loadOperationalRecipients: async (input) => {
      capturedSettings = input;
      return ["ops@example.com", "backup@example.com"];
    },
    sendSingle: async ({ recipients }) => {
      capturedRecipients = recipients;
      return { ok: true };
    },
    warnNoRecipients: () => {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(capturedSettings, {
    primaryAdminUserId: "admin-id",
    primaryDeveloperUserId: "developer-id",
    defaultOperationalNotificationEmail: "ops@example.com",
    additionalOperationalNotificationEmails: ["backup@example.com"],
  });
  assert.deepEqual(capturedRecipients, ["ops@example.com", "backup@example.com"]);
});

test("contact notifier: forwards home_page_contact source in the single-message alert payload", async () => {
  let capturedMessage:
    | {
        id: string;
        createdAt: string;
        name: string;
        email: string;
        message: string;
        source: string;
        subject: string;
        priority: string;
      }
    | undefined;

  const result = await maybeSendContactMessageNotification(
    {
      ...MESSAGE,
      source: "home_page_contact",
    },
    {
      loadSettings: async () => ({
        settings: {
          contactNotificationEmails: "owner@example.com",
          primaryAdminUserId: null,
          primaryDeveloperUserId: null,
          defaultOperationalNotificationEmail: "",
          additionalOperationalNotificationEmails: [],
        },
      }),
      loadOperationalRecipients: async () => [],
      sendSingle: async ({ message }) => {
        capturedMessage = message;
        return { ok: true };
      },
      warnNoRecipients: () => {},
    },
  );

  assert.equal(result.ok, true);
  assert.equal(capturedMessage?.source, "home_page_contact");
});

test("contact notifier: warns once when no recipients resolve", async () => {
  let warningCalls = 0;
  let capturedRecipients: string[] | undefined;

  const deps = {
    loadSettings: async () => ({
      settings: {
        contactNotificationEmails: "",
        primaryAdminUserId: null,
        primaryDeveloperUserId: null,
        defaultOperationalNotificationEmail: "",
        additionalOperationalNotificationEmails: [],
      },
    }),
    loadOperationalRecipients: async () => [],
    sendSingle: async ({ recipients }: { recipients?: string[]; message: typeof MESSAGE }) => {
      capturedRecipients = recipients;
      return { ok: true };
    },
    warnNoRecipients: () => {
      warningCalls += 1;
    },
  };

  const first = await maybeSendContactMessageNotification(MESSAGE, deps);
  const second = await maybeSendContactMessageNotification(
    {
      ...MESSAGE,
      id: "m2",
    },
    deps,
  );

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(warningCalls, 2);
  assert.equal(capturedRecipients, undefined);
});
