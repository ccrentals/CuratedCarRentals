import assert from "node:assert/strict";
import test from "node:test";

import { handleContactPost } from "@/app/api/public/contact/route";
import type { RateLimitScope } from "@/lib/rateLimitStore";

function makeDeps(options?: {
  ipRateCount?: number;
  emailRateCount?: number;
  insertedId?: string;
}) {
  let insertCalled = 0;
  let auditCalled = 0;
  let notifyCalled = 0;

  return {
    deps: {
      getClientIp: () => "203.0.113.1",
      nowMs: () => 1_700_000_000_000,
      consumeRateLimit: async (input: {
        scope: RateLimitScope;
        subjectKey: string;
        limit: number;
        windowSeconds: number;
        nowMs: number;
      }) => {
        const count =
          input.scope === "CONTACT_IP"
            ? Number(options?.ipRateCount ?? 1)
            : input.scope === "CONTACT_EMAIL"
              ? Number(options?.emailRateCount ?? 1)
              : 1;

        return {
          count,
          limit: input.limit,
          allowed: count <= input.limit,
          remaining: Math.max(0, input.limit - count),
          resetAt: "2026-02-22T01:00:00.000Z",
        };
      },
      insertContactMessage: async () => {
        insertCalled += 1;
        return {
          id: options?.insertedId ?? "message-id-1",
          createdAt: "2026-02-22T00:00:00.000Z",
        };
      },
      writeAudit: async () => {
        auditCalled += 1;
      },
      notifyNewMessage: async () => {
        notifyCalled += 1;
      },
    },
    getInsertCalled: () => insertCalled,
    getAuditCalled: () => auditCalled,
    getNotifyCalled: () => notifyCalled,
  };
}

test("public contact API: valid payload returns 200 and stores message", async () => {
  const context = makeDeps({ ipRateCount: 1, emailRateCount: 1, insertedId: "abc-123" });
  const request = new Request("http://localhost/api/public/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Damian Thompson",
      email: "damian@example.com",
      message: "I need help with a booking.",
      startedAt: 1_700_000_000_000 - 5_000,
    }),
  });

  const response = await handleContactPost(request, context.deps);
  assert.equal(response.status, 200);

  const body = (await response.json()) as { ok: boolean; id?: string };
  assert.equal(body.ok, true);
  assert.equal(body.id, "abc-123");
  assert.equal(context.getInsertCalled(), 1);
  assert.equal(context.getAuditCalled(), 1);
  assert.equal(context.getNotifyCalled(), 1);
});

test("public contact API: invalid payload returns 400", async () => {
  const context = makeDeps();
  const request = new Request("http://localhost/api/public/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "A",
      email: "invalid",
      message: "no",
      startedAt: 1_700_000_000_000 - 5_000,
    }),
  });

  const response = await handleContactPost(request, context.deps);
  assert.equal(response.status, 400);

  const body = (await response.json()) as { ok: boolean; field?: string };
  assert.equal(body.ok, false);
  assert.equal(body.field, "name");
  assert.equal(context.getInsertCalled(), 0);
});

test("public contact API: honeypot triggers silent block", async () => {
  const context = makeDeps();
  const request = new Request("http://localhost/api/public/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Damian Thompson",
      email: "damian@example.com",
      message: "I need help with a booking.",
      company: "Acme Marketing",
      startedAt: 1_700_000_000_000 - 5_000,
    }),
  });

  const response = await handleContactPost(request, context.deps);
  assert.equal(response.status, 200);

  const body = (await response.json()) as { ok: boolean };
  assert.equal(body.ok, true);
  assert.equal(context.getInsertCalled(), 0);
  assert.equal(context.getAuditCalled(), 1);
  assert.equal(context.getNotifyCalled(), 0);
});

test("public contact API: per-IP rate limit returns 429", async () => {
  const context = makeDeps({ ipRateCount: 6, emailRateCount: 1 });
  const request = new Request("http://localhost/api/public/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Damian Thompson",
      email: "damian@example.com",
      message: "Hello there. I would like rental details.",
      startedAt: 1_700_000_000_000 - 5_000,
    }),
  });

  const response = await handleContactPost(request, context.deps);
  assert.equal(response.status, 429);

  const body = (await response.json()) as { ok: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "RATE_LIMIT");
  assert.equal(context.getInsertCalled(), 0);
  assert.equal(context.getAuditCalled(), 1);
});

test("public contact API: per-email rate limit returns 429", async () => {
  const context = makeDeps({ ipRateCount: 1, emailRateCount: 4 });
  const request = new Request("http://localhost/api/public/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Damian Thompson",
      email: "damian@example.com",
      message: "Hello there. I would like rental details.",
      startedAt: 1_700_000_000_000 - 5_000,
    }),
  });

  const response = await handleContactPost(request, context.deps);
  assert.equal(response.status, 429);

  const body = (await response.json()) as { ok: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "RATE_LIMIT");
  assert.equal(context.getInsertCalled(), 0);
  assert.equal(context.getAuditCalled(), 1);
});
