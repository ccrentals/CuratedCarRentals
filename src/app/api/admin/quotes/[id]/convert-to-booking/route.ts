import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { logError } from "@/lib/log";
import {
  convertQuoteToBooking,
  isQuoteOpsMissingTableError,
  QuoteOpsError,
} from "@/lib/quotes/quoteOps";
import { requireCsrf } from "@/lib/security/csrf";

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminQuoteConvertRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  convertQuote: (input: {
    quoteId: string;
    actorAdminUserId?: string | null;
  }) => Promise<{ bookingId: string; alreadyConverted: boolean }>;
};

const DEFAULT_DEPS: AdminQuoteConvertRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  convertQuote: (input) => convertQuoteToBooking(input),
};

export async function handleAdminQuoteConvertPost(
  request: Request,
  context: RouteContext,
  deps: AdminQuoteConvertRouteDeps = DEFAULT_DEPS,
) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!(await deps.requireCsrfCheck(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await context.params;

  try {
    const converted = await deps.convertQuote({
      quoteId: id,
      actorAdminUserId: session.userId,
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
      userId: session.userId,
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
