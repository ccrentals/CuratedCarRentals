import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { consumeRouteRateLimit, withRateLimitHeaders } from "@/lib/security/rate-limit";
import {
  computeRemainingRedemptions,
  derivePromoAdminState,
  normalizePromoInputCode,
} from "@/lib/promos";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import { parsePositiveIntParam } from "@/lib/pagination/sharedPagination";

const ADMIN_PROMO_MUTATION_LIMIT = 20;
const ADMIN_PROMO_MUTATION_WINDOW_SECONDS = 10 * 60;

type PromoRow = {
  id: string;
  public_id: string;
  code: string;
  is_active: boolean;
  discount_type: "PERCENT" | "FIXED";
  apply_scope: "OVERALL_TOTAL" | "DAYS_TOTAL";
  discount_value: string | number;
  min_subtotal_cents: number | null;
  max_redemptions: number | null;
  max_redemptions_per_customer: number | null;
  start_at: string | null;
  end_at: string | null;
  allowed_vehicle_ids_json: unknown;
  excluded_vehicle_ids_json: unknown;
  blackout_dates_json: unknown;
  created_at: string;
  updated_at: string;
};

type RedemptionRow = {
  id: string;
  booking_id: string;
  booking_public_id: string | null;
  customer_email: string | null;
  discount_amount_cents: number;
  event_type: "REDEEMED" | "REVERSED";
  event_at: string;
  created_at: string;
  is_reconstructed: boolean;
  timestamp_source: string | null;
};

type PromoCurrentCountRow = {
  count: number;
};

type PromoActivityAggregateRow = {
  redeemed_events: number;
  reversed_events: number;
  total_discount_redeemed: number;
  total_discount_reversed: number;
  history_coverage_started_at: string | null;
  has_reconstructed_history: boolean;
};

type PromoActivityCountRow = {
  count: number;
};

const PROMO_ACTIVITY_PAGE_SIZE = 25;
const PROMO_HISTORY_COVERAGE = "COMPLETE_RECONSTRUCTED_HISTORY" as const;

function asInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  return num;
}

function asDateIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function asIsoDateTime(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBlackoutDates(value: unknown) {
  return parseStringArray(value).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
}

function parseApplyScope(value: unknown): "OVERALL_TOTAL" | "DAYS_TOTAL" {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  return normalized === "DAYS_TOTAL" ? "DAYS_TOTAL" : "OVERALL_TOTAL";
}

function normalizePromoPayload(row: PromoRow) {
  return {
    ...row,
    apply_scope: row.apply_scope === "DAYS_TOTAL" ? "DAYS_TOTAL" : "OVERALL_TOTAL",
    discount_value: Number(row.discount_value ?? 0),
    allowed_vehicle_ids_json: parseStringArray(row.allowed_vehicle_ids_json),
    excluded_vehicle_ids_json: parseStringArray(row.excluded_vehicle_ids_json),
    blackout_dates_json: parseBlackoutDates(row.blackout_dates_json),
  };
}

function normalizeActivityPage(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") return parsePositiveIntParam(value) ?? 1;
  return 1;
}

export async function fetchAdminPromoCodeById(
  id: string,
  input: { activityPage?: string | number | null } = {},
) {
  const promo = await dbQuery<PromoRow>(
    "select id, public_id, code, is_active, discount_type, apply_scope, discount_value, min_subtotal_cents, max_redemptions, max_redemptions_per_customer, start_at, end_at, allowed_vehicle_ids_json, excluded_vehicle_ids_json, blackout_dates_json, created_at, updated_at from promo_codes where id = $1 limit 1",
    [id],
  );
  if (promo.rowCount === 0) {
    return null;
  }

  const currentCountResult = await dbQuery<PromoCurrentCountRow>(
    "select count(*)::int as count from promo_redemptions where promo_code_id = $1",
    [id],
  );
  const currentCount = Number(currentCountResult.rows[0]?.count ?? 0);

  const requestedActivityPage = normalizeActivityPage(input.activityPage);
  const aggregateResult: { rows: PromoActivityAggregateRow[]; rowCount: number } = await dbQuery<PromoActivityAggregateRow>(
    `select
       coalesce(sum(case when event_type = 'REDEEMED' then 1 else 0 end), 0)::int as redeemed_events,
       coalesce(sum(case when event_type = 'REVERSED' then 1 else 0 end), 0)::int as reversed_events,
       coalesce(sum(case when event_type = 'REDEEMED' then discount_amount_cents else 0 end), 0)::int as total_discount_redeemed,
       coalesce(sum(case when event_type = 'REVERSED' then discount_amount_cents else 0 end), 0)::int as total_discount_reversed,
       min(event_at) as history_coverage_started_at,
       coalesce(
         bool_or(lower(coalesce(metadata_json->>'reconstructed', 'false')) = 'true'),
         false
       ) as has_reconstructed_history
     from promo_redemption_events
     where promo_code_id = $1`,
    [id],
  );
  let activityTotalCount = 0;
  let activityTotalPages = 1;
  let activityPage = requestedActivityPage;
  let activityOffset = 0;
  let activityRows: { rows: RedemptionRow[]; rowCount: number } = { rows: [], rowCount: 0 };

  const activityCountResult = await dbQuery<PromoActivityCountRow>(
    "select count(*)::int as count from promo_redemption_events where promo_code_id = $1",
    [id],
  );
  activityTotalCount = Number(activityCountResult.rows[0]?.count ?? 0);
  activityTotalPages = Math.max(1, Math.ceil(activityTotalCount / PROMO_ACTIVITY_PAGE_SIZE));
  activityPage = Math.min(Math.max(1, requestedActivityPage), activityTotalPages);
  activityOffset = (activityPage - 1) * PROMO_ACTIVITY_PAGE_SIZE;

  activityRows = await dbQuery<RedemptionRow>(
    `select
       e.id,
       e.booking_id,
       b.public_id as booking_public_id,
       e.customer_email,
       e.discount_amount_cents,
       e.event_type,
       e.event_at,
       e.created_at,
       case
         when lower(coalesce(e.metadata_json->>'reconstructed', 'false')) = 'true' then true
         else false
       end as is_reconstructed,
       nullif(e.metadata_json->>'timestampSource', '') as timestamp_source
     from promo_redemption_events e
     left join bookings b on b.id = e.booking_id
     where e.promo_code_id = $1
     order by e.event_at desc, e.created_at desc
     limit $2
     offset $3`,
    [id, PROMO_ACTIVITY_PAGE_SIZE, activityOffset],
  );

  const normalizedPromo = normalizePromoPayload(promo.rows[0]);
  const adminState = derivePromoAdminState({
    isActive: normalizedPromo.is_active,
    startAt: normalizedPromo.start_at,
    endAt: normalizedPromo.end_at,
    maxRedemptions: normalizedPromo.max_redemptions,
    currentRedemptionCount: currentCount,
  });

  const aggregates = aggregateResult.rows[0] as Partial<PromoActivityAggregateRow> | undefined;
  const redeemedEvents = Number(aggregates?.redeemed_events ?? 0);
  const reversedEvents = Number(aggregates?.reversed_events ?? 0);
  const totalDiscountRedeemed = Number(aggregates?.total_discount_redeemed ?? 0);
  const totalDiscountReversed = Number(aggregates?.total_discount_reversed ?? 0);
  const historyCoverageStartedAt = asIsoDateTime(aggregates?.history_coverage_started_at);
  const hasReconstructedHistory = aggregates?.has_reconstructed_history === true;
  const remaining = computeRemainingRedemptions(normalizedPromo.max_redemptions, currentCount);

  return {
    promo: {
      ...normalizedPromo,
      current_redemption_count: currentCount,
      remaining_redemptions: remaining,
      admin_state: adminState,
    },
    summary: {
      currentCount,
      remaining,
      status: adminState,
      redeemedEvents,
      reversedEvents,
      netCounted: Math.max(0, redeemedEvents - reversedEvents),
      totalDiscountRedeemed,
      totalDiscountReversed,
    },
    historyCoverage: PROMO_HISTORY_COVERAGE,
    historyCoverageStartedAt,
    hasReconstructedHistory,
    activity: {
      rows: activityRows.rows.map((row) => ({
        ...row,
        discount_amount_cents: Number(row.discount_amount_cents ?? 0),
        event_at: asIsoDateTime(row.event_at) ?? String(row.event_at ?? ""),
        created_at: asIsoDateTime(row.created_at) ?? String(row.created_at ?? ""),
        is_reconstructed: row.is_reconstructed === true,
        timestamp_source:
          typeof row.timestamp_source === "string" && row.timestamp_source.trim().length > 0
            ? row.timestamp_source.trim()
            : null,
      })),
      page: activityPage,
      totalPages: activityTotalPages,
      totalCount: activityTotalCount,
      pageSize: PROMO_ACTIVITY_PAGE_SIZE,
      from: activityTotalCount === 0 ? 0 : activityOffset + 1,
      to: activityTotalCount === 0 ? 0 : activityOffset + activityRows.rows.length,
      hasPrev: activityPage > 1,
      hasNext: activityPage < activityTotalPages,
    },
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const url = new URL(request.url);
  const activityPage = url.searchParams.get("activityPage");
  try {
    const promoData = await fetchAdminPromoCodeById(id, { activityPage });
    if (!promoData) {
      return NextResponse.json({ error: "Promo code not found." }, { status: 404 });
    }

    return NextResponse.json(promoData);
  } catch (error) {
    logError("api.admin.promo-codes.[id].GET", error, { promoId: id });
    return NextResponse.json({ error: "Failed to load promo code." }, { status: 500 });
  }
}

export type AdminPromoCodePatchDeps = {
  requireAdmin: typeof requireAdminRole;
  requireCsrfCheck: typeof requireCsrf;
  consumeRateLimitCheck: typeof consumeRouteRateLimit;
  query: typeof dbQuery;
  writeAudit: typeof writeAuditLog;
  log: typeof logError;
};

const DEFAULT_PATCH_DEPS: AdminPromoCodePatchDeps = {
  requireAdmin: requireAdminRole,
  requireCsrfCheck: requireCsrf,
  consumeRateLimitCheck: consumeRouteRateLimit,
  query: dbQuery,
  writeAudit: writeAuditLog,
  log: logError,
};

export async function handleAdminPromoCodePatch(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  deps: AdminPromoCodePatchDeps = DEFAULT_PATCH_DEPS,
) {
  const auth = await deps.requireAdmin();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!(await deps.requireCsrfCheck(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const rateLimit = await deps.consumeRateLimitCheck({
    scope: "ADMIN_PROMO_MUTATION_USER",
    route: "/api/admin/promo-codes/[id]",
    limit: ADMIN_PROMO_MUTATION_LIMIT,
    windowSeconds: ADMIN_PROMO_MUTATION_WINDOW_SECONDS,
    keyParts: [actor.userId, id, typeof body?.action === "string" ? body.action : "update"],
  });
  if (!rateLimit.allowed) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "Too many promo code changes. Please try again later." }, { status: 429 }),
      rateLimit,
    );
  }

  if (body?.action === "set_active") {
    const isActive = body?.isActive !== false;
    const updated = await deps.query<{ id: string }>(
      "update promo_codes set is_active = $2, updated_at = now() where id = $1 returning id",
      [id, isActive],
    );
    if (updated.rowCount === 0) {
      return NextResponse.json({ error: "Promo code not found." }, { status: 404 });
    }

    await deps.writeAudit({
      userId: actor.userId,
      action: isActive ? "PROMO_CODE_ACTIVATED" : "PROMO_CODE_DEACTIVATED",
      entityType: "promo_code",
      entityId: id,
      details: {},
    });

    return NextResponse.json({ ok: true });
  }

  const code = normalizePromoInputCode(typeof body?.code === "string" ? body.code : "");
  const discountType =
    String(body?.discountType ?? "")
      .trim()
      .toUpperCase() === "PERCENT"
      ? "PERCENT"
      : "FIXED";
  const discountValue = Number(body?.discountValue ?? 0);
  const applyScope = parseApplyScope(body?.applyScope);
  const isActive = body?.isActive !== false;
  const minSubtotalCents = asInteger(body?.minSubtotalCents);
  const maxRedemptions = asInteger(body?.maxRedemptions);
  const maxRedemptionsPerCustomer = asInteger(body?.maxRedemptionsPerCustomer);
  const startAt = asDateIso(body?.startAt);
  const endAt = asDateIso(body?.endAt);
  const allowedVehicleIds = parseStringArray(body?.allowedVehicleIds);
  const excludedVehicleIds = parseStringArray(body?.excludedVehicleIds);
  const blackoutDates = parseBlackoutDates(body?.blackoutDates);

  if (!code) {
    return NextResponse.json({ error: "Promo code is required." }, { status: 400 });
  }
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return NextResponse.json({ error: "Discount value must be greater than 0." }, { status: 400 });
  }
  if (discountType === "PERCENT" && discountValue > 100) {
    return NextResponse.json({ error: "Percent discounts cannot exceed 100." }, { status: 400 });
  }
  if (startAt && endAt && new Date(endAt) < new Date(startAt)) {
    return NextResponse.json({ error: "End date must be after start date." }, { status: 400 });
  }

  try {
    const updated = await deps.query<{ id: string }>(
      "update promo_codes set code = $2, is_active = $3, discount_type = $4, apply_scope = $5, discount_value = $6, min_subtotal_cents = $7, max_redemptions = $8, max_redemptions_per_customer = $9, start_at = $10, end_at = $11, allowed_vehicle_ids_json = $12::jsonb, excluded_vehicle_ids_json = $13::jsonb, blackout_dates_json = $14::jsonb, updated_at = now() where id = $1 returning id",
      [
        id,
        code,
        isActive,
        discountType,
        applyScope,
        discountValue,
        minSubtotalCents,
        maxRedemptions,
        maxRedemptionsPerCustomer,
        startAt,
        endAt,
        JSON.stringify(allowedVehicleIds),
        JSON.stringify(excludedVehicleIds),
        JSON.stringify(blackoutDates),
      ],
    );
    if (updated.rowCount === 0) {
      return NextResponse.json({ error: "Promo code not found." }, { status: 404 });
    }

    await deps.writeAudit({
      userId: actor.userId,
      action: "PROMO_CODE_UPDATED",
      entityType: "promo_code",
      entityId: id,
      details: { code, discountType, applyScope, discountValue, isActive },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const codeError = (error as { code?: string } | null)?.code;
    if (codeError === "23505") {
      return NextResponse.json({ error: "Promo code already exists." }, { status: 409 });
    }
    deps.log("api.admin.promo-codes.[id].PATCH", error, { userId: actor.userId, promoId: id });
    return NextResponse.json({ error: "Failed to update promo code." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleAdminPromoCodePatch(request, context, DEFAULT_PATCH_DEPS);
}
