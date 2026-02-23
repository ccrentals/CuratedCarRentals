import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { logError } from "@/lib/log";
import {
  buildQuotePdfBuffer,
  fetchQuoteByIdForOps,
  insertQuoteEvent,
  isQuoteOpsMissingTableError,
  type QuoteOpsQuote,
  type QuoteEventType,
} from "@/lib/quotes/quoteOps";

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminQuotePdfRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  getQuote: (id: string) => Promise<QuoteOpsQuote | null>;
  buildPdf: (quote: QuoteOpsQuote) => Buffer;
  recordEvent: (input: {
    quoteId: string;
    eventType: QuoteEventType;
    actorAdminUserId?: string | null;
    meta?: Record<string, unknown>;
  }) => Promise<void>;
};

const DEFAULT_DEPS: AdminQuotePdfRouteDeps = {
  getSession: () => getSessionFromRequest(),
  getQuote: (id) => fetchQuoteByIdForOps(id),
  buildPdf: (quote) => buildQuotePdfBuffer(quote),
  recordEvent: ({ quoteId, eventType, actorAdminUserId, meta }) =>
    insertQuoteEvent(quoteId, eventType, {
      actorAdminUserId: actorAdminUserId ?? null,
      meta,
    }),
};

export async function handleAdminQuotePdfGet(
  _request: Request,
  context: RouteContext,
  deps: AdminQuotePdfRouteDeps = DEFAULT_DEPS,
) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  try {
    const quote = await deps.getQuote(id);
    if (!quote) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const pdf = deps.buildPdf(quote);

    await deps.recordEvent({
      quoteId: quote.id,
      eventType: "PDF_GENERATED",
      actorAdminUserId: session.userId,
      meta: {
        source: "admin_quote_pdf",
      },
    });

    const filename = `Quote-${quote.id.slice(0, 8)}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=\"${filename}\"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (isQuoteOpsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Quotes tables are not installed. Apply schema.sql changes." },
        { status: 503 },
      );
    }

    logError("admin_quote_pdf_failed", error, { quoteId: id });
    return NextResponse.json({ ok: false, error: "Failed to generate quote PDF." }, { status: 500 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleAdminQuotePdfGet(request, context);
}
