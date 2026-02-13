import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";
import { dbQuery } from "@/lib/db";

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
};

function getQueryable(client?: Queryable): Queryable {
  if (client) return client;
  return { query: (text: string, params: unknown[] = []) => dbQuery(text, params) };
}

type PromoCodeRow = {
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
};

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function normalizePromoCode(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function toNumber(value: string | number | null | undefined, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function dateKey(value: string | Date) {
  const date = dateOnlyUtc(value);
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

function hasBlackoutInRange(startDate: string, endDate: string, blackoutDates: string[]) {
  if (blackoutDates.length === 0) return false;
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  if (!start || !end) return false;
  return blackoutDates.some((date) => date >= start && date <= end);
}

function isWithinWindow(at: Date, startAt: string | null, endAt: string | null) {
  if (startAt) {
    const start = new Date(startAt);
    if (!Number.isNaN(start.getTime()) && at < start) return false;
  }
  if (endAt) {
    const end = new Date(endAt);
    if (!Number.isNaN(end.getTime()) && at > end) return false;
  }
  return true;
}

export type PromoValidationInput = {
  code: string;
  vehicleId: string;
  startDate: string;
  endDate: string;
  subtotalCents: number;
  customerId?: string | null;
  customerEmail?: string | null;
  now?: Date;
  client?: Queryable;
};

export type PromoValidationSuccess = {
  ok: true;
  promoId: string;
  code: string;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  discountAmountCents: number;
  subtotalCents: number;
  totalAfterDiscountCents: number;
};

export type PromoValidationFailure = {
  ok: false;
  reason:
    | "invalid_code"
    | "inactive"
    | "outside_window"
    | "min_subtotal"
    | "vehicle_not_allowed"
    | "vehicle_excluded"
    | "blackout_date"
    | "max_redemptions"
    | "max_per_customer"
    | "invalid_dates";
  message: string;
};

export type PromoValidationResult = PromoValidationSuccess | PromoValidationFailure;

export async function validatePromoForBooking(
  input: PromoValidationInput,
): Promise<PromoValidationResult> {
  const db = getQueryable(input.client);
  const normalizedCode = normalizePromoCode(input.code);
  if (!normalizedCode) {
    return { ok: false, reason: "invalid_code", message: "Enter a promo code." };
  }

  const days = calcDaysInclusive(input.startDate, input.endDate);
  if (days <= 0) {
    return { ok: false, reason: "invalid_dates", message: "Invalid booking dates for promo." };
  }

  const promoResult = await db.query(
    "select id, code, is_active, discount_type, discount_value, min_subtotal_cents, max_redemptions, max_redemptions_per_customer, start_at, end_at, allowed_vehicle_ids_json, excluded_vehicle_ids_json, blackout_dates_json from promo_codes where lower(code) = lower($1) limit 1",
    [normalizedCode],
  );
  if (promoResult.rowCount === 0) {
    return { ok: false, reason: "invalid_code", message: "Promo code not found." };
  }

  const promo = promoResult.rows[0] as PromoCodeRow;
  if (!promo.is_active) {
    return { ok: false, reason: "inactive", message: "Promo code is not active." };
  }

  const now = input.now ?? new Date();
  if (!isWithinWindow(now, promo.start_at, promo.end_at)) {
    return {
      ok: false,
      reason: "outside_window",
      message: "Promo code is outside its valid date range.",
    };
  }

  const subtotal = Math.max(0, Math.round(Number(input.subtotalCents || 0)));
  if (promo.min_subtotal_cents && subtotal < promo.min_subtotal_cents) {
    return {
      ok: false,
      reason: "min_subtotal",
      message: `Promo requires a minimum subtotal of ${promo.min_subtotal_cents}.`,
    };
  }

  const allowedVehicleIds = parseStringArray(promo.allowed_vehicle_ids_json);
  if (allowedVehicleIds.length > 0 && !allowedVehicleIds.includes(input.vehicleId)) {
    return {
      ok: false,
      reason: "vehicle_not_allowed",
      message: "Promo code is not valid for this vehicle.",
    };
  }

  const excludedVehicleIds = parseStringArray(promo.excluded_vehicle_ids_json);
  if (excludedVehicleIds.includes(input.vehicleId)) {
    return {
      ok: false,
      reason: "vehicle_excluded",
      message: "Promo code is excluded for this vehicle.",
    };
  }

  const blackoutDates = parseStringArray(promo.blackout_dates_json);
  if (hasBlackoutInRange(input.startDate, input.endDate, blackoutDates)) {
    return {
      ok: false,
      reason: "blackout_date",
      message: "Promo code is not valid for the selected dates.",
    };
  }

  if (promo.max_redemptions !== null) {
    const totalUseResult = await db.query(
      "select count(*)::int as count from promo_redemptions where promo_code_id = $1",
      [promo.id],
    );
    const totalCount = Number((totalUseResult.rows[0] as { count?: number }).count ?? 0);
    if (totalCount >= promo.max_redemptions) {
      return {
        ok: false,
        reason: "max_redemptions",
        message: "Promo code has reached its maximum redemptions.",
      };
    }
  }

  if (promo.max_redemptions_per_customer !== null) {
    let perCustomerCount = 0;
    if (input.customerId) {
      const perCustomerResult = await db.query(
        "select count(*)::int as count from promo_redemptions where promo_code_id = $1 and customer_id = $2",
        [promo.id, input.customerId],
      );
      perCustomerCount = Number((perCustomerResult.rows[0] as { count?: number }).count ?? 0);
    } else if (input.customerEmail) {
      const perEmailResult = await db.query(
        "select count(*)::int as count from promo_redemptions where promo_code_id = $1 and lower(customer_email) = lower($2)",
        [promo.id, input.customerEmail.trim().toLowerCase()],
      );
      perCustomerCount = Number((perEmailResult.rows[0] as { count?: number }).count ?? 0);
    }

    if (perCustomerCount >= promo.max_redemptions_per_customer) {
      return {
        ok: false,
        reason: "max_per_customer",
        message: "Promo code has reached the per-customer redemption limit.",
      };
    }
  }

  const discountValue = toNumber(promo.discount_value, 0);
  let discountAmount = 0;
  if (promo.discount_type === "PERCENT") {
    discountAmount = Math.round(subtotal * (discountValue / 100));
  } else {
    discountAmount = Math.round(discountValue);
  }
  discountAmount = Math.min(subtotal, Math.max(0, discountAmount));

  return {
    ok: true,
    promoId: promo.id,
    code: normalizePromoCode(promo.code),
    discountType: promo.discount_type,
    discountValue,
    discountAmountCents: discountAmount,
    subtotalCents: subtotal,
    totalAfterDiscountCents: Math.max(0, subtotal - discountAmount),
  };
}

export async function upsertPromoRedemption(
  input: {
    bookingId: string;
    promoId: string;
    customerId?: string | null;
    customerEmail?: string | null;
    discountAmountCents: number;
    client?: Queryable;
  },
) {
  const db = getQueryable(input.client);
  await db.query("delete from promo_redemptions where booking_id = $1 and promo_code_id <> $2", [
    input.bookingId,
    input.promoId,
  ]);
  await db.query(
    "insert into promo_redemptions (promo_code_id, booking_id, customer_id, customer_email, discount_amount_cents) values ($1, $2, $3, $4, $5) on conflict (promo_code_id, booking_id) do update set customer_id = excluded.customer_id, customer_email = excluded.customer_email, discount_amount_cents = excluded.discount_amount_cents",
    [
      input.promoId,
      input.bookingId,
      input.customerId ?? null,
      input.customerEmail ? input.customerEmail.trim().toLowerCase() : null,
      Math.max(0, Math.round(input.discountAmountCents)),
    ],
  );
}

export async function clearPromoRedemptionForBooking(bookingId: string, options: { client?: Queryable } = {}) {
  const db = getQueryable(options.client);
  await db.query("delete from promo_redemptions where booking_id = $1", [bookingId]);
}

export function normalizePromoInputCode(value: string) {
  return normalizePromoCode(value);
}
