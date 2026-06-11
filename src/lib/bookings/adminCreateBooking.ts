import { dbQuery } from "@/lib/db";
import { type OverlapWindowInput, listAvailableVehiclesEntitlementBased } from "@/lib/availability/entitlement";
import { calcRentalDays } from "@/lib/payments/dateMath";
import { isISODate } from "@/lib/validators";
import type { Queryable } from "@/lib/payments/pricing";

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
  subtotalCents: number;
  promoDiscountCents: number;
  totalCents: number;
  depositRequiredCents: number;
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

  const startAt = new Date(`${startDate}T00:00:00.000Z`);
  const endAt = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;

  if (endAt <= startAt) return null;

  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
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
    subtotalCents,
    promoDiscountCents: normalizedPromoDiscount,
    totalCents,
    depositRequiredCents: normalizedDeposit,
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
  options: { client?: Queryable } = {},
): Promise<AdminCreateBookingPricingPreview | null> {
  const vehicle = await getAdminCreateBookingVehicleById(vehicleId, options);
  if (!vehicle) return null;

  return computeAdminCreateBookingPricingPreview({
    dailyRateCents: vehicle.dailyRateCents,
    depositCents: vehicle.depositCents,
    startDate,
    endDate,
  });
}
