import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { dbQuery } from "@/lib/db";
import { logError, logWarn } from "@/lib/log";
import { assessContactMessageSpam } from "@/lib/messages/spamDetection";
import { maybeSendContactMessageNotification } from "@/lib/notifications/contactMessageNotifier";
import { insertMailboxMessage } from "@/lib/messages/mailboxStore";
import {
  consumeRateLimit,
  type ConsumeRateLimitResult,
  type RateLimitScope,
} from "@/lib/rateLimitStore";
import {
  categorizeTurnstileFailure,
  extractTurnstileToken,
  verifyTurnstileToken,
} from "@/lib/security/turnstile";
import { isEmail } from "@/lib/validators";

const MAX_SUBMISSIONS_PER_HOUR_PER_IP = 5;
const MAX_SUBMISSIONS_PER_HOUR_PER_EMAIL = 3;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const DEV_RATE_LIMIT_BYPASS_HEADER = "x-ccr-dev-bypass-rate-limit";
const HONEYPOT_FIELD_NAME = "company";
const MIN_FORM_FILL_MS = 2_000;

type ContactRouteDeps = {
  getClientIp: (request: Request) => string;
  nowMs: () => number;
  consumeRateLimit: (input: {
    scope: RateLimitScope;
    subjectKey: string;
    limit: number;
    windowSeconds: number;
    nowMs: number;
  }) => Promise<ConsumeRateLimitResult>;
  insertContactMessage: (input: {
    name: string;
    email: string;
    message: string;
    source: string;
  }) => Promise<{ id: string; createdAt: string }>;
  writeAudit: (input: {
    action: string;
    details: Record<string, unknown>;
    entityType?: string;
    entityId?: string;
  }) => Promise<void>;
  notifyNewMessage: (input: {
    messageId: string;
    createdAt: string;
    name: string;
    email: string;
    message: string;
    source: string;
  }) => Promise<void>;
  verifyTurnstile: (input: {
    token: string | null | undefined;
    remoteIp?: string | null;
    expectedAction: "public_contact";
  }) => Promise<
    | { ok: true; bypassed: boolean }
    | { ok: false; status: number; userMessage: string; errorCodes: string[] }
  >;
};

function getClientIpFromRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();
  return "unknown";
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseStartedAtMs(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return parsed;
}

function shouldBypassRateLimitInDev(request: Request) {
  if (process.env.NODE_ENV === "production") return false;
  return request.headers.get(DEV_RATE_LIMIT_BYPASS_HEADER) === "1";
}

function isRateLimitsTableMissingError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return code === "42P01" && message.includes("rate_limits");
}

async function consumeRateLimitWithAuditFallback(input: {
  scope: RateLimitScope;
  subjectKey: string;
  limit: number;
  windowSeconds: number;
  nowMs: number;
}) {
  try {
    return await consumeRateLimit(input);
  } catch (error) {
    if (!isRateLimitsTableMissingError(error)) {
      throw error;
    }

    let previousCount = 0;

    if (input.scope === "CONTACT_IP") {
      const result = await dbQuery<{ count: unknown }>(
        "select count(*)::int as count from audit_logs where action = 'CONTACT_MESSAGE_SUBMIT' and created_at > now() - make_interval(secs => $2::int) and coalesce(details_json->>'ip', '') = $1",
        [input.subjectKey, input.windowSeconds],
      );
      previousCount = Number(result.rows[0]?.count ?? 0);
    } else if (input.scope === "CONTACT_EMAIL") {
      const result = await dbQuery<{ count: unknown }>(
        "select count(*)::int as count from audit_logs where action = 'CONTACT_MESSAGE_SUBMIT' and created_at > now() - make_interval(secs => $2::int) and lower(coalesce(details_json->>'email', '')) = $1",
        [input.subjectKey.toLowerCase(), input.windowSeconds],
      );
      previousCount = Number(result.rows[0]?.count ?? 0);
    }

    const count = previousCount + 1;
    return {
      count,
      limit: input.limit,
      allowed: previousCount < input.limit,
      remaining: Math.max(0, input.limit - count),
      resetAt: new Date(input.nowMs + input.windowSeconds * 1000).toISOString(),
    };
  }
}

const DEFAULT_DEPS: ContactRouteDeps = {
  getClientIp: getClientIpFromRequest,
  nowMs: () => Date.now(),
  consumeRateLimit: (input) => consumeRateLimitWithAuditFallback(input),
  insertContactMessage: async ({ name, email, message, source }) => {
    const result = await insertMailboxMessage(dbQuery, {
      name,
      email,
      message,
      source,
      subject: `New contact message from ${name}`,
      displayName: name,
      displayEmail: email,
      messageType: source === "home_page_contact" ? "home_contact_inquiry" : "contact_inquiry",
      priority: "normal",
      notificationEligible: true,
      metadataJson: {
        submittedFrom: source,
      },
    });
    return {
      id: result?.id ?? "",
      createdAt: String(result?.created_at ?? new Date().toISOString()),
    };
  },
  writeAudit: async ({ action, details, entityType = "contact_message", entityId }) => {
    await writeAuditLog({
      action,
      entityType,
      entityId,
      details,
    });
  },
  notifyNewMessage: async ({ messageId }) => {
    const alertResult = await maybeSendContactMessageNotification();

    if (!alertResult.ok && !alertResult.skipped) {
      logError("public_contact_alert_email_failed", new Error(alertResult.error || "Email failed"), {
        messageId,
      });
    }
  },
  verifyTurnstile: (input) => verifyTurnstileToken(input),
};

