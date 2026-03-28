import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
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
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

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
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

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
      deliverySelected: body?.delivery_selected ?? body?.deliverySelected,
      deliveryZoneLabel: body?.delivery_zone_label ?? body?.deliveryZoneLabel,
      tags: body?.tags,
      comments: body?.comments,
      expiresAt: body?.expires_at ?? body?.expiresAt,
      commissionPartnerName: body?.commission_partner_name ?? body?.commissionPartnerName,
      clientPaysAtPartner: body?.client_pays_at_partner ?? body?.clientPaysAtPartner,
      rackPriceCents: body?.rack_price_cents ?? body?.rackPriceCents,
      createdByAdminUserId: actor.userId,
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

    logError("admin_quote_create_failed", error, { userId: actor.userId });
    return NextResponse.json({ ok: false, error: "Failed to create quote." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleAdminQuotesGet(request);
}

export async function POST(request: Request) {
  return handleAdminQuotesPost(request);
}
