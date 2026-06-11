import { calcRentalDays, dateOnlyUtc } from "@/lib/payments/dateMath";
import { fetchNetPaidToDate, readPromoPricingFields } from "@/lib/payments/pricing";
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
  apply_scope: string | null;
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

type BookingPromoSyncRow = {
  id: string;
  status: string;
  customer_id: string | null;
  customer_email: string | null;
  pricing_json: Record<string, unknown> | null;
};

type PromoCurrentRedemptionRow = {
  id: string;
  promo_code_id: string;
  booking_id: string;
  customer_id: string | null;
  customer_email: string | null;
  discount_amount_cents: number;
};

export type PromoAdminState = "ACTIVE" | "INACTIVE" | "SCHEDULED" | "EXPIRED" | "LIMIT_REACHED";
export type PromoLedgerTimestampSource = "payment" | "refund_payment" | "cancel_audit" | "booking_updated";

export type ReconstructedPromoLedgerEvent = {
  eventType: "REDEEMED" | "REVERSED";
  eventAt: string;
  metadata: {
    reconstructed: true;
    source: "legacy_reconstruction";
    timestampSource: PromoLedgerTimestampSource;
  };
};

export type ReconstructedPromoLedgerState = {
  events: ReconstructedPromoLedgerEvent[];
  currentRedemption:
    | {
        promoCodeId: string;
        bookingId: string;
        customerId: string | null;
        customerEmail: string | null;
        discountAmountCents: number;
      }
    | null;
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

function normalizeNullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePromoDiscountAmount(value: unknown) {
  return Math.max(0, Math.round(toNumber(value, 0)));
}

function normalizeIsoDateTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function toNumber(value: unknown, fallback = 0) {
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
  baseTotalCents: number;
  customerId?: string | null;
  customerEmail?: string | null;
  now?: Date;
  client?: Queryable;
};

export type PromoApplyScope = "OVERALL_TOTAL" | "DAYS_TOTAL";

export type PromoValidationSuccess = {
  ok: true;
  promoId: string;
  code: string;
  discountType: "PERCENT" | "FIXED";
  applyScope: PromoApplyScope;
  discountValue: number;
  discountAmountCents: number;
  discountBaseCents: number;
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

export type UpsertPromoRedemptionInput = {
  promoId: string;
  bookingId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  discountAmountCents: number;
  client?: Queryable;
};

function normalizeApplyScope(value: unknown): PromoApplyScope {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "DAYS_TOTAL") return "DAYS_TOTAL";
  return "OVERALL_TOTAL";
}

export function derivePromoAdminState(input: {
  isActive: boolean;
  startAt: string | null;
  endAt: string | null;
  maxRedemptions: number | null;
  currentRedemptionCount: number;
  now?: Date;
}): PromoAdminState {
  const now = input.now ?? new Date();

  if (input.endAt) {
    const end = new Date(input.endAt);
    if (!Number.isNaN(end.getTime()) && end < now) {
      return "EXPIRED";
    }
  }

  if (!input.isActive) return "INACTIVE";

  if (input.startAt) {
    const start = new Date(input.startAt);
    if (!Number.isNaN(start.getTime()) && start > now) {
      return "SCHEDULED";
    }
  }

  if (input.maxRedemptions !== null && input.currentRedemptionCount >= input.maxRedemptions) {
    return "LIMIT_REACHED";
  }

  return "ACTIVE";
}

export function promoAdminStateLabel(state: PromoAdminState) {
  if (state === "ACTIVE") return "Active";
  if (state === "INACTIVE") return "Inactive";
  if (state === "SCHEDULED") return "Scheduled";
  if (state === "LIMIT_REACHED") return "Limit reached";
  return "Expired";
}

export function computeRemainingRedemptions(maxRedemptions: number | null, currentRedemptionCount: number) {
  if (maxRedemptions === null) return null;
  return Math.max(0, maxRedemptions - currentRedemptionCount);
}

export function deriveReconstructedPromoLedgerState(input: {
  promoCodeId: string | null;
  bookingId: string;
  bookingStatus: string | null;
  customerId: string | null;
  customerEmail: string | null;
  discountAmountCents: number;
  netPaidToDate: number;
  redeemedAt: string | null;
  refundedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string | null;
}): ReconstructedPromoLedgerState {
  const promoCodeId = normalizeNullableString(input.promoCodeId);
  if (!promoCodeId) {
    return { events: [], currentRedemption: null };
  }

  const redeemedAt = normalizeIsoDateTime(input.redeemedAt);
  if (!redeemedAt) {
    return { events: [], currentRedemption: null };
  }

  const bookingStatus = String(input.bookingStatus ?? "").trim().toUpperCase();
  const customerId = normalizeNullableString(input.customerId);
  const customerEmail = normalizeNullableString(input.customerEmail)?.toLowerCase() ?? null;
  const discountAmountCents = normalizePromoDiscountAmount(input.discountAmountCents);
  const netPaidToDate = toNumber(input.netPaidToDate, 0);

  const events: ReconstructedPromoLedgerEvent[] = [
    {
      eventType: "REDEEMED",
      eventAt: redeemedAt,
      metadata: {
        reconstructed: true,
        source: "legacy_reconstruction",
        timestampSource: "payment",
      },
    },
  ];

  const paidAtMs = new Date(redeemedAt).getTime();
  const refundedAt = normalizeIsoDateTime(input.refundedAt);
  const cancelledAt = normalizeIsoDateTime(input.cancelledAt);
  const updatedAt = normalizeIsoDateTime(input.updatedAt);
  const shouldRemainCounted = bookingStatus !== "CANCELLED" && netPaidToDate > 0;

  let reversalAt: string | null = null;
  let reversalSource: PromoLedgerTimestampSource | null = null;

  if (!shouldRemainCounted && refundedAt && new Date(refundedAt).getTime() >= paidAtMs) {
    reversalAt = refundedAt;
    reversalSource = "refund_payment";
  } else if (!shouldRemainCounted) {
    if (cancelledAt) {
      reversalAt = cancelledAt;
      reversalSource = "cancel_audit";
    } else if (updatedAt) {
      reversalAt = updatedAt;
      reversalSource = "booking_updated";
    }
  }

  if (reversalAt && new Date(reversalAt).getTime() < paidAtMs) {
    reversalAt = redeemedAt;
  }

  if (reversalAt && reversalSource) {
    events.push({
      eventType: "REVERSED",
      eventAt: reversalAt,
      metadata: {
        reconstructed: true,
        source: "legacy_reconstruction",
        timestampSource: reversalSource,
      },
    });
  }

  return {
    events,
    currentRedemption:
      shouldRemainCounted && !reversalAt
        ? {
            promoCodeId,
            bookingId: input.bookingId,
            customerId,
            customerEmail,
            discountAmountCents,
          }
        : null,
  };
}

export async function validatePromoForBooking(
  input: PromoValidationInput,
): Promise<PromoValidationResult> {
  const db = getQueryable(input.client);
  const normalizedCode = normalizePromoCode(input.code);
  if (!normalizedCode) {
    return { ok: false, reason: "invalid_code", message: "Enter a promo code." };
  }

  const days = calcRentalDays(input.startDate, input.endDate);
  if (days <= 0) {
    return { ok: false, reason: "invalid_dates", message: "Invalid booking dates for promo." };
  }

  let promoResult: { rows: unknown[]; rowCount: number };
  try {
    promoResult = await db.query(
      "select id, code, is_active, discount_type, apply_scope, discount_value, min_subtotal_cents, max_redemptions, max_redemptions_per_customer, start_at, end_at, allowed_vehicle_ids_json, excluded_vehicle_ids_json, blackout_dates_json from promo_codes where lower(code) = lower($1) limit 1",
      [normalizedCode],
    );
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "42703") throw error;
    promoResult = await db.query(
      "select id, code, is_active, discount_type, 'OVERALL_TOTAL'::text as apply_scope, discount_value, min_subtotal_cents, max_redemptions, max_redemptions_per_customer, start_at, end_at, allowed_vehicle_ids_json, excluded_vehicle_ids_json, blackout_dates_json from promo_codes where lower(code) = lower($1) limit 1",
      [normalizedCode],
    );
  }
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
  const baseTotal = Math.max(0, Math.round(Number(input.baseTotalCents || 0)));
  const applyScope = normalizeApplyScope(promo.apply_scope);
  const discountBase = applyScope === "DAYS_TOTAL" ? baseTotal : subtotal;

  if (promo.min_subtotal_cents && discountBase < promo.min_subtotal_cents) {
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
    discountAmount = Math.round(discountBase * (discountValue / 100));
  } else {
    discountAmount = Math.round(discountValue);
  }
  discountAmount = Math.min(discountBase, Math.max(0, discountAmount));

  return {
    ok: true,
    promoId: promo.id,
    code: normalizePromoCode(promo.code),
    discountType: promo.discount_type,
    applyScope,
    discountValue,
    discountAmountCents: discountAmount,
    discountBaseCents: discountBase,
    subtotalCents: subtotal,
    totalAfterDiscountCents: Math.max(0, subtotal - discountAmount),
  };
}