function validationError(field: string, error: string) {
  return NextResponse.json({ ok: false, error, field }, { status: 400 });
}

function genericSuspiciousResponse() {
  return NextResponse.json(
    { ok: false, error: "Unable to send your message right now. Please try again." },
    { status: 400 },
  );
}

export async function handleContactPost(request: Request, deps: ContactRouteDeps = DEFAULT_DEPS) {
  const body = await request.json().catch(() => null);
  const name = normalizeText(body?.name);
  const email = normalizeText(body?.email);
  const emailLower = email.toLowerCase();
  const message = normalizeText(body?.message);
  const source = normalizeText(body?.source) || "contact_page";
  const turnstileToken = extractTurnstileToken(body, request);
  const honeypot = normalizeText(body?.[HONEYPOT_FIELD_NAME]);
  const startedAtMs = parseStartedAtMs(body?.startedAt);
  const ip = deps.getClientIp(request);
  const nowMs = deps.nowMs();

  if (honeypot) {
    await deps.writeAudit({
      action: "CONTACT_MESSAGE_BLOCKED_HONEYPOT",
      details: { ip, source },
    });
    return NextResponse.json({ ok: true });
  }

  const turnstileResult = await deps.verifyTurnstile({
    token: turnstileToken,
    remoteIp: ip,
    expectedAction: "public_contact",
  });
  if (!turnstileResult.ok) {
    logWarn("api.public.contact.turnstile_failed", {
      route: "/api/public/contact",
      failureCategory: categorizeTurnstileFailure(turnstileResult.errorCodes),
      status: turnstileResult.status,
      ip,
    });
    await deps.writeAudit({
      action: "CONTACT_MESSAGE_BLOCKED_TURNSTILE",
      details: {
        ip,
        source,
        errorCodes: turnstileResult.errorCodes,
      },
    });
    return NextResponse.json(
      { ok: false, error: turnstileResult.userMessage },
      { status: turnstileResult.status },
    );
  }

  if (name.length < 2 || name.length > 80) {
    return validationError("name", "Name must be between 2 and 80 characters.");
  }

  if (!isEmail(email) || email.length > 254) {
    return validationError("email", "Please enter a valid email address.");
  }

  if (message.length < 5 || message.length > 2000) {
    return validationError("message", "Message must be between 5 and 2000 characters.");
  }

  if (!startedAtMs || nowMs - startedAtMs < MIN_FORM_FILL_MS) {
    await deps.writeAudit({
      action: "CONTACT_MESSAGE_BLOCKED_TIMING",
      details: {
        ip,
        source,
        startedAtMs,
        elapsedMs: startedAtMs ? nowMs - startedAtMs : null,
        minimumMs: MIN_FORM_FILL_MS,
      },
    });
    return genericSuspiciousResponse();
  }

  const spamAssessment = assessContactMessageSpam(message);
  if (spamAssessment.blocked) {
    await deps.writeAudit({
      action: "CONTACT_MESSAGE_BLOCKED_SPAM",
      details: {
        ip,
        source,
        email: emailLower,
        reason: spamAssessment.reason,
        urlCount: spamAssessment.urlCount,
        keywordHits: spamAssessment.keywordHits,
      },
    });
    return genericSuspiciousResponse();
  }

  if (!shouldBypassRateLimitInDev(request)) {
    const ipRateLimit = await deps.consumeRateLimit({
      scope: "CONTACT_IP",
      subjectKey: ip,
      limit: MAX_SUBMISSIONS_PER_HOUR_PER_IP,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      nowMs,
    });

    if (!ipRateLimit.allowed) {
      await deps.writeAudit({
        action: "CONTACT_MESSAGE_RATE_LIMITED",
        details: {
          scope: "IP",
          ip,
          source,
          count: ipRateLimit.count,
          limit: MAX_SUBMISSIONS_PER_HOUR_PER_IP,
          resetAt: ipRateLimit.resetAt,
        },
      });
      return NextResponse.json({ ok: false, error: "RATE_LIMIT" }, { status: 429 });
    }

    const emailRateLimit = await deps.consumeRateLimit({
      scope: "CONTACT_EMAIL",
      subjectKey: emailLower,
      limit: MAX_SUBMISSIONS_PER_HOUR_PER_EMAIL,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      nowMs,
    });

    if (!emailRateLimit.allowed) {
      await deps.writeAudit({
        action: "CONTACT_MESSAGE_RATE_LIMITED",
        details: {
          scope: "EMAIL",
          ip,
          source,
          email: emailLower,
          count: emailRateLimit.count,
          limit: MAX_SUBMISSIONS_PER_HOUR_PER_EMAIL,
          resetAt: emailRateLimit.resetAt,
        },
      });
      return NextResponse.json({ ok: false, error: "RATE_LIMIT" }, { status: 429 });
    }
  }

  const inserted = await deps.insertContactMessage({
    name,
    email,
    message,
    source,
  });

  if (!inserted.id) {
    return NextResponse.json({ ok: false, error: "Unable to save your message." }, { status: 500 });
  }

  await deps.writeAudit({
    action: "CONTACT_MESSAGE_SUBMIT",
    entityId: inserted.id,
    details: { ip, source, email: emailLower },
  });

  try {
    await deps.notifyNewMessage({
      messageId: inserted.id,
      createdAt: inserted.createdAt,
      name,
      email,
      message,
      source,
    });
  } catch (error) {
    logError("public_contact_alert_email_failed", error, {
      messageId: inserted.id,
    });
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}

export async function POST(request: Request) {
  return handleContactPost(request);
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}
