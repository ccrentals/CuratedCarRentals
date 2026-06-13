import { dbQuery } from "@/lib/db";
import { type OverlapWindowInput, listAvailableVehiclesEntitlementBased } from "@/lib/availability/entitlement";
import { calcRentalDays } from "@/lib/payments/dateMath";
import { isISODate } from "@/lib/validators";
import type { Queryable } from "@/lib/payments/pricing";
import { bookingDateTimeToUtcIso } from "@/lib/bookings/bookingDateTime";
import {
  buildQuotePricingSnapshot,
  type QuotePricingSnapshot,
} from "@/lib/quotes/quotePricing";

type AdminCreateBookingVehicleRow = {
  id: string;
  year: number;
  make: string;
  model: string;
  daily_rate_cents: number;
  deposit_cents: number;
};

export type AdminCreateBookingVehicleOption = {
  id: string;
  year: number;
  make: string;
  model: string;
  dailyRateCents: number;
  depositCents: number;
  label: string;
};

export type AdminCreateBookingPricingPreview = {
  days: number;
  dailyRateCents: number;
  baseTotalCents: number;
  insuranceSelected: boolean;
  insurancePlanId: string | null;
  insurancePricePerDayCents: number;
  insuranceTotalCents: number;
  subtotalCents: number;
  promoCode: string | null;
  promoDiscountCents: number;
  totalCents: number;
  depositRequiredCents: number;
  amountDueCents: number;
  dueNowCents: number;
  balanceDueCents: number;
  rateBreakdown: Array<{
    date: string;
    dailyRateCents: number;
    source: "base" | "weekend" | "date_override";
  }>;
  currency: "JMD";
};

export function adminCreateBookingVehicleWhereSql(alias?: string) {
  const prefix = alias && alias.trim().length > 0 ? `${alias.trim()}.` : "";
  return `${prefix}deleted_at is null and upper(coalesce(${prefix}status, '')) not in ('INACTIVE', 'UNAVAILABLE', 'MAINTENANCE')`;
}

function getQueryable(client?: Queryable) {
  if (client) return client;
  return {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };
}

function mapVehicleOption(vehicle: AdminCreateBookingVehicleRow): AdminCreateBookingVehicleOption {
  return {
    id: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    dailyRateCents: Math.max(0, Number(vehicle.daily_rate_cents || 0)),
    depositCents: Math.max(0, Number(vehicle.deposit_cents || 0)),
    label: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
  };
}

export async function getAdminCreateBookingVehicleById(
  vehicleId: string,
  options: { client?: Queryable } = {},
): Promise<AdminCreateBookingVehicleOption | null> {
  const db = getQueryable(options.client);
  const vehicleResult = (await db.query(
    `select id, year, make, model, daily_rate_cents, deposit_cents
       from vehicles
      where id = $1
        and ${adminCreateBookingVehicleWhereSql()}
      limit 1`,
    [vehicleId],
  )) as { rows: AdminCreateBookingVehicleRow[]; rowCount: number };

  const vehicle = vehicleResult.rows[0];
  return vehicle ? mapVehicleOption(vehicle) : null;
}

export function buildAdminCreateBookingWindow(
  startDate: string,
  endDate: string,
): OverlapWindowInput | null {
  if (!isISODate(startDate) || !isISODate(endDate)) return null;

  const startAt = bookingDateTimeToUtcIso(startDate, "11:00");
  const endAt = bookingDateTimeToUtcIso(endDate, "11:00");
  if (!startAt || !endAt || endAt <= startAt) return null;

  return {
    startAt,
    endAt,
  };
}

export function computeAdminCreateBookingPricingPreview(input: {
  dailyRateCents: number;
  depositCents: number;
  startDate: string;
  endDate: string;
  promoDiscountCents?: number;
}): AdminCreateBookingPricingPreview | null {
  const { dailyRateCents, depositCents, startDate, endDate, promoDiscountCents = 0 } = input;
  const days = calcRentalDays(startDate, endDate);
  if (days <= 0) return null;

  const normalizedDailyRate = Math.max(0, Math.round(Number(dailyRateCents || 0)));
  const normalizedDeposit = Math.max(0, Math.round(Number(depositCents || 0)));
  const normalizedPromoDiscount = Math.max(0, Math.round(Number(promoDiscountCents || 0)));

  const subtotalCents = normalizedDailyRate * days;
  const totalCents = Math.max(0, subtotalCents - normalizedPromoDiscount);

  return {
    days,
    dailyRateCents: normalizedDailyRate,
    baseTotalCents: subtotalCents,
    insuranceSelected: false,
    insurancePlanId: null,
    insurancePricePerDayCents: 0,
    insuranceTotalCents: 0,
    subtotalCents,
    promoCode: null,
    promoDiscountCents: normalizedPromoDiscount,
    totalCents,
    depositRequiredCents: normalizedDeposit,
    amountDueCents: totalCents,
    dueNowCents: Math.min(totalCents, normalizedDeposit),
    balanceDueCents: Math.max(0, totalCents - normalizedDeposit),
    rateBreakdown: [],
    currency: "JMD",
  };
}

