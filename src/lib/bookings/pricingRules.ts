import { dbQuery } from "@/lib/db";
import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";
import type { Queryable } from "@/lib/payments/pricing";

type VehiclePricingRulesRow = {
  id: string;
  vehicle_id: string;
  base_daily_rate_cents: number | null;
  base_deposit_cents: number | null;
  weekend_daily_rate_cents: number | null;
  date_range_overrides_json: unknown;
  delivery_enabled: boolean;
  delivery_fee_cents: number;
  delivery_zones_json: unknown;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type VehiclePricingProfileRow = {
  vehicle_id: string;
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  deposit_cents: number;
  features_json: unknown;
  rule_id: string | null;
  base_daily_rate_cents: number | null;
  base_deposit_cents: number | null;
  weekend_daily_rate_cents: number | null;
  date_range_overrides_json: unknown;
  delivery_enabled: boolean | null;
  delivery_fee_cents: number | null;
  delivery_zones_json: unknown;
  currency: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type VehiclePricingDateRangeOverride = {
  start: string;
  end: string;
  dailyRateCents: number;
  depositCents: number | null;
};

export type VehiclePricingDeliveryZone = {
  label: string;
  feeCents: number;
};

export type VehiclePricingRules = {
  id: string | null;
  vehicleId: string;
  baseDailyRateCents: number | null;
  baseDepositCents: number | null;
  weekendDailyRateCents: number | null;
  dateRangeOverrides: VehiclePricingDateRangeOverride[];
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  deliveryZones: VehiclePricingDeliveryZone[];
  currency: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type VehiclePricingRulesPatch = {
  baseDailyRateCents: number | null;
  baseDepositCents: number | null;
  weekendDailyRateCents: number | null;
  dateRangeOverrides: VehiclePricingDateRangeOverride[];
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  deliveryZones: VehiclePricingDeliveryZone[];
  currency: string;
  isActive: boolean;
};

export type VehiclePricingProfile = {
  vehicleId: string;
  vehicleLabel: string;
  vehicleClass: string | null;
  defaultDailyRateCents: number;
  defaultDepositCents: number;
  rules: VehiclePricingRules;
  defaultsApplied: boolean;
};

export type ComputedVehicleQuotePrice = {
  days: number;
  currency: string;
  dailyRateCents: number;
  baseTotalCents: number;
  insurancePricePerDayCents: number;
  insuranceTotalCents: number;
  deliverySelected: boolean;
  deliveryFeeCents: number;
  deliveryZoneLabel: string | null;
  extraFeesTotalCents: number;
  discountTotalCents: number;
  subtotalCents: number;
  totalCents: number;
  depositRequiredCents: number;
  amountDueCents: number;
  rateBreakdown: Array<{ date: string; dailyRateCents: number; source: "base" | "weekend" | "date_override" }>;
  pricingSnapshotJson: Record<string, unknown>;
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function asQueryable(client?: Queryable): Queryable {
  if (client) return client;
  return {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };
}

function normalizeMoney(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const normalized = Math.round(amount);
  if (normalized < 0) return null;
  return normalized;
}

function normalizeOptionalMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return normalizeMoney(value);
}

function normalizeCurrency(value: unknown) {
  if (typeof value !== "string") return "JMD";
  const normalized = value.trim().toUpperCase();
  if (!normalized) return "JMD";
  return normalized.slice(0, 8);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveVehicleClass(featuresJson: unknown) {
  const features = toRecord(featuresJson);
  return normalizeOptionalText(features.category) ?? normalizeOptionalText(features.class);
}

function isMissingRulesTableError(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "").toUpperCase();
  if (code !== "42P01") return false;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return message.includes("vehicle_pricing_rules");
}

function normalizeDateOnly(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return DATE_ONLY_RE.test(trimmed) ? trimmed : null;
}

function parseDateRangeOverrides(value: unknown): VehiclePricingDateRangeOverride[] {
  if (!Array.isArray(value)) return [];

  const parsed: VehiclePricingDateRangeOverride[] = [];
  for (const entry of value) {
    const row = toRecord(entry);
    const start = normalizeDateOnly(row.start);
    const end = normalizeDateOnly(row.end);
    const dailyRateCents = normalizeMoney(row.daily_rate_cents ?? row.dailyRateCents);
    const depositCents = normalizeOptionalMoney(row.deposit_cents ?? row.depositCents);

    if (!start || !end || !dailyRateCents) continue;
    if (start > end) continue;

    parsed.push({ start, end, dailyRateCents, depositCents });
    if (parsed.length >= 64) break;
  }

  return parsed;
}

function parseDeliveryZones(value: unknown): VehiclePricingDeliveryZone[] {
  if (!Array.isArray(value)) return [];
  const parsed: VehiclePricingDeliveryZone[] = [];

  for (const entry of value) {
    const row = toRecord(entry);
    const label = normalizeOptionalText(row.label);
    const feeCents = normalizeMoney(row.fee_cents ?? row.feeCents);
    if (!label || feeCents === null) continue;
    parsed.push({ label, feeCents });
    if (parsed.length >= 64) break;
  }

  return parsed;
}

function defaults(vehicleId: string): VehiclePricingRules {
  return {
    id: null,
    vehicleId,
    baseDailyRateCents: null,
    baseDepositCents: null,
    weekendDailyRateCents: null,
    dateRangeOverrides: [],
    deliveryEnabled: false,
    deliveryFeeCents: 0,
    deliveryZones: [],
    currency: "JMD",
    isActive: true,
    createdAt: null,
    updatedAt: null,
  };
}

function normalizeRulesRow(vehicleId: string, row: VehiclePricingRulesRow | null): VehiclePricingRules {
  if (!row) return defaults(vehicleId);

  return {
    id: row.id,
    vehicleId,
    baseDailyRateCents: normalizeOptionalMoney(row.base_daily_rate_cents),
    baseDepositCents: normalizeOptionalMoney(row.base_deposit_cents),
    weekendDailyRateCents: normalizeOptionalMoney(row.weekend_daily_rate_cents),
    dateRangeOverrides: parseDateRangeOverrides(row.date_range_overrides_json),
    deliveryEnabled: Boolean(row.delivery_enabled),
    deliveryFeeCents: normalizeMoney(row.delivery_fee_cents) ?? 0,
    deliveryZones: parseDeliveryZones(row.delivery_zones_json),
    currency: normalizeCurrency(row.currency),
    isActive: row.is_active !== false,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function getVehiclePricingProfile(
  vehicleId: string,
  options: { client?: Queryable; strictTable?: boolean } = {},
): Promise<VehiclePricingProfile | null> {
  const db = asQueryable(options.client);

  try {
    const result = await db.query(
      `select
         v.id as vehicle_id,
         v.make,
         v.model,
         v.year,
         v.daily_rate_cents,
         v.deposit_cents,
         v.features_json,
         r.id as rule_id,
         r.base_daily_rate_cents,
         r.base_deposit_cents,
         r.weekend_daily_rate_cents,
         r.date_range_overrides_json,
         r.delivery_enabled,
         r.delivery_fee_cents,
         r.delivery_zones_json,
         r.currency,
         r.is_active,
         r.created_at,
         r.updated_at
       from vehicles v
       left join vehicle_pricing_rules r on r.vehicle_id = v.id
       where v.id = $1::uuid
       limit 1`,
      [vehicleId],
    );

    if (result.rowCount < 1) return null;

    const row = result.rows[0] as VehiclePricingProfileRow;
    const normalizedRules = normalizeRulesRow(
      row.vehicle_id,
      row.rule_id
        ? {
            id: row.rule_id,
            vehicle_id: row.vehicle_id,
            base_daily_rate_cents: row.base_daily_rate_cents,
            base_deposit_cents: row.base_deposit_cents,
            weekend_daily_rate_cents: row.weekend_daily_rate_cents,
            date_range_overrides_json: row.date_range_overrides_json,
            delivery_enabled: Boolean(row.delivery_enabled),
            delivery_fee_cents: row.delivery_fee_cents ?? 0,
            delivery_zones_json: row.delivery_zones_json,
            currency: row.currency ?? "JMD",
            is_active: row.is_active !== false,
            created_at: row.created_at ?? new Date().toISOString(),
            updated_at: row.updated_at ?? new Date().toISOString(),
          }
        : null,
    );

    return {
      vehicleId: row.vehicle_id,
      vehicleLabel: `${String(row.make ?? "").trim()} ${String(row.model ?? "").trim()}`.trim(),
      vehicleClass: resolveVehicleClass(row.features_json),
      defaultDailyRateCents: normalizeMoney(row.daily_rate_cents) ?? 0,
      defaultDepositCents: normalizeMoney(row.deposit_cents) ?? 0,
      rules: normalizedRules,
      defaultsApplied: !row.rule_id,
    };
  } catch (error) {
    if (isMissingRulesTableError(error) && !options.strictTable) {
      const fallback = await db.query(
        "select id as vehicle_id, make, model, year, daily_rate_cents, deposit_cents, features_json from vehicles where id = $1::uuid limit 1",
        [vehicleId],
      );
      if (fallback.rowCount < 1) return null;

      const row = fallback.rows[0] as {
        vehicle_id: string;
        make: string;
        model: string;
        year: number;
        daily_rate_cents: number;
        deposit_cents: number;
        features_json: unknown;
      };

      return {
        vehicleId: row.vehicle_id,
        vehicleLabel: `${String(row.make ?? "").trim()} ${String(row.model ?? "").trim()}`.trim(),
        vehicleClass: resolveVehicleClass(row.features_json),
        defaultDailyRateCents: normalizeMoney(row.daily_rate_cents) ?? 0,
        defaultDepositCents: normalizeMoney(row.deposit_cents) ?? 0,
        rules: defaults(row.vehicle_id),
        defaultsApplied: true,
      };
    }

    throw error;
  }
}

export async function upsertVehiclePricingRules(
  vehicleId: string,
  patch: VehiclePricingRulesPatch,
  options: { client?: Queryable } = {},
): Promise<VehiclePricingRules> {
  const db = asQueryable(options.client);
  const result = await db.query(
    `insert into vehicle_pricing_rules (
       vehicle_id,
       base_daily_rate_cents,
       base_deposit_cents,
       weekend_daily_rate_cents,
       date_range_overrides_json,
       delivery_enabled,
       delivery_fee_cents,
       delivery_zones_json,
       currency,
       is_active
     )
     values ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10)
     on conflict (vehicle_id)
     do update set
       base_daily_rate_cents = excluded.base_daily_rate_cents,
       base_deposit_cents = excluded.base_deposit_cents,
       weekend_daily_rate_cents = excluded.weekend_daily_rate_cents,
       date_range_overrides_json = excluded.date_range_overrides_json,
       delivery_enabled = excluded.delivery_enabled,
       delivery_fee_cents = excluded.delivery_fee_cents,
       delivery_zones_json = excluded.delivery_zones_json,
       currency = excluded.currency,
       is_active = excluded.is_active,
       updated_at = now()
     returning
       id,
       vehicle_id,
       base_daily_rate_cents,
       base_deposit_cents,
       weekend_daily_rate_cents,
       date_range_overrides_json,
       delivery_enabled,
       delivery_fee_cents,
       delivery_zones_json,
       currency,
       is_active,
       created_at,
       updated_at`,
    [
      vehicleId,
      patch.baseDailyRateCents,
      patch.baseDepositCents,
      patch.weekendDailyRateCents,
      JSON.stringify(patch.dateRangeOverrides),
      patch.deliveryEnabled,
      patch.deliveryFeeCents,
      JSON.stringify(patch.deliveryZones),
      normalizeCurrency(patch.currency),
      patch.isActive,
    ],
  );

  return normalizeRulesRow(vehicleId, (result.rows[0] ?? null) as VehiclePricingRulesRow | null);
}

function normalizeDateAtUtcMidnight(value: Date) {
  const asDateOnly = dateOnlyUtc(value);
  return asDateOnly ? new Date(asDateOnly) : null;
}

function resolveDailyRateForDate(
  dateKey: string,
  dayOfWeek: number,
  profile: VehiclePricingProfile,
): { dailyRateCents: number; source: "base" | "weekend" | "date_override" } {
  const rules = profile.rules;
  const baseDaily = rules.isActive && rules.baseDailyRateCents !== null
    ? rules.baseDailyRateCents
    : profile.defaultDailyRateCents;

  if (rules.isActive) {
    let matchedOverride: VehiclePricingDateRangeOverride | null = null;
    for (const override of rules.dateRangeOverrides) {
      if (dateKey >= override.start && dateKey <= override.end) {
        matchedOverride = override;
      }
    }
    if (matchedOverride) {
      return { dailyRateCents: matchedOverride.dailyRateCents, source: "date_override" };
    }

    if ((dayOfWeek === 0 || dayOfWeek === 6) && rules.weekendDailyRateCents !== null) {
      return { dailyRateCents: rules.weekendDailyRateCents, source: "weekend" };
    }
  }

  return { dailyRateCents: baseDaily, source: "base" };
}

function resolveDeposit(profile: VehiclePricingProfile, startDateKey: string) {
  const rules = profile.rules;
  if (!rules.isActive) return profile.defaultDepositCents;

  let overrideDeposit: number | null = null;
  for (const override of rules.dateRangeOverrides) {
    if (override.depositCents === null) continue;
    if (startDateKey >= override.start && startDateKey <= override.end) {
      overrideDeposit = override.depositCents;
    }
  }

  if (overrideDeposit !== null) return overrideDeposit;
  if (rules.baseDepositCents !== null) return rules.baseDepositCents;
  return profile.defaultDepositCents;
}

function resolveDeliveryFee(input: {
  profile: VehiclePricingProfile;
  deliverySelected: boolean;
  deliveryZoneLabel?: string | null;
}) {
  const rules = input.profile.rules;
  if (!rules.isActive || !rules.deliveryEnabled || !input.deliverySelected) {
    return { feeCents: 0, selectedZoneLabel: null as string | null };
  }

  const normalizedZone = normalizeOptionalText(input.deliveryZoneLabel)?.toLowerCase() ?? null;
  if (normalizedZone) {
    const zone = rules.deliveryZones.find((entry) => entry.label.toLowerCase() === normalizedZone);
    if (zone) {
      return {
        feeCents: zone.feeCents,
        selectedZoneLabel: zone.label,
      };
    }
  }

  return {
    feeCents: rules.deliveryFeeCents,
    selectedZoneLabel: null,
  };
}

export function computeQuotePrice(input: {
  profile: VehiclePricingProfile;
  startAt: string | Date;
  endAt: string | Date;
  insuranceSelected?: boolean;
  insurancePricePerDayCents?: number;
  promoCode?: string | null;
  promoDiscountCents?: number;
  deliverySelected?: boolean;
  deliveryZoneLabel?: string | null;
}): ComputedVehicleQuotePrice {
  const startDate = input.startAt instanceof Date ? input.startAt : new Date(String(input.startAt));
  const endDate = input.endAt instanceof Date ? input.endAt : new Date(String(input.endAt));

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    throw new Error("Invalid rental window.");
  }

  const startDateUtc = normalizeDateAtUtcMidnight(startDate);
  const endDateUtc = normalizeDateAtUtcMidnight(endDate);
  if (!startDateUtc || !endDateUtc) {
    throw new Error("Invalid rental dates.");
  }

  const days = calcDaysInclusive(startDateUtc, endDateUtc);
  if (days <= 0) {
    throw new Error("Invalid rental duration.");
  }

  const rateBreakdown: ComputedVehicleQuotePrice["rateBreakdown"] = [];
  let baseTotalCents = 0;

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const dayDate = new Date(startDateUtc.getTime() + dayIndex * 24 * 60 * 60 * 1000);
    const dateKey = dayDate.toISOString().slice(0, 10);
    const resolved = resolveDailyRateForDate(dateKey, dayDate.getUTCDay(), input.profile);
    baseTotalCents += resolved.dailyRateCents;
    rateBreakdown.push({
      date: dateKey,
      dailyRateCents: resolved.dailyRateCents,
      source: resolved.source,
    });
  }

  const insuranceSelected = input.insuranceSelected === true;
  const insurancePricePerDayCents = insuranceSelected
    ? Math.max(0, normalizeMoney(input.insurancePricePerDayCents) ?? 0)
    : 0;
  const insuranceTotalCents = insuranceSelected ? insurancePricePerDayCents * days : 0;

  const delivery = resolveDeliveryFee({
    profile: input.profile,
    deliverySelected: input.deliverySelected === true,
    deliveryZoneLabel: input.deliveryZoneLabel,
  });

  const extraFeesTotalCents = Math.max(0, delivery.feeCents);
  const subtotalCents = baseTotalCents + insuranceTotalCents + extraFeesTotalCents;
  const discountTotalCents = Math.min(
    subtotalCents,
    Math.max(0, normalizeMoney(input.promoDiscountCents) ?? 0),
  );
  const totalCents = Math.max(0, subtotalCents - discountTotalCents);

  const startDateKey = startDateUtc.toISOString().slice(0, 10);
  const depositRequiredCents = resolveDeposit(input.profile, startDateKey);

  const dailyRateCents = days > 0 ? Math.round(baseTotalCents / days) : 0;
  const promoCode = normalizeOptionalText(input.promoCode)?.toUpperCase() ?? null;

  const pricingSnapshotJson: Record<string, unknown> = {
    days,
    currency: normalizeCurrency(input.profile.rules.currency),
    daily_rate_cents: dailyRateCents,
    base_total_cents: baseTotalCents,
    insurance_selected: insuranceSelected,
    insurance_price_per_day_cents: insurancePricePerDayCents,
    insurance_total_cents: insuranceTotalCents,
    delivery_selected: input.deliverySelected === true,
    delivery_enabled: input.profile.rules.isActive && input.profile.rules.deliveryEnabled,
    delivery_fee_cents: delivery.feeCents,
    delivery_zone_label: delivery.selectedZoneLabel,
    extra_fees_cents: extraFeesTotalCents,
    promo_code: promoCode,
    promo_discount_cents: discountTotalCents,
    discount_total_cents: discountTotalCents,
    subtotal_cents: subtotalCents,
    total_cents: totalCents,
    total_amount: totalCents,
    amount_due_cents: totalCents,
    amount_due: totalCents,
    deposit_required_cents: depositRequiredCents,
    deposit_cents: depositRequiredCents,
    amount_paid: 0,
    paid_to_date: 0,
    balance_due_cents: totalCents,
    balance_due: totalCents,
    payment_option_selected: "DEPOSIT",
    payment_status: "UNPAID",
    refund_required: false,
    rate_breakdown: rateBreakdown,
    pricing_rules_id: input.profile.rules.id,
  };

  return {
    days,
    currency: normalizeCurrency(input.profile.rules.currency),
    dailyRateCents,
    baseTotalCents,
    insurancePricePerDayCents,
    insuranceTotalCents,
    deliverySelected: input.deliverySelected === true,
    deliveryFeeCents: delivery.feeCents,
    deliveryZoneLabel: delivery.selectedZoneLabel,
    extraFeesTotalCents,
    discountTotalCents,
    subtotalCents,
    totalCents,
    depositRequiredCents,
    amountDueCents: totalCents,
    rateBreakdown,
    pricingSnapshotJson,
  };
}
