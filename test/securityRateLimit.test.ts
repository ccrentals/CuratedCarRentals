import assert from "node:assert/strict";
import test from "node:test";

import { NextResponse } from "next/server";

import { consumeRouteRateLimit, withRateLimitHeaders } from "@/lib/security/rate-limit";

test("route rate limit helper composes a stable route-scoped subject key", async () => {
  let capturedSubjectKey = "";

  const result = await consumeRouteRateLimit({
    scope: "PUBLIC_PRICING_QUOTE_IP",
    route: "/api/public/pricing/quote",
    limit: 60,
    windowSeconds: 60,
    keyParts: ["203.0.113.10", "Customer@Example.com"],
    nowMs: Date.parse("2026-06-01T11:00:00.000Z"),
    consume: async (input) => {
      capturedSubjectKey = input.subjectKey;
      return {
        count: 1,
        limit: input.limit,
        allowed: true,
        remaining: input.limit - 1,
        resetAt: "2026-06-01T11:01:00.000Z",
      };
    },
  });

  assert.equal(
    capturedSubjectKey,
    "/api/public/pricing/quote|203.0.113.10|customer@example.com",
  );
  assert.equal(result.retryAfterSeconds, 60);
});

test("route rate limit helper applies retry and limit headers", () => {
  const response = withRateLimitHeaders(
    NextResponse.json({ ok: false, error: "RATE_LIMIT" }, { status: 429 }),
    {
      count: 6,
      limit: 5,
      allowed: false,
      remaining: 0,
      resetAt: "2026-06-01T11:01:00.000Z",
      retryAfterSeconds: 60,
    },
  );

  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(response.headers.get("X-RateLimit-Limit"), "5");
  assert.equal(response.headers.get("X-RateLimit-Remaining"), "0");
  assert.equal(response.headers.get("X-RateLimit-Reset"), "2026-06-01T11:01:00.000Z");
});