function mapQuoteSnapshotToAdminPreview(
  snapshot: QuotePricingSnapshot,
): AdminCreateBookingPricingPreview {
  const pricing = snapshot.pricingJson;
  const days = Math.max(0, Number(pricing.days ?? 0));
  const dailyRateCents = Math.max(0, Number(pricing.daily_rate_cents ?? 0));
  const insurancePricePerDayCents = Math.max(
    0,
    Number(pricing.insurance_price_per_day_cents ?? 0),
  );
  const rateBreakdown = Array.isArray(pricing.rate_breakdown)
    ? pricing.rate_breakdown.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const value = entry as Record<string, unknown>;
        const source = value.source;
        if (
          typeof value.date !== "string" ||
          !["base", "weekend", "date_override"].includes(String(source))
        ) {
          return [];
        }
        return [{
          date: value.date,
          dailyRateCents: Math.max(0, Number(value.dailyRateCents ?? value.daily_rate_cents ?? 0)),
          source: source as "base" | "weekend" | "date_override",
        }];
      })
    : [];
  const dueNowCents = Math.min(
    snapshot.summary.amountDueCents,
    snapshot.summary.depositRequiredCents,
  );

  return {
    days,
    dailyRateCents,
    baseTotalCents: snapshot.summary.baseTotalCents,
    insuranceSelected: snapshot.insuranceEnabled,
    insurancePlanId: snapshot.insurancePlanId,
    insurancePricePerDayCents,
    insuranceTotalCents: snapshot.summary.insuranceTotalCents,
    subtotalCents: snapshot.summary.subtotalCents,
    promoCode: snapshot.promoCode,
    promoDiscountCents: snapshot.summary.discountTotalCents,
    totalCents: snapshot.summary.totalCents,
    depositRequiredCents: snapshot.summary.depositRequiredCents,
    amountDueCents: snapshot.summary.amountDueCents,
    dueNowCents,
    balanceDueCents: Math.max(0, snapshot.summary.amountDueCents - dueNowCents),
    rateBreakdown,
    currency: "JMD",
  };
}

export async function listAdminCreateBookingAvailableVehicles(
  startDate: string,
  endDate: string,
  options: { client?: Queryable } = {},
): Promise<AdminCreateBookingVehicleOption[]> {
  const window = buildAdminCreateBookingWindow(startDate, endDate);
  if (!window) return [];

  const db = getQueryable(options.client);
  const result = (await db.query(
    `select id, year, make, model, daily_rate_cents, deposit_cents
       from vehicles
      where ${adminCreateBookingVehicleWhereSql()}
      order by year desc, make asc, model asc`,
  )) as { rows: AdminCreateBookingVehicleRow[]; rowCount: number };

  const vehicles = result.rows.map(mapVehicleOption);
  const availableVehicles = await listAvailableVehiclesEntitlementBased(vehicles, window, {
    client: db,
  });

  return availableVehicles;
}

export async function getAdminCreateBookingPricingPreview(
  vehicleId: string,
  startDate: string,
  endDate: string,
  input: {
    insuranceSelected?: boolean;
    insurancePlanId?: string | null;
    promoCode?: string | null;
    customerId?: string | null;
    customerEmail?: string | null;
  } = {},
  options: { client?: Queryable } = {},
): Promise<AdminCreateBookingPricingPreview | null> {
  const window = buildAdminCreateBookingWindow(startDate, endDate);
  if (!window) return null;
  const vehicle = await getAdminCreateBookingVehicleById(vehicleId, options);
  if (!vehicle) return null;

  const snapshot = await buildQuotePricingSnapshot(
    {
      vehicleId,
      startAt: window.startAt,
      endAt: window.endAt,
      insuranceEnabled: input.insuranceSelected === true,
      insurancePlanId: input.insurancePlanId,
      promoCode: input.promoCode,
      customerId: input.customerId,
      customerEmail: input.customerEmail,
    },
    options,
  );

  return mapQuoteSnapshotToAdminPreview(snapshot);
}