export async function upsertPromoRedemption(input: UpsertPromoRedemptionInput) {
  const db = getQueryable(input.client);
  const promoId = normalizeNullableString(input.promoId);
  const bookingId = normalizeNullableString(input.bookingId);
  if (!promoId || !bookingId) {
    throw new Error("Promo and booking ids are required.");
  }

  await db.query("delete from promo_redemptions where booking_id = $1 and promo_code_id <> $2", [
    bookingId,
    promoId,
  ]);

  await db.query(
    "insert into promo_redemptions (promo_code_id, booking_id, customer_id, customer_email, discount_amount_cents) values ($1, $2, $3, $4, $5) on conflict (promo_code_id, booking_id) do update set customer_id = excluded.customer_id, customer_email = excluded.customer_email, discount_amount_cents = excluded.discount_amount_cents",
    [
      promoId,
      bookingId,
      normalizeNullableString(input.customerId),
      normalizeNullableString(input.customerEmail)?.toLowerCase() ?? null,
      normalizePromoDiscountAmount(input.discountAmountCents),
    ],
  );
}

async function resolveBookingPromoId(
  db: Queryable,
  pricing: Record<string, unknown> | null | undefined,
) {
  const promoCodeId = normalizeNullableString(pricing?.promo_code_id);
  if (promoCodeId) {
    const byId = await db.query("select id from promo_codes where id = $1 limit 1", [promoCodeId]);
    if (byId.rowCount > 0) {
      return String((byId.rows[0] as { id: string }).id);
    }
  }

  const { promoCode } = readPromoPricingFields(pricing);
  if (!promoCode) return null;

  const byCode = await db.query("select id from promo_codes where lower(code) = lower($1) limit 1", [promoCode]);
  if (byCode.rowCount === 0) return null;
  return String((byCode.rows[0] as { id: string }).id);
}

