import assert from "node:assert/strict";
import test from "node:test";

import { maybeSendContactMessageNotification } from "@/lib/notifications/contactMessageNotifier";

test("contact notifier: throttling prevents duplicate sends", async () => {
  let digestCalls = 0;

  const result = await maybeSendContactMessageNotification({
    loadSettings: async () => ({
      settings: {
        contactNotificationEmails: "owner@example.com",
        contactNotifyCooldownMinutes: 10,
      },
    }),
    nowMs: () => 1_700_000_000_000,
    allowByThrottle: async () => false,
    loadUnreadSummary: async () => ({
      totalNew: 2,
      items: [
        {
          id: "m1",
          createdAt: "2026-02-22T01:00:00.000Z",
          name: "Alice",
          email: "alice@example.com",
          message: "Hello",
        },
      ],
    }),
    sendSingle: async () => ({ ok: true }),
    sendDigest: async () => {
      digestCalls += 1;
      return { ok: true };
    },
    envHasRecipients: () => true,
    warnNoRecipients: () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(digestCalls, 0);
});

test("contact notifier: digest sends expected payload", async () => {
  let digestPayload:
    | {
        recipients?: string[];
        totalNew: number;
        items: Array<{
          id: string;
          createdAt: string;
          name: string;
          email: string;
          message: string;
        }>;
      }
    | undefined;

  const result = await maybeSendContactMessageNotification({
    loadSettings: async () => ({
      settings: {
        contactNotificationEmails: "owner@example.com, ops@example.com",
        contactNotifyCooldownMinutes: 10,
      },
    }),
    nowMs: () => 1_700_000_000_000,
    allowByThrottle: async () => true,
    loadUnreadSummary: async () => ({
      totalNew: 4,
      items: [
        {
          id: "m1",
          createdAt: "2026-02-22T01:00:00.000Z",
          name: "Alice",
          email: "alice@example.com",
          message: "Hello from Alice",
        },
        {
          id: "m2",
          createdAt: "2026-02-22T01:05:00.000Z",
          name: "Bob",
          email: "bob@example.com",
          message: "Hello from Bob",
        },
      ],
    }),
    sendSingle: async () => ({ ok: true }),
    sendDigest: async (input) => {
      digestPayload = input;
      return { ok: true };
    },
    envHasRecipients: () => true,
    warnNoRecipients: () => {},
  });

  assert.equal(result.ok, true);
  assert.ok(digestPayload);
  assert.equal(digestPayload?.totalNew, 4);
  assert.deepEqual(digestPayload?.recipients, ["owner@example.com", "ops@example.com"]);
  assert.equal(digestPayload?.items.length, 2);
  assert.equal(digestPayload?.items[0]?.id, "m1");
});
