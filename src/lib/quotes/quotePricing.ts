import { dbQuery } from "@/lib/db";
import { computeBookingPricing } from "@/lib/payments/pricing";
import { normalizePromoInputCode, validatePromoForBooking } from "@/lib/promos";

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
};

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  deposit_cents: number;
  features_json: unknown;
};

type InsurancePlanRow = {
  id: string;
  vehicle_id: string | null;
  is_enabled: boolean;
  price_per_day_cents: number;
  is_global_default: boolean;
};

export class QuotePricingError extends Error {
  code:
    | "INVALID_WINDOW"
    | "VEHICLE_NOT_FOUND"
    | "INSURANCE_UNAVAILABLE"
    | "INSURANCE_PLAN_INVALID"
    | "PROMO_INVALID";
  status: number;

  constructor(
    code:
      | "INVALID_WINDOW"
      | "VEHICLE_NOT_FOUND"
      | "INSURANCE_UNAVAILABLE"
      | "INSURANCE_PLAN_INVALID"
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
};

export type QuotePricingSnapshot = {
  vehicleLabel: string;
  vehicleClass: string | null;
  insuranceEnabled: boolean;
  insurancePlanId: string | null;
  promoCode: string | null;
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

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveVehicleClass(featuresJson: unknown) {
  const features = toRecord(featuresJson);
  const category = normalizeOptionalText(features.category);
  if (category) return category;
  const className = normalizeOptionalText(features.class);
  if (className) return className;
  return null;
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

  throw new QuotePricingError(
    "INSURANCE_UNAVAILABLE",
    "Insurance is unavailable for the selected vehicle.",
    400,
  );
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

  const vehicleResult = await db.query(
    "select id, make, model, year, daily_rate_cents, deposit_cents, features_json from vehicles where id = $1 and status <> 'INACTIVE' limit 1",
    [input.vehicleId],
  );
  if (vehicleResult.rowCount < 1) {
    throw new QuotePricingError("VEHICLE_NOT_FOUND", "Vehicle not found.", 404);
  }

  const vehicle = vehicleResult.rows[0] as VehicleRow;
  const insurance = await resolveInsurancePlan({
    db,
    vehicleId: vehicle.id,
    insuranceEnabled: input.insuranceEnabled === true,
    insurancePlanId: input.insurancePlanId,
  });

  const vehicleLabel = `${String(vehicle.make ?? "").trim()} ${String(vehicle.model ?? "").trim()}`.trim();
  const vehicleClass = resolveVehicleClass(vehicle.features_json);
  const dailyRateCents = Math.max(0, toInteger(vehicle.daily_rate_cents));
  const depositCents = Math.max(0, toInteger(vehicle.deposit_cents));

  const baseSummary = computeBookingPricing({
    bookingId: "quote-pricing",
    bookingStatus: "DRAFT",
    startAt,
    endAt,
    dailyRate: dailyRateCents,
    deposit: depositCents,
    paymentOption: "DEPOSIT",
    netPaidToDate: 0,
    insuranceSelected: insurance.insuranceEnabled,
    insurancePricePerDay: insurance.insurancePricePerDayCents,
    promoCode: null,
    promoDiscount: 0,
  });

  const promoCodeInput = normalizePromoInputCode(String(input.promoCode ?? ""));
  let promoCode: string | null = null;
  let promoDiscountCents = 0;

  if (promoCodeInput) {
    const promoValidation = await validatePromoForBooking({
      code: promoCodeInput,
      vehicleId: input.vehicleId,
      startDate: toDateKey(startAt),
      endDate: toDateKey(endAt),
      subtotalCents: baseSummary.subtotal,
      customerEmail: normalizeOptionalText(input.customerEmail)?.toLowerCase() ?? null,
      client: db,
    });

    if (!promoValidation.ok) {
      throw new QuotePricingError("PROMO_INVALID", promoValidation.message, 400);
    }

    promoCode = promoValidation.code;
    promoDiscountCents = promoValidation.discountAmountCents;
  }

  const summary = computeBookingPricing({
    bookingId: "quote-pricing",
    bookingStatus: "DRAFT",
    startAt,
    endAt,
    dailyRate: dailyRateCents,
    deposit: depositCents,
    paymentOption: "DEPOSIT",
    netPaidToDate: 0,
    insuranceSelected: insurance.insuranceEnabled,
    insurancePricePerDay: insurance.insurancePricePerDayCents,
    promoCode,
    promoDiscount: promoDiscountCents,
  });

  const rackPriceFallback = Math.max(0, toInteger(input.rackPriceCents, baseSummary.baseTotal));
  const rackPriceCents = input.rackPriceCents == null ? baseSummary.baseTotal : rackPriceFallback;

  const pricingJson: Record<string, unknown> = {
    booking_id: summary.bookingId,
    booking_status: summary.bookingStatus,
    start_date: summary.startDate,
    end_date: summary.endDate,
    days: summary.days,
    currency: "JMD",
    daily_rate_cents: summary.dailyRate,
    base_total_cents: summary.baseTotal,
    insurance_selected: summary.insuranceSelected,
    insurance_plan_id: insurance.insurancePlanId,
    insurance_price_per_day_cents: summary.insurancePricePerDay,
    insurance_total_cents: summary.insuranceTotal,
    promo_code: summary.promoCode,
    promo_discount_cents: summary.promoDiscount,
    discount_total_cents: summary.discountTotal,
    subtotal_cents: summary.subtotal,
    total_cents: summary.total,
    total_amount: summary.total,
    amount_due_cents: summary.amountDue,
    amount_due: summary.amountDue,
    deposit_required_cents: summary.depositRequired,
    deposit_cents: summary.deposit,
    amount_paid: summary.netPaidToDate,
    paid_to_date: summary.netPaidToDate,
    balance_due_cents: summary.balanceDue,
    balance_due: summary.balanceDue,
    payment_option_selected: summary.paymentOption,
    payment_status: summary.paymentStatus,
    refund_required: summary.refundRequired,
    rack_price_cents: rackPriceCents,
  };

  return {
    vehicleLabel,
    vehicleClass,
    insuranceEnabled: insurance.insuranceEnabled,
    insurancePlanId: insurance.insurancePlanId,
    promoCode: summary.promoCode,
    rackPriceCents,
    pricingJson,
    summary: {
      baseTotalCents: summary.baseTotal,
      insuranceTotalCents: summary.insuranceTotal,
      discountTotalCents: summary.discountTotal,
      subtotalCents: summary.subtotal,
      totalCents: summary.total,
      depositRequiredCents: summary.depositRequired,
      amountDueCents: summary.amountDue,
    },
  };
}
