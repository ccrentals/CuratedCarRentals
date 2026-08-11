import assert from "node:assert/strict";
import test from "node:test";

import { handleClerkWebhookPost } from "@/app/api/webhooks/clerk/implementation";

test("Clerk webhook route rejects failed verification", async () => {
  const response = await handleClerkWebhookPost(
    new Request("http://localhost/api/webhooks/clerk", {
      method: "POST",
      headers: {
        "svix-id": "msg_123",
        "svix-timestamp": "1710000000",
        "svix-signature": "v1,test",
      },
      body: JSON.stringify({}),
    }),
    {
      verify: async () => {
        throw new Error("bad signature");
      },
      processEvent: async () => ({ handled: false }),
    },
  );

  assert.equal(response.status, 400);
});

test("Clerk webhook route forwards verified events to processing", async () => {
  let seenEventId: string | null = null;

  const response = await handleClerkWebhookPost(
    new Request("http://localhost/api/webhooks/clerk", {
      method: "POST",
      headers: {
        "svix-id": "msg_456",
        "svix-timestamp": "1710000001",
        "svix-signature": "v1,test",
      },
      body: JSON.stringify({}),
    }),
    {
      verify: async () =>
        ({
          type: "user.updated",
          object: "event",
          data: {
            id: "user_clerk_123",
            username: "debug-admin",
            primary_email_address_id: "email_123",
            email_addresses: [{ id: "email_123", email_address: "debug-admin@example.com" }],
          },
          event_attributes: {
            http_request: { client_ip: "127.0.0.1", user_agent: "test" },
          },
        }) as never,
      processEvent: async ({ event, eventId }) => {
        seenEventId = eventId;
        assert.equal(event.type, "user.updated");
        return {
          handled: true,
          syncResult: {
            ok: true,
            status: "applied",
            localUserId: "11111111-1111-4111-8111-111111111111",
            clerkUserId: "user_clerk_123",
            message: "Local identity synchronized from Clerk.",
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(seenEventId, "msg_456");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.eventType, "user.updated");
  assert.equal(body.syncStatus, "applied");
});
