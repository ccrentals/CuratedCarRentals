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
import { normalizePageSize, parsePositiveIntParam } from "@/lib/pagination/sharedPagination";

const ADMIN_PROMO_MUTATION_LIMIT = 20;
const ADMIN_PROMO_MUTATION_WINDOW_SECONDS = 10 * 60;

type PromoListRow = {
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
  current_redemption_count: number;
};

type PromoCountRow = {
  count: number;
};

export type AdminPromoListItem = {
  id: string;
  public_id: string;
  code: string;
  is_active: boolean;
  discount_type: "PERCENT" | "FIXED";
  apply_scope: "OVERALL_TOTAL" | "DAYS_TOTAL";
  discount_value: number;
  min_subtotal_cents: number | null;
  max_redemptions: number | null;
  max_redemptions_per_customer: number | null;
  start_at: string | null;
  end_at: string | null;
  allowed_vehicle_ids_json: string[];
  excluded_vehicle_ids_json: string[];
  blackout_dates_json: string[];
  created_at: string;
  updated_at: string;
  current_redemption_count: number;
  remaining_redemptions: number | null;
  admin_state: ReturnType<typeof derivePromoAdminState>;
};

export type AdminPromoListPage = {
  promos: AdminPromoListItem[];
  totalCount: number;
  page: number;
  totalPages: number;
  rowsPerPage: number;
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
};

function parsePageParam(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    return parsePositiveIntParam(value) ?? 1;
  }
  return 1;
}

function normalizePromoListRow(row: PromoListRow): AdminPromoListItem {
  const currentRedemptionCount = Number(row.current_redemption_count ?? 0);
  const adminState = derivePromoAdminState({
    isActive: row.is_active,
    startAt: row.start_at,
    endAt: row.end_at,
    maxRedemptions: row.max_redemptions,
    currentRedemptionCount,
  });

  return {
    ...row,
    apply_scope: row.apply_scope === "DAYS_TOTAL" ? "DAYS_TOTAL" : "OVERALL_TOTAL",
    allowed_vehicle_ids_json: parseVehicleIds(row.allowed_vehicle_ids_json),
    excluded_vehicle_ids_json: parseVehicleIds(row.excluded_vehicle_ids_json),
    blackout_dates_json: parseBlackoutDates(row.blackout_dates_json),
    discount_value: Number(row.discount_value ?? 0),
    current_redemption_count: currentRedemptionCount,
    remaining_redemptions: computeRemainingRedemptions(row.max_redemptions, currentRedemptionCount),
    admin_state: adminState,
  };
}