async function appendPromoRedemptionEvent(
  db: Queryable,
  row: {
    promoCodeId: string;
    bookingId: string;
    customerId: string | null;
    customerEmail: string | null;
    discountAmountCents: number;
  },
  input: {
    eventType: "REDEEMED" | "REVERSED";
    eventAt: string;
    source: string;
    reason: string;
  },
) {
  await db.query(
    "insert into promo_redemption_events (promo_code_id, booking_id, customer_id, customer_email, discount_amount_cents, event_type, event_at, metadata_json) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)",
    [
      row.promoCodeId,
      row.bookingId,
      row.customerId,
      row.customerEmail,
      row.discountAmountCents,
      input.eventType,
      input.eventAt,
      JSON.stringify({
        source: input.source,
        reason: input.reason,
      }),
    ],
  );
}

function isEquivalentCurrentRedemption(
  row: PromoCurrentRedemptionRow,
  target: {
    promoCodeId: string;
    bookingId: string;
    customerId: string | null;
    customerEmail: string | null;
    discountAmountCents: number;
  },
) {
  return (
    row.promo_code_id === target.promoCodeId &&
    row.booking_id === target.bookingId &&
    row.customer_id === target.customerId &&
    normalizeNullableString(row.customer_email)?.toLowerCase() ===
      normalizeNullableString(target.customerEmail)?.toLowerCase() &&
    Math.round(Number(row.discount_amount_cents ?? 0)) === Math.round(Number(target.discountAmountCents ?? 0))
  );
}

