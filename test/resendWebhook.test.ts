import assert from "node:assert/strict";
import test from "node:test";

import { handleResendWebhookPost } from "@/app/api/webhooks/resend/route";
import {
  normalizeResendWebhookEvent,
  processResendWebhookEvent,
} from "@/lib/notifications/resendWebhook";

function sampleFailedPayload(overrides?: Record<string, unknown>) {
  return {
    type: "email.failed",
    created_at: "2026-03-15T12:00:00.000Z",
    data: {
      created_at: "2026-03-15T12:00:00.000Z",
      email_id: "re_test_email_123",
      to: ["customer@example.com"],
      subject: "Booking received",
      error: {
        name: "MailboxUnavailable",
        message: "Mailbox unavailable",
      },
      ...overrides,
    },
  };
}

function createDbPoolStub(queryImpl: DbClientQuery) {
  return {
    async connect() {
      return {
        async query(text: string, params?: unknown[]) {
          return queryImpl(text, params ?? []);
        },
        release() {
          return undefined;
        },
      };
    },
  };
}

type DbClientQuery = <T = unknown>(
  text: string,
  params: unknown[],
) => Promise<{ rows: T[]; rowCount: number }>;

test("Resend webhook route accepts relevant payloads and forwards the normalized event", async () => {
  const rawBody = JSON.stringify(sampleFailedPayload());
  let capturedEvent: ReturnType<typeof normalizeResendWebhookEvent> | null = null;

  const response = await handleResendWebhookPost(
    new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": "msg_123",
        "svix-timestamp": "1710000000",
        "svix-signature": "v1,test",
      },
      body: rawBody,
    }),
    {
      getWebhookSecret: () => "whsec_test",
      verifySignature: () => ({ ok: true }),
      processEvent: async (event) => {
        capturedEvent = event;
        return {
          handled: true,
          duplicate: false,
          eventType: event.eventType,
          notificationId: "message-1",
          correlation: {
            entityType: "booking",
            entityId: "5baa780b-d921-4a2b-99d2-147b82429191",
            entityPublicId: "BK000334",
            source: "tags",
            relatedEventType: "booking_created",
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedEvent?.eventType, "email.failed");
  assert.equal(capturedEvent?.primaryRecipient, "customer@example.com");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.notificationId, "message-1");
});

test("Resend webhook route rejects malformed payloads cleanly", async () => {
  const response = await handleResendWebhookPost(
    new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": "msg_124",
        "svix-timestamp": "1710000000",
        "svix-signature": "v1,test",
      },
      body: "{bad-json",
    }),
    {
      getWebhookSecret: () => "whsec_test",
      verifySignature: () => ({ ok: true }),
      processEvent: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(response.status, 400);
});

test("Resend delivery issue processing creates an admin notification and audit entry", async () => {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const event = normalizeResendWebhookEvent(
    sampleFailedPayload({
      tags: [
        { name: "bookingId", value: "5baa780b-d921-4a2b-99d2-147b82429191" },
        { name: "bookingPublicId", value: "BK000334" },
        { name: "emailType", value: "booking_created" },
      ],
    }),
    "msg_125",
  );

  assert.ok(event);

  const result = await processResendWebhookEvent(event!, {
    getDbPoolFn: () =>
      createDbPoolStub(async (text, params) => {
        queries.push({ text, params });
        if (text === "begin" || text === "commit" || text === "rollback") {
          return { rows: [], rowCount: 0 };
        }
        if (text.startsWith("insert into webhook_events")) {
          return { rows: [{ id: "webhook-row-1" }], rowCount: 1 };
        }
        if (text.includes("from information_schema.columns")) {
          return { rows: [], rowCount: 0 };
        }
        if (text.startsWith("insert into contact_messages")) {
          return {
            rows: [{ id: "contact-message-1", created_at: "2026-03-15T12:01:00.000Z" }],
            rowCount: 1,
          };
        }
        if (text.startsWith("insert into audit_logs")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${text}`);
      }),
  });

  assert.equal(result.handled, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.notificationId, "contact-message-1");
  assert.equal(result.correlation.entityType, "booking");
  assert.equal(result.correlation.entityPublicId, "BK000334");

  const contactInsert = queries.find((entry) => entry.text.startsWith("insert into contact_messages"));
  assert.ok(contactInsert);
  assert.equal(contactInsert?.params[1], "customer@example.com");
  assert.match(String(contactInsert?.params[2] ?? ""), /booking BK000334/i);
  assert.match(String(contactInsert?.params[2] ?? ""), /Mailbox unavailable/i);

  const auditInsert = queries.find((entry) => entry.text.startsWith("insert into audit_logs"));
  assert.ok(auditInsert);
  const details = auditInsert?.params[4] as Record<string, unknown>;
  assert.equal(details.eventType, "email.failed");
  assert.equal(details.providerEmailId, "re_test_email_123");
  assert.deepEqual(details.tags, {
    bookingid: "5baa780b-d921-4a2b-99d2-147b82429191",
    bookingpublicid: "BK000334",
    emailtype: "booking_created",
  });
});

test("Resend delivery issue processing correlates quote emails by provider message id", async () => {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const event = normalizeResendWebhookEvent(sampleFailedPayload(), "msg_126");

  assert.ok(event);

  const result = await processResendWebhookEvent(event!, {
    getDbPoolFn: () =>
      createDbPoolStub(async (text, params) => {
        queries.push({ text, params });
        if (text === "begin" || text === "commit" || text === "rollback") {
          return { rows: [], rowCount: 0 };
        }
        if (text.startsWith("insert into webhook_events")) {
          return { rows: [{ id: "webhook-row-2" }], rowCount: 1 };
        }
        if (text.startsWith("select id, entity_type")) {
          return { rows: [], rowCount: 0 };
        }
        if (text.startsWith("select qe.id, qe.quote_id")) {
          return {
            rows: [
              {
                quote_id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2",
                quote_public_id: "QU000123",
                to_email: "customer@example.com",
                subject: "Your Quote from Curated Car Rentals",
              },
            ],
            rowCount: 1,
          };
        }
        if (text.includes("from information_schema.columns")) {
          return { rows: [], rowCount: 0 };
        }
        if (text.startsWith("insert into contact_messages")) {
          return {
            rows: [{ id: "contact-message-2", created_at: "2026-03-15T12:02:00.000Z" }],
            rowCount: 1,
          };
        }
        if (text.startsWith("insert into audit_logs")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${text}`);
      }),
  });

  assert.equal(result.handled, true);
  assert.equal(result.correlation.entityType, "quote");
  assert.equal(result.correlation.entityPublicId, "QU000123");

  const contactInsert = queries.find((entry) => entry.text.startsWith("insert into contact_messages"));
  assert.ok(contactInsert);
  assert.match(String(contactInsert?.params[2] ?? ""), /quote QU000123/i);
});