export async function fetchAdminPromoCodes(input: {
  q?: string | null;
  page?: string | number | null;
  rows?: string | number | null;
} = {}): Promise<AdminPromoListPage> {
  const q = (input.q ?? "").trim();
  const searchValue = q ? `%${q}%` : null;
  const whereSql = searchValue ? "where (p.code ilike $1 or p.public_id ilike $1)" : "";
  const countParams = searchValue ? [searchValue] : [];
  const rowsPerPage = normalizePageSize(input.rows ?? undefined);
  const requestedPage = parsePageParam(input.page);

  const countResult = await dbQuery<PromoCountRow>(
    `select count(*)::int as count
     from promo_codes p
     ${whereSql}`,
    countParams,
  );
  const totalCount = Number(countResult.rows[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const offset = (page - 1) * rowsPerPage;

  const result = await dbQuery<PromoListRow>(
    `select
       p.id,
       p.public_id,
       p.code,
       p.is_active,
       p.discount_type,
       p.apply_scope,
       p.discount_value,
       p.min_subtotal_cents,
       p.max_redemptions,
       p.max_redemptions_per_customer,
       p.start_at,
       p.end_at,
       p.allowed_vehicle_ids_json,
       p.excluded_vehicle_ids_json,
       p.blackout_dates_json,
       p.created_at,
       p.updated_at,
       coalesce(r.current_redemption_count, 0)::int as current_redemption_count
     from promo_codes p
     left join (
       select promo_code_id, count(*)::int as current_redemption_count
       from promo_redemptions
       group by promo_code_id
     ) r on r.promo_code_id = p.id
     ${whereSql}
     order by p.created_at desc
     limit $${countParams.length + 1}
     offset $${countParams.length + 2}`,
    [...countParams, rowsPerPage, offset],
  );

  const promos = result.rows.map(normalizePromoListRow);
  const from = totalCount === 0 ? 0 : offset + 1;
  const to = totalCount === 0 ? 0 : offset + promos.length;

  return {
    promos,
    totalCount,
    page,
    totalPages,
    rowsPerPage,
    from,
    to,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

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

function parseApplyScope(value: unknown): "OVERALL_TOTAL" | "DAYS_TOTAL" {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  return normalized === "DAYS_TOTAL" ? "DAYS_TOTAL" : "OVERALL_TOTAL";
}

function parseVehicleIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBlackoutDates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
}

export async function GET(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const page = url.searchParams.get("page");
  const rows = url.searchParams.get("rows");
  const promoPage = await fetchAdminPromoCodes({ q, page, rows });

  return NextResponse.json(promoPage);
}

export type AdminPromoCodesPostDeps = {
  requireAdmin: typeof requireAdminRole;
  requireCsrfCheck: typeof requireCsrf;
  consumeRateLimitCheck: typeof consumeRouteRateLimit;
  query: typeof dbQuery;
  writeAudit: typeof writeAuditLog;
  log: typeof logError;
};

const DEFAULT_POST_DEPS: AdminPromoCodesPostDeps = {
  requireAdmin: requireAdminRole,
  requireCsrfCheck: requireCsrf,
  consumeRateLimitCheck: consumeRouteRateLimit,
  query: dbQuery,
  writeAudit: writeAuditLog,
  log: logError,
};

export async function handleAdminPromoCodesPost(
  request: Request,
  deps: AdminPromoCodesPostDeps = DEFAULT_POST_DEPS,
) {
  const auth = await deps.requireAdmin();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await deps.requireCsrfCheck(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const rateLimit = await deps.consumeRateLimitCheck({
    scope: "ADMIN_PROMO_MUTATION_USER",
    route: "/api/admin/promo-codes",
    limit: ADMIN_PROMO_MUTATION_LIMIT,
    windowSeconds: ADMIN_PROMO_MUTATION_WINDOW_SECONDS,
    keyParts: [actor.userId],
  });
  if (!rateLimit.allowed) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "Too many promo code changes. Please try again later." }, { status: 429 }),
      rateLimit,
    );
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
  const allowedVehicleIds = parseVehicleIds(body?.allowedVehicleIds);
  const excludedVehicleIds = parseVehicleIds(body?.excludedVehicleIds);
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
    const insert = await deps.query<{ id: string; public_id: string }>(
      "insert into promo_codes (code, is_active, discount_type, apply_scope, discount_value, min_subtotal_cents, max_redemptions, max_redemptions_per_customer, start_at, end_at, allowed_vehicle_ids_json, excluded_vehicle_ids_json, blackout_dates_json, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14) returning id, public_id",
      [
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
        actor.userId,
      ],
    );

    const promoId = insert.rows[0]?.id;
    const promoPublicId = insert.rows[0]?.public_id;
    await deps.writeAudit({
      userId: actor.userId,
      action: "PROMO_CODE_CREATED",
      entityType: "promo_code",
      entityId: promoId,
      details: { code, discountType, applyScope, discountValue, isActive },
    });

    return NextResponse.json({ ok: true, promoId, promoPublicId });
  } catch (error) {
    const codeError = (error as { code?: string } | null)?.code;
    if (codeError === "23505") {
      return NextResponse.json({ error: "Promo code already exists." }, { status: 409 });
    }
    deps.log("api.admin.promo-codes.POST", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to create promo code." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handleAdminPromoCodesPost(request, DEFAULT_POST_DEPS);
}
