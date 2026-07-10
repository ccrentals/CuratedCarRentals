import { dbQuery } from "@/lib/db";

export type RateLimitScope =
  | "CONTACT_IP"
  | "CONTACT_EMAIL"
  | "CONTACT_NOTIFY"
  | "QUOTE_EMAIL_QUOTE"
  | "QUOTE_EMAIL_ADMIN"
  | "ADMIN_SETTINGS_USER";

export type ConsumeRateLimitInput = {
  scope: RateLimitScope;
  subjectKey: string;
  limit: number;
  windowSeconds: number;
  nowMs?: number;
};

export type ConsumeRateLimitResult = {
  count: number;
  limit: number;
  allowed: boolean;
  remaining: number;
  resetAt: string;
};

function normalizeSubjectKey(value: string) {
  return value.trim().toLowerCase();
}

function startOfWindowIso(nowMs: number, windowSeconds: number) {
  const clampedWindow = Math.max(1, Math.floor(windowSeconds));
  const epochSeconds = Math.floor(nowMs / 1000);
  const bucketStartSeconds = epochSeconds - (epochSeconds % clampedWindow);
  return new Date(bucketStartSeconds * 1000).toISOString();
}

function resetAtIso(windowStartIso: string, windowSeconds: number) {
  const windowStartMs = new Date(windowStartIso).getTime();
  return new Date(windowStartMs + Math.max(1, Math.floor(windowSeconds)) * 1000).toISOString();
}

let cleanupCounter = 0;

async function maybeCleanupRateLimits() {
  cleanupCounter = (cleanupCounter + 1) % 25;
  if (cleanupCounter !== 0) return;

  await dbQuery(
    "delete from rate_limits where window_start < now() - interval '72 hours'",
  );
}

export async function consumeRateLimit(input: ConsumeRateLimitInput): Promise<ConsumeRateLimitResult> {
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const windowStart = startOfWindowIso(nowMs, input.windowSeconds);
  const subjectKey = normalizeSubjectKey(input.subjectKey);
  const limit = Math.max(1, Math.floor(input.limit));

  await maybeCleanupRateLimits();

  const result = await dbQuery<{ count: unknown }>(
    "insert into rate_limits (scope, subject_key, window_start, count) values ($1, $2, $3::timestamptz, 1) on conflict (scope, subject_key, window_start) do update set count = rate_limits.count + 1, updated_at = now() returning count",
    [input.scope, subjectKey, windowStart],
  );

  const count = Math.max(0, Number(result.rows[0]?.count ?? 0));
  const remaining = Math.max(0, limit - count);

  return {
    count,
    limit,
    allowed: count <= limit,
    remaining,
    resetAt: resetAtIso(windowStart, input.windowSeconds),
  };
}