export async function syncPromoRedemptionStateForBooking(
  bookingId: string,
  options: { client?: Queryable; source?: string } = {},
) {
  const db = getQueryable(options.client);
  const source = normalizeNullableString(options.source) ?? "promo_redemption_sync";
  const eventAt = new Date().toISOString();

  const bookingResult = await db.query(
    "select b.id, b.status, b.customer_id, c.email as customer_email, b.pricing_json from bookings b join customers c on c.id = b.customer_id where b.id = $1 limit 1",
    [bookingId],
  );
  if (bookingResult.rowCount === 0) {
    throw new Error("Booking not found");
  }

  const booking = bookingResult.rows[0] as BookingPromoSyncRow;
  const pricing = booking.pricing_json ?? {};
  const promoCodeId = await resolveBookingPromoId(db, pricing);
  const promoDiscountCents = normalizePromoDiscountAmount(pricing.promo_discount_cents);
  const normalizedStatus = String(booking.status ?? "").trim().toUpperCase();
  const netPaidToDate = await fetchNetPaidToDate(bookingId, { client: db });

  const shouldRedeem = Boolean(promoCodeId) && normalizedStatus !== "CANCELLED" && netPaidToDate > 0;

  const targetRedemption = shouldRedeem && promoCodeId
    ? {
        promoCodeId,
        bookingId,
        customerId: normalizeNullableString(booking.customer_id),
        customerEmail: normalizeNullableString(booking.customer_email)?.toLowerCase() ?? null,
        discountAmountCents: promoDiscountCents,
      }
    : null;

  const currentResult = await db.query(
    "select id, promo_code_id, booking_id, customer_id, customer_email, discount_amount_cents from promo_redemptions where booking_id = $1",
    [bookingId],
  );

  const currentRows = currentResult.rows as PromoCurrentRedemptionRow[];
  const matchingCurrentRow =
    targetRedemption === null
      ? null
      : currentRows.find((row) => isEquivalentCurrentRedemption(row, targetRedemption)) ?? null;

  for (const row of currentRows) {
    if (matchingCurrentRow && row.id === matchingCurrentRow.id) {
      continue;
    }

    await appendPromoRedemptionEvent(
      db,
      {
        promoCodeId: row.promo_code_id,
        bookingId: row.booking_id,
        customerId: normalizeNullableString(row.customer_id),
        customerEmail: normalizeNullableString(row.customer_email)?.toLowerCase() ?? null,
        discountAmountCents: normalizePromoDiscountAmount(row.discount_amount_cents),
      },
      {
        eventType: "REVERSED",
        eventAt,
        source,
        reason: targetRedemption ? "state_changed" : "no_longer_redeemed",
      },
    );

    await db.query("delete from promo_redemptions where id = $1", [row.id]);
  }

  if (targetRedemption && !matchingCurrentRow) {
    await db.query(
      "insert into promo_redemptions (promo_code_id, booking_id, customer_id, customer_email, discount_amount_cents) values ($1, $2, $3, $4, $5)",
      [
        targetRedemption.promoCodeId,
        targetRedemption.bookingId,
        targetRedemption.customerId,
        targetRedemption.customerEmail,
        targetRedemption.discountAmountCents,
      ],
    );

    await appendPromoRedemptionEvent(db, targetRedemption, {
      eventType: "REDEEMED",
      eventAt,
      source,
      reason: "currently_redeemed",
    });
  }
}

export function normalizePromoInputCode(value: string) {
  return normalizePromoCode(value);
}
