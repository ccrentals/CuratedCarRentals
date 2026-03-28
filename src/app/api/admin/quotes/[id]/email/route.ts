import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { logError } from "@/lib/log";
import { isQuoteExpired } from "@/lib/quotes/lifecycle";
import {
  buildQuoteEmailContent,
  buildQuotePdfBuffer,
  fetchQuoteByIdForOps,
  insertQuoteEvent,
  isQuoteOpsMissingTableError,
  recordQuoteEmailLog,
  sendQuoteEmailWithAttachment,
  updateQuoteLastEmailed,
  type QuoteOpsQuote,
} from "@/lib/quotes/quoteOps";
import { consumeRateLimit, type ConsumeRateLimitResult } from "@/lib/rateLimitStore";
import { requireCsrf } from "@/lib/security/csrf";
import { isEmail } from "@/lib/validators";

const QUOTE_EMAIL_LIMIT_PER_HOUR = 3;
const ADMIN_EMAIL_LIMIT_PER_HOUR = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminQuoteEmailRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  nowMs: () => number;
  getQuote: (id: string) => Promise<QuoteOpsQuote | null>;
  consumeRateLimitCheck: (input: {
    scope: "QUOTE_EMAIL_QUOTE" | "QUOTE_EMAIL_ADMIN";
    subjectKey: string;
    limit: number;
    windowSeconds: number;
    nowMs: number;
  }) => Promise<ConsumeRateLimitResult>;
  buildPdf: (quote: QuoteOpsQuote) => Buffer;
  sendEmail: (input: {
    toEmail: string;
    subject: string;
    html: string;
    attachmentFilename: string;
    attachmentBase64: string;
  }) => Promise<{ ok: boolean; skipped?: boolean; error?: string; providerMessageId?: string | null }>;
  updateQuoteLastEmailedAt: (input: { quoteId: string; toEmail: string }) => Promise<void>;
  logQuoteEvent: (input: {
    quoteId: string;
    eventType: "EMAILED";
    actorAdminUserId?: string | null;
    meta?: Record<string, unknown>;
  }) => Promise<void>;
  logQuoteEmail: (input: {
    quoteId: string;
    toEmail: string;
    subject: string;
    status: "SENT" | "FAILED";
    providerMessageId?: string | null;
    error?: string | null;
  }) => Promise<void>;
};

const DEFAULT_DEPS: AdminQuoteEmailRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  nowMs: () => Date.now(),
  getQuote: (id) => fetchQuoteByIdForOps(id),
  consumeRateLimitCheck: (input) => consumeRateLimit(input),
  buildPdf: (quote) => buildQuotePdfBuffer(quote),
  sendEmail: (input) => sendQuoteEmailWithAttachment(input),
  updateQuoteLastEmailedAt: (input) => updateQuoteLastEmailed(input),
  logQuoteEvent: ({ quoteId, eventType, actorAdminUserId, meta }) =>
    insertQuoteEvent(quoteId, eventType, {
      actorAdminUserId: actorAdminUserId ?? null,
      meta,
    }),
  logQuoteEmail: (input) => recordQuoteEmailLog(input),
};

function normalizeOptionalMessage(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 600);
}

export async function handleAdminQuoteEmailPost(
  request: Request,
  context: RouteContext,
  deps: AdminQuoteEmailRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await deps.requireCsrfCheck(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await context.params;

  try {
    const quote = await deps.getQuote(id);
    if (!quote) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const nowMs = deps.nowMs();
    if (isQuoteExpired(quote.expiresAt, new Date(nowMs))) {
      return NextResponse.json(
        { ok: false, error: "Quote is expired", code: "QUOTE_EXPIRED" },
        { status: 409 },
      );
    }

    const toEmail = String(body?.toEmail ?? quote.customerEmail ?? "")
      .trim()
      .toLowerCase();
    if (!isEmail(toEmail)) {
      return NextResponse.json({ ok: false, error: "Invalid recipient email" }, { status: 400 });
    }

    const perQuote = await deps.consumeRateLimitCheck({
      scope: "QUOTE_EMAIL_QUOTE",
      subjectKey: quote.id,
      limit: QUOTE_EMAIL_LIMIT_PER_HOUR,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      nowMs,
    });

    if (!perQuote.allowed) {
      return NextResponse.json({ ok: false, error: "RATE_LIMIT" }, { status: 429 });
    }

    const perAdmin = await deps.consumeRateLimitCheck({
      scope: "QUOTE_EMAIL_ADMIN",
      subjectKey: actor.userId,
      limit: ADMIN_EMAIL_LIMIT_PER_HOUR,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      nowMs,
    });

    if (!perAdmin.allowed) {
      return NextResponse.json({ ok: false, error: "RATE_LIMIT" }, { status: 429 });
    }

    const message = normalizeOptionalMessage(body?.message);
    const emailContent = buildQuoteEmailContent({
      quote,
      toEmail,
      message,
    });

    const pdf = deps.buildPdf(quote);
    const sendResult = await deps.sendEmail({
      toEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      attachmentFilename: `quote-${quote.publicId || quote.id.slice(0, 8)}.pdf`,
      attachmentBase64: Buffer.from(pdf).toString("base64"),
    });

    if (!sendResult.ok) {
      await deps.logQuoteEmail({
        quoteId: quote.id,
        toEmail,
        subject: emailContent.subject,
        status: "FAILED",
        providerMessageId: sendResult.providerMessageId ?? null,
        error: sendResult.error ?? (sendResult.skipped ? "EMAIL_NOT_CONFIGURED" : "EMAIL_SEND_FAILED"),
      });

      return NextResponse.json(
        {
          ok: false,
          error: sendResult.skipped
            ? "Email provider is not configured."
            : "Failed to send quote email.",
        },
        { status: sendResult.skipped ? 400 : 500 },
      );
    }

    await deps.updateQuoteLastEmailedAt({ quoteId: quote.id, toEmail });

    await deps.logQuoteEvent({
      quoteId: quote.id,
      eventType: "EMAILED",
      actorAdminUserId: actor.userId,
      meta: {
        toEmail,
        subject: emailContent.subject,
      },
    });

    await deps.logQuoteEmail({
      quoteId: quote.id,
      toEmail,
      subject: emailContent.subject,
      status: "SENT",
      providerMessageId: sendResult.providerMessageId ?? null,
      error: null,
    });

    return NextResponse.json({
      ok: true,
      toEmail,
      subject: emailContent.subject,
      providerMessageId: sendResult.providerMessageId ?? null,
    });
  } catch (error) {
    if (isQuoteOpsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Quotes tables are not installed. Apply schema.sql changes." },
        { status: 503 },
      );
    }

    logError("admin_quote_email_failed", error, {
      quoteId: id,
      userId: actor.userId,
    });
    return NextResponse.json({ ok: false, error: "Failed to send quote email." }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  return handleAdminQuoteEmailPost(request, context);
}