test("Resend delivery issue processing short-circuits duplicate webhook deliveries", async () => {
  const queries: string[] = [];
  const event = normalizeResendWebhookEvent(sampleFailedPayload(), "msg_127");

  assert.ok(event);

  const result = await processResendWebhookEvent(event!, {
    getDbPoolFn: () =>
      createDbPoolStub(async (text) => {
        queries.push(text);
        if (text === "begin" || text === "rollback") {
          return { rows: [], rowCount: 0 };
        }
        if (text.startsWith("insert into webhook_events")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${text}`);
      }),
  });

  assert.equal(result.handled, true);
  assert.equal(result.duplicate, true);
  assert.equal(
    queries.some((entry) => entry.startsWith("insert into contact_messages")),
    false,
  );
});

test("Resend delivery processing records provider confirmation without creating an issue", async () => {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const event = normalizeResendWebhookEvent(
    {
      type: "email.delivered",
      created_at: "2026-03-15T12:00:00.000Z",
      data: {
        email_id: "re_delivered_1",
        to: ["customer@example.com"],
      },
    },
    "msg_128",
  );

  assert.ok(event);
  const result = await processResendWebhookEvent(event!, {
    getDbPoolFn: () =>
      createDbPoolStub(async (text, params) => {
        queries.push({ text, params });
        if (text === "begin" || text === "commit" || text === "rollback") {
          return { rows: [], rowCount: 0 };
        }
        if (text.startsWith("insert into webhook_events")) {
          return { rows: [{ id: "webhook-row-delivered" }], rowCount: 1 };
        }
        if (text.startsWith("select id, entity_type")) {
          return {
            rows: [
              {
                id: "5baa780b-d921-4a2b-99d2-147b82429191",
                entity_type: "booking",
                entity_id: "60eb4ea5-6df8-4234-83bf-569c95df0bb9",
                entity_public_id: "BK000023",
                email_type: "booking_created",
              },
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith("update email_dispatches")) {
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith("insert into email_dispatch_events")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${text}`);
      }),
  });
  assert.equal(result.handled, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.eventType, "email.delivered");
  assert.equal(result.notificationId, null);

  const dispatchUpdate = queries.find((entry) => entry.text.startsWith("update email_dispatches"));
  assert.ok(dispatchUpdate);
  assert.equal(dispatchUpdate?.params[1], "SENT");
  assert.equal(
    queries.some((entry) => entry.text.startsWith("insert into contact_messages")),
    false,
  );
});

test("Resend sent processing records acceptance without regressing dispatch status", async () => {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const event = normalizeResendWebhookEvent(
    {
      type: "email.sent",
      created_at: "2026-03-15T11:59:00.000Z",
      data: {
        email_id: "re_sent_1",
        to: ["customer@example.com"],
      },
    },
    "msg_129",
  );

  assert.ok(event);
  const result = await processResendWebhookEvent(event!, {
    getDbPoolFn: () =>
      createDbPoolStub(async (text, params) => {
        queries.push({ text, params });
        if (text === "begin" || text === "commit" || text === "rollback") {
          return { rows: [], rowCount: 0 };
        }
        if (text.startsWith("insert into webhook_events")) {
          return { rows: [{ id: "webhook-row-sent" }], rowCount: 1 };
        }
        if (text.startsWith("select id, entity_type")) {
          return {
            rows: [
              {
                id: "5baa780b-d921-4a2b-99d2-147b82429191",
                entity_type: "booking",
                entity_id: "60eb4ea5-6df8-4234-83bf-569c95df0bb9",
                entity_public_id: "BK000023",
                email_type: "booking_created",
              },
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith("insert into email_dispatch_events")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${text}`);
      }),
  });

  assert.equal(result.handled, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.eventType, "email.sent");
  assert.equal(result.notificationId, null);

  const providerEvent = queries.find((entry) =>
    entry.text.startsWith("insert into email_dispatch_events"),
  );
  assert.ok(providerEvent);
  assert.equal(providerEvent?.params[1], "provider_webhook");
  assert.equal(providerEvent?.params[2], "email.sent");
  assert.equal(providerEvent?.params[3], "SENT");
  assert.equal(
    queries.some((entry) => entry.text.startsWith("update email_dispatches")),
    false,
  );
  assert.equal(
    queries.some((entry) => entry.text.startsWith("insert into contact_messages")),
    false,
  );
});
