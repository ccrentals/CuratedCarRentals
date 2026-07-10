import assert from "node:assert/strict";
import test from "node:test";

import { NextResponse } from "next/server";

import { consumeRouteRateLimit, withRateLimitHeaders } from "@/lib/security/rate-limit";

test("route rate limit helper scopes keys by route and normalized subject", async () => {
  let subjectKey = "";
  const result = await consumeRouteRateLimit({
    scope: "ADMIN_SETTINGS_USER",
    route: "/api/admin/landing-content:patch",
    limit: 20,
    windowSeconds: 600,
    keyParts: ["Admin-User"],
    nowMs: Date.parse("2026-07-10T12:00:00.000Z"),
    consume: async (input) => {
      subjectKey = input.subjectKey;
      return {
        count: 1,
        limit: input.limit,
        allowed: true,
        remaining: input.limit - 1,
        resetAt: "2026-07-10T12:10:00.000Z",
      };
    },
  });

  assert.equal(subjectKey, "/api/admin/landing-content:patch|admin-user");
  assert.equal(result.retryAfterSeconds, 600);
});

test("route rate limit helper applies standard retry headers", () => {
  const response = withRateLimitHeaders(NextResponse.json({ ok: false }, { status: 429 }), {
    count: 21,
    limit: 20,
    allowed: false,
    remaining: 0,
    resetAt: "2026-07-10T12:10:00.000Z",
    retryAfterSeconds: 600,
  });

  assert.equal(response.headers.get("Retry-After"), "600");
  assert.equal(response.headers.get("X-RateLimit-Limit"), "20");
});
