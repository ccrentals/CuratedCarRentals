import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { logError } from "@/lib/log";
import {
  AdminQuoteError,
  fetchAdminQuoteById,
  isQuotesMissingTableError,
  updateAdminQuote,
  type AdminQuoteDetailItem,
  type UpdateAdminQuoteInput,
} from "@/lib/quotes/adminQuotes";
import { requireCsrf } from "@/lib/security/csrf";

type QuoteRouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminQuoteRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getQuote: (id: string) => Promise<AdminQuoteDetailItem | null>;
  patchQuote: (input: UpdateAdminQuoteInput) => Promise<AdminQuoteDetailItem | null>;
};

const DEFAULT_DEPS: AdminQuoteRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getQuote: (id) => fetchAdminQuoteById(id),
  patchQuote: (input) => updateAdminQuote(input),
};

export async function handleAdminQuoteGet(
  _request: Request,
  context: QuoteRouteContext,
  deps: AdminQuoteRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  try {
    const item = await deps.getQuote(id);
    if (!item) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

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

    logError("admin_quote_get_failed", error, { quoteId: id });
    return NextResponse.json({ ok: false, error: "Failed to load quote." }, { status: 500 });
  }
}

export async function handleAdminQuotePatch(
  request: Request,
  context: QuoteRouteContext,
  deps: AdminQuoteRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  if (!(await deps.requireCsrfCheck(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  try {
    const item = await deps.patchQuote({
      id,
      status: body?.status,
      expiresAt: body?.expires_at ?? body?.expiresAt,
      tags: body?.tags,
      comments: body?.comments,
      commissionPartnerName: body?.commission_partner_name ?? body?.commissionPartnerName,
      clientPaysAtPartner: body?.client_pays_at_partner ?? body?.clientPaysAtPartner,
      rackPriceCents: body?.rack_price_cents ?? body?.rackPriceCents,
      vehicleId: body?.vehicle_id ?? body?.vehicleId,
      startAt: body?.start_at ?? body?.startAt,
      endAt: body?.end_at ?? body?.endAt,
      pickupLocationId: body?.pickup_location_id ?? body?.pickupLocationId,
      dropoffLocationId: body?.dropoff_location_id ?? body?.dropoffLocationId,
      pickupLocationText: body?.pickup_location_text ?? body?.pickupLocationText,
      dropoffLocationText: body?.dropoff_location_text ?? body?.dropoffLocationText,
      pickupLocationType: body?.pickup_location_type ?? body?.pickupLocationType,
      dropoffLocationType: body?.dropoff_location_type ?? body?.dropoffLocationType,
      pickupLocationTextSnapshot:
        body?.pickup_location_text_snapshot ?? body?.pickupLocationTextSnapshot,
      dropoffLocationTextSnapshot:
        body?.dropoff_location_text_snapshot ?? body?.dropoffLocationTextSnapshot,
      bookingLocationDetails: body?.booking_location_details ?? body?.bookingLocationDetails,
      insuranceEnabled: body?.insurance_enabled ?? body?.insuranceEnabled,
      insurancePlanId: body?.insurance_plan_id ?? body?.insurancePlanId,
      promoCode: body?.promo_code ?? body?.promoCode,
      deliverySelected: body?.delivery_selected ?? body?.deliverySelected,
      deliveryZoneLabel: body?.delivery_zone_label ?? body?.deliveryZoneLabel,
      actorAdminUserId: actor.userId,
    });

    if (!item) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

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

    logError("admin_quote_patch_failed", error, { quoteId: id });
    return NextResponse.json({ ok: false, error: "Failed to update quote." }, { status: 500 });
  }
}

export async function GET(request: Request, context: QuoteRouteContext) {
  return handleAdminQuoteGet(request, context);
}

export async function PATCH(request: Request, context: QuoteRouteContext) {
  return handleAdminQuotePatch(request, context);
}
