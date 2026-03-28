import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { logError } from "@/lib/log";
import { isQuoteExpired } from "@/lib/quotes/lifecycle";
import {
  convertQuoteToBooking,
  fetchQuoteByIdForOps,
  isQuoteOpsMissingTableError,
  QuoteOpsError,
  type QuoteOpsQuote,
} from "@/lib/quotes/quoteOps";
import { requireCsrf } from "@/lib/security/csrf";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminQuoteConvertRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getQuote: (id: string) => Promise<QuoteOpsQuote | null>;
  convertQuote: (input: {
    quoteId: string;
    actorAdminUserId?: string | null;
  }) => Promise<{ bookingId: string; alreadyConverted: boolean }>;
};

const DEFAULT_DEPS: AdminQuoteConvertRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getQuote: (id) => fetchQuoteByIdForOps(id),
  convertQuote: (input) => convertQuoteToBooking(input),
};

export async function handleAdminQuoteConvertPost(
  request: Request,
  context: RouteContext,
  deps: AdminQuoteConvertRouteDeps = DEFAULT_DEPS,
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
    if (isQuoteExpired(quote.expiresAt) && !quote.convertedBookingId) {
      return NextResponse.json(
        { ok: false, error: "Quote is expired", code: "QUOTE_EXPIRED" },
        { status: 409 },
      );
    }

    const converted = await deps.convertQuote({
      quoteId: id,
      actorAdminUserId: actor.userId,
    });

    return NextResponse.json({
      ok: true,
      bookingId: converted.bookingId,
      alreadyConverted: converted.alreadyConverted,
      bookingUrl: `/admin/bookings/${converted.bookingId}`,
    });
  } catch (error) {
    if (error instanceof QuoteOpsError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }

    if (isQuoteOpsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Quotes tables are not installed. Apply schema.sql changes." },
        { status: 503 },
      );
    }

    logError("admin_quote_convert_failed", error, {
      quoteId: id,
      userId: actor.userId,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to convert quote to booking." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  return handleAdminQuoteConvertPost(request, context);
}
