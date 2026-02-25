import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { normalizePromoInputCode } from "@/lib/promos";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";

type PromoRow = {
  id: string;
  code: string;
  is_active: boolean;
  discount_type: "PERCENT" | "FIXED";
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
  customer_email: string | null;
  discount_amount_cents: number;
  created_at: string;
};

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

function normalizePromoPayload(row: PromoRow) {
  return {
    ...row,
    discount_value: Number(row.discount_value ?? 0),
    allowed_vehicle_ids_json: parseStringArray(row.allowed_vehicle_ids_json),
    excluded_vehicle_ids_json: parseStringArray(row.excluded_vehicle_ids_json),
    blackout_dates_json: parseBlackoutDates(row.blackout_dates_json),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const promo = await dbQuery<PromoRow>(
    "select id, code, is_active, discount_type, discount_value, min_subtotal_cents, max_redemptions, max_redemptions_per_customer, start_at, end_at, allowed_vehicle_ids_json, excluded_vehicle_ids_json, blackout_dates_json, created_at, updated_at from promo_codes where id = $1 limit 1",
    [id],
  );
  if (promo.rowCount === 0) {
    return NextResponse.json({ error: "Promo code not found." }, { status: 404 });
  }

  const redemptions = await dbQuery<RedemptionRow>(
    "select id, booking_id, customer_email, discount_amount_cents, created_at from promo_redemptions where promo_code_id = $1 order by created_at desc limit 100",
    [id],
  );

  return NextResponse.json({
    promo: normalizePromoPayload(promo.rows[0]),
    redemptions: redemptions.rows,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  if (body?.action === "set_active") {
    const isActive = body?.isActive !== false;
    const updated = await dbQuery<{ id: string }>(
      "update promo_codes set is_active = $2, updated_at = now() where id = $1 returning id",
      [id, isActive],
    );
    if (updated.rowCount === 0) {
      return NextResponse.json({ error: "Promo code not found." }, { status: 404 });
    }

    await writeAuditLog({
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
    const updated = await dbQuery<{ id: string }>(
      "update promo_codes set code = $2, is_active = $3, discount_type = $4, discount_value = $5, min_subtotal_cents = $6, max_redemptions = $7, max_redemptions_per_customer = $8, start_at = $9, end_at = $10, allowed_vehicle_ids_json = $11::jsonb, excluded_vehicle_ids_json = $12::jsonb, blackout_dates_json = $13::jsonb, updated_at = now() where id = $1 returning id",
      [
        id,
        code,
        isActive,
        discountType,
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

    await writeAuditLog({
      userId: actor.userId,
      action: "PROMO_CODE_UPDATED",
      entityType: "promo_code",
      entityId: id,
      details: { code, discountType, discountValue, isActive },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const codeError = (error as { code?: string } | null)?.code;
    if (codeError === "23505") {
      return NextResponse.json({ error: "Promo code already exists." }, { status: 409 });
    }
    logError("api.admin.promo-codes.[id].PATCH", error, { userId: actor.userId, promoId: id });
    return NextResponse.json({ error: "Failed to update promo code." }, { status: 500 });
  }
}
