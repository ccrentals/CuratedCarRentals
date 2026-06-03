import { dbQuery } from "@/lib/db";
import {
  normalizeAdminSettingsValue,
  resolveMinimumRentalDaysForVehicle,
} from "@/lib/adminSettings";
import { computeQuotePrice, getVehiclePricingProfile } from "@/lib/bookings/pricingRules";
import { validateMinimumRentalDays } from "@/lib/bookings/minimumRentalDays";
import { normalizePromoInputCode, validatePromoForBooking } from "@/lib/promos";

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
};

type InsurancePlanRow = {
  id: string;
  vehicle_id: string | null;
  is_enabled: boolean;
  price_per_day_cents: number;
  is_global_default: boolean;
};

type SettingsRow = {
  content: string | null;
};

export class QuotePricingError extends Error {
  code:
    | "INVALID_WINDOW"
    | "VEHICLE_NOT_FOUND"
    | "INSURANCE_UNAVAILABLE"
    | "INSURANCE_PLAN_INVALID"
    | "MINIMUM_RENTAL_DAYS"
    | "PROMO_INVALID";
  status: number;

  constructor(
    code:
      | "INVALID_WINDOW"
      | "VEHICLE_NOT_FOUND"
      | "INSURANCE_UNAVAILABLE"
      | "INSURANCE_PLAN_INVALID"
      | "MINIMUM_RENTAL_DAYS"
      | "PROMO_INVALID",
    message: string,
    status: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type QuotePricingInput = {
  vehicleId: string;
  startAt: string | Date;
  endAt: string | Date;
  insuranceEnabled?: boolean;
  insurancePlanId?: string | null;
  promoCode?: string | null;
  customerEmail?: string | null;
  rackPriceCents?: number | null;
  deliverySelected?: boolean;
  deliveryZoneLabel?: string | null;
};

export type QuotePricingSnapshot = {
  vehicleLabel: string;
  vehicleClass: string | null;
  insuranceEnabled: boolean;
  insurancePlanId: string | null;
  promoCode: string | null;
  promoId: string | null;
  rackPriceCents: number;
  pricingJson: Record<string, unknown>;
  summary: {
    baseTotalCents: number;
    insuranceTotalCents: number;
    discountTotalCents: number;
    subtotalCents: number;
    totalCents: number;
    depositRequiredCents: number;
    amountDueCents: number;
  };
};

function getQueryable(client?: Queryable): Queryable {
  if (client) return client;
  return {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };
}

function toDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(String(value ?? ""));
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function toInteger(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(numeric);
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveInsurancePlan(input: {
  db: Queryable;
  vehicleId: string;
  insuranceEnabled: boolean;
  insurancePlanId?: string | null;
}) {
  if (!input.insuranceEnabled) {
    return {
      insuranceEnabled: false,
      insurancePlanId: null,
      insurancePricePerDayCents: 0,
    };
  }

  if (input.insurancePlanId) {
    const explicitPlan = await input.db.query(
      "select id, vehicle_id, is_enabled, price_per_day_cents, is_global_default from insurance_plans where id = $1 limit 1",
      [input.insurancePlanId],
    );
    if (explicitPlan.rowCount < 1) {
      throw new QuotePricingError(
        "INSURANCE_PLAN_INVALID",
        "Selected insurance plan was not found.",
        400,
      );
    }

    const plan = explicitPlan.rows[0] as InsurancePlanRow;
    const allowedVehicle = plan.vehicle_id === null || plan.vehicle_id === input.vehicleId;
    if (!plan.is_enabled || !allowedVehicle) {
      throw new QuotePricingError(
        "INSURANCE_PLAN_INVALID",
        "Selected insurance plan is not valid for this vehicle.",
        400,
      );
    }

    return {
      insuranceEnabled: true,
      insurancePlanId: plan.id,
      insurancePricePerDayCents: Math.max(0, toInteger(plan.price_per_day_cents)),
    };
  }

  const globalPlanResult = await input.db.query(
    "select id, vehicle_id, is_enabled, price_per_day_cents, is_global_default from insurance_plans where is_global_default = true and is_enabled = true limit 1",
  );
  if (globalPlanResult.rowCount > 0) {
    const plan = globalPlanResult.rows[0] as InsurancePlanRow;
    return {
      insuranceEnabled: true,
      insurancePlanId: plan.id,
      insurancePricePerDayCents: Math.max(0, toInteger(plan.price_per_day_cents)),
    };
  }

  const vehiclePlanResult = await input.db.query(
    "select id, vehicle_id, is_enabled, price_per_day_cents, is_global_default from insurance_plans where vehicle_id = $1 and is_enabled = true limit 1",
    [input.vehicleId],
  );
  if (vehiclePlanResult.rowCount > 0) {
    const plan = vehiclePlanResult.rows[0] as InsurancePlanRow;
    return {
      insuranceEnabled: true,
      insurancePlanId: plan.id,
      insurancePricePerDayCents: Math.max(0, toInteger(plan.price_per_day_cents)),
    };
  }

  throw new QuotePricingError(
    "INSURANCE_UNAVAILABLE",
    "Insurance is unavailable for the selected vehicle.",
    400,
  );
}

async function resolveMinimumRentalDays(input: {
  db: Queryable;
  vehicleId: string;
}) {
  const result = await input.db.query(
    "select content from admin_documents where key = 'settings' limit 1",
  );
  const content = (result.rows[0] as SettingsRow | undefined)?.content;
  let parsedSettings: unknown = {};
  if (typeof content === "string" && content.trim()) {
    try {
      parsedSettings = JSON.parse(content);
    } catch {
      parsedSettings = {};
    }
  }
  const settings = normalizeAdminSettingsValue(parsedSettings);
  return resolveMinimumRentalDaysForVehicle(settings, input.vehicleId);
}

export async function buildQuotePricingSnapshot(
  input: QuotePricingInput,
  options: { client?: Queryable } = {},
): Promise<QuotePricingSnapshot> {
  const db = getQueryable(options.client);

  const startAt = toDate(input.startAt);
  const endAt = toDate(input.endAt);
  if (!startAt || !endAt || endAt <= startAt) {
    throw new QuotePricingError(
      "INVALID_WINDOW",
      "Return date and time must be later than pickup date and time.",
      400,
    );
  }

  const pricingProfile = await getVehiclePricingProfile(input.vehicleId, { client: db });
  if (!pricingProfile) {
    throw new QuotePricingError("VEHICLE_NOT_FOUND", "Vehicle not found.", 404);
  }

  const minimumDays = await resolveMinimumRentalDays({ db, vehicleId: input.vehicleId });
  const minimumValidation = validateMinimumRentalDays({
    start: startAt,
    end: endAt,
    minimumDays,
  });
  if (!minimumValidation.ok) {
    throw new QuotePricingError(
      "MINIMUM_RENTAL_DAYS",
      minimumValidation.message ?? "Selected rental window is too short.",
      400,
    );
  }

  const insurance = await resolveInsurancePlan({
    db,
    vehicleId: input.vehicleId,
    insuranceEnabled: input.insuranceEnabled === true,
    insurancePlanId: input.insurancePlanId,
  });

  const baseComputed = computeQuotePrice({
    profile: pricingProfile,
    startAt,
    endAt,
    insuranceSelected: insurance.insuranceEnabled,
    insurancePricePerDayCents: insurance.insurancePricePerDayCents,
    promoCode: null,
    promoDiscountCents: 0,
    deliverySelected: input.deliverySelected === true,
    deliveryZoneLabel: input.deliveryZoneLabel,
  });

  const promoCodeInput = normalizePromoInputCode(String(input.promoCode ?? ""));
  let promoCode: string | null = null;
  let promoId: string | null = null;
  let promoDiscountCents = 0;

  if (promoCodeInput) {
    const promoValidation = await validatePromoForBooking({
      code: promoCodeInput,
      vehicleId: input.vehicleId,
      startDate: toDateKey(startAt),
      endDate: toDateKey(endAt),
      subtotalCents: baseComputed.subtotalCents,
      baseTotalCents: baseComputed.baseTotalCents,
      customerEmail: normalizeOptionalText(input.customerEmail)?.toLowerCase() ?? null,
      client: db,
    });

    if (!promoValidation.ok) {
      throw new QuotePricingError("PROMO_INVALID", promoValidation.message, 400);
    }

    promoCode = promoValidation.code;
    promoId = promoValidation.promoId;
    promoDiscountCents = promoValidation.discountAmountCents;
  }

  const computed = computeQuotePrice({
    profile: pricingProfile,
    startAt,
    endAt,
    insuranceSelected: insurance.insuranceEnabled,
    insurancePricePerDayCents: insurance.insurancePricePerDayCents,
    promoCode,
    promoDiscountCents,
    deliverySelected: input.deliverySelected === true,
    deliveryZoneLabel: input.deliveryZoneLabel,
  });

  const rackPriceFallback = Math.max(0, toInteger(input.rackPriceCents, computed.baseTotalCents));
  const rackPriceCents = input.rackPriceCents == null ? computed.baseTotalCents : rackPriceFallback;

  const pricingJson: Record<string, unknown> = {
    ...computed.pricingSnapshotJson,
    insurance_plan_id: insurance.insurancePlanId,
    rack_price_cents: rackPriceCents,
    vehicle_label: pricingProfile.vehicleLabel,
    vehicle_class: pricingProfile.vehicleClass,
    delivery_selected: computed.deliverySelected,
    delivery_zone_label: computed.deliveryZoneLabel,
    delivery_fee_cents: computed.deliveryFeeCents,
    extra_fees_cents: computed.extraFeesTotalCents,
    discount_total_cents: computed.discountTotalCents,
    subtotal_cents: computed.subtotalCents,
    total_cents: computed.totalCents,
    amount_due_cents: computed.amountDueCents,
    deposit_required_cents: computed.depositRequiredCents,
    currency: computed.currency,
  };

  return {
    vehicleLabel: pricingProfile.vehicleLabel,
    vehicleClass: pricingProfile.vehicleClass,
    insuranceEnabled: insurance.insuranceEnabled,
    insurancePlanId: insurance.insurancePlanId,
    promoCode,
    promoId,
    rackPriceCents,
    pricingJson,
    summary: {
      baseTotalCents: computed.baseTotalCents,
      insuranceTotalCents: computed.insuranceTotalCents,
      discountTotalCents: computed.discountTotalCents,
      subtotalCents: computed.subtotalCents,
      totalCents: computed.totalCents,
      depositRequiredCents: computed.depositRequiredCents,
      amountDueCents: computed.amountDueCents,
    },
  };
}
