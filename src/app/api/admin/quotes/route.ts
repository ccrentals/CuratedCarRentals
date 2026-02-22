import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { logError } from "@/lib/log";
import {
  AdminQuoteError,
  createAdminQuote,
  fetchAdminQuotesPage,
  isQuotesMissingTableError,
  normalizeQuoteSort,
  type AdminQuoteDetailItem,
  type AdminQuotesPage,
  type CreateAdminQuoteInput,
  type FetchAdminQuotesInput,
} from "@/lib/quotes/adminQuotes";
import { requireCsrf } from "@/lib/security/csrf";

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

export type AdminQuotesRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  fetchPage: (input: FetchAdminQuotesInput) => Promise<AdminQuotesPage>;
  createQuote: (input: CreateAdminQuoteInput) => Promise<AdminQuoteDetailItem>;
};

const DEFAULT_DEPS: AdminQuotesRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  fetchPage: (input) => fetchAdminQuotesPage(input),
  createQuote: (input) => createAdminQuote(input),
};

export async function handleAdminQuotesGet(
  request: Request,
  deps: AdminQuotesRouteDeps = DEFAULT_DEPS,
) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const sort = normalizeQuoteSort(searchParams);

  try {
    const page = await deps.fetchPage({
      q: searchParams.get("q"),
      status: searchParams.get("status"),
      createdFrom: searchParams.get("createdFrom"),
      createdTo: searchParams.get("createdTo"),
      rentalFrom: searchParams.get("rentalFrom"),
      rentalTo: searchParams.get("rentalTo"),
      sortBy: sort.sortBy,
      sortDir: sort.sortDir,
      limit: searchParams.get("limit"),
      cursor: searchParams.get("cursor"),
    });

    return NextResponse.json({ ok: true, ...page });
  } catch (error) {
    if (error instanceof AdminQuoteError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (isQuotesMissingTableError(error)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Quotes tables are not installed. Apply schema.sql changes.",
        },
        { status: 503 },
      );
    }

    logError("admin_quotes_list_failed", error);
    return NextResponse.json({ ok: false, error: "Failed to load quotes." }, { status: 500 });
  }
}

export async function handleAdminQuotesPost(
  request: Request,
  deps: AdminQuotesRouteDeps = DEFAULT_DEPS,
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

  try {
    const item = await deps.createQuote({
      customerFullName: body?.customer_full_name ?? body?.customerFullName,
      customerEmail: body?.customer_email ?? body?.customerEmail,
      customerPhone: body?.customer_phone ?? body?.customerPhone,
      startAt: body?.start_at ?? body?.startAt,
      endAt: body?.end_at ?? body?.endAt,
      pickupLocationId: body?.pickup_location_id ?? body?.pickupLocationId,
      dropoffLocationId: body?.dropoff_location_id ?? body?.dropoffLocationId,
      pickupLocationText: body?.pickup_location_text ?? body?.pickupLocationText,
      dropoffLocationText: body?.dropoff_location_text ?? body?.dropoffLocationText,
      vehicleId: body?.vehicle_id ?? body?.vehicleId,
      insuranceEnabled: body?.insurance_enabled ?? body?.insuranceEnabled,
      insurancePlanId: body?.insurance_plan_id ?? body?.insurancePlanId,
      promoCode: body?.promo_code ?? body?.promoCode,
      tags: body?.tags,
      comments: body?.comments,
      expiresAt: body?.expires_at ?? body?.expiresAt,
      commissionPartnerName: body?.commission_partner_name ?? body?.commissionPartnerName,
      clientPaysAtPartner: body?.client_pays_at_partner ?? body?.clientPaysAtPartner,
      rackPriceCents: body?.rack_price_cents ?? body?.rackPriceCents,
      createdByAdminUserId: session.userId,
    });

    return NextResponse.json({ ok: true, item });
  } catch (error) {
    if (error instanceof AdminQuoteError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (isQuotesMissingTableError(error)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Quotes tables are not installed. Apply schema.sql changes.",
        },
        { status: 503 },
      );
    }

    logError("admin_quote_create_failed", error, { userId: session.userId });
    return NextResponse.json({ ok: false, error: "Failed to create quote." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleAdminQuotesGet(request);
}

export async function POST(request: Request) {
  return handleAdminQuotesPost(request);
}
