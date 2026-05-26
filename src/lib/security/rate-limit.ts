import { NextResponse } from "next/server";

import {
  consumeRateLimit,
  type ConsumeRateLimitInput,
  type ConsumeRateLimitResult,
  type RateLimitScope,
} from "@/lib/rateLimitStore";

export type RouteRateLimitInput = {
  scope: RateLimitScope;
  route: string;
  limit: number;
  windowSeconds: number;
  keyParts: Array<string | null | undefined>;
  nowMs?: number;
  consume?: (input: ConsumeRateLimitInput) => Promise<ConsumeRateLimitResult>;
};

export type RouteRateLimitResult = ConsumeRateLimitResult & {
  retryAfterSeconds: number;
};

function normalizeKeyPart(value: string | null | undefined) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function buildSubjectKey(route: string, keyParts: Array<string | null | undefined>) {
  const normalizedRoute = route.trim().toLowerCase();
  const normalizedParts = keyParts.map(normalizeKeyPart).filter(Boolean);
  return [normalizedRoute, ...normalizedParts].join("|");
}

export async function consumeRouteRateLimit(input: RouteRateLimitInput): Promise<RouteRateLimitResult> {
  const subjectKey = buildSubjectKey(input.route, input.keyParts);
  const result = await (input.consume ?? consumeRateLimit)({
    scope: input.scope,
    subjectKey,
    limit: input.limit,
    windowSeconds: input.windowSeconds,
    ...(input.nowMs !== undefined ? { nowMs: input.nowMs } : {}),
  });

  const resetAtMs = new Date(result.resetAt).getTime();
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(
      ((Number.isFinite(resetAtMs) ? resetAtMs : nowMs + input.windowSeconds * 1000) - nowMs) / 1000,
    ),
  );

  return {
    ...result,
    retryAfterSeconds,
  };
}

export function withRateLimitHeaders(response: NextResponse, result: RouteRateLimitResult) {
  response.headers.set("Retry-After", String(result.retryAfterSeconds));
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", result.resetAt);
  return response;
}
