import assert from "node:assert/strict";
import test from "node:test";

import { computeQuotePrice, type VehiclePricingProfile } from "@/lib/bookings/pricingRules";

function buildProfile(overrides: Partial<VehiclePricingProfile["rules"]> = {}): VehiclePricingProfile {
  return {
    vehicleId: "11111111-1111-4111-8111-111111111111",
    vehicleLabel: "Test Vehicle",
    vehicleClass: "SUV",
    defaultDailyRateCents: 10000,
    defaultDepositCents: 200000,
    defaultsApplied: false,
    rules: {
      id: "22222222-2222-4222-8222-222222222222",
      vehicleId: "11111111-1111-4111-8111-111111111111",
      baseDailyRateCents: null,
      baseDepositCents: null,
      weekendDailyRateCents: null,
      dateRangeOverrides: [],
      deliveryEnabled: false,
      deliveryFeeCents: 0,
      deliveryZones: [],
      currency: "JMD",
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    },
  };
}

test("pricing rules: base rate/deposit overrides apply", () => {
  const profile = buildProfile({
    baseDailyRateCents: 12500,
    baseDepositCents: 260000,
  });

  const result = computeQuotePrice({
    profile,
    startAt: "2026-03-02T10:00:00.000Z",
    endAt: "2026-03-03T10:00:00.000Z",
    insuranceSelected: false,
    insurancePricePerDayCents: 0,
  });

  assert.equal(result.days, 1);
  assert.equal(result.baseTotalCents, 12500);
  assert.equal(result.depositRequiredCents, 260000);
  assert.equal(result.totalCents, 12500);
});

test("pricing rules: weekend override applies to occupied weekend days", () => {
  const profile = buildProfile({
    baseDailyRateCents: 10000,
    weekendDailyRateCents: 15000,
  });

  const result = computeQuotePrice({
    profile,
    startAt: "2026-03-06T12:00:00.000Z",
    endAt: "2026-03-08T12:00:00.000Z",
    insuranceSelected: false,
    insurancePricePerDayCents: 0,
  });

  assert.equal(result.days, 2);
  assert.equal(result.baseTotalCents, 25000);
  assert.equal(result.rateBreakdown[0]?.source, "base");
  assert.equal(result.rateBreakdown[1]?.source, "weekend");
});

test("pricing rules: date override has highest precedence", () => {
  const profile = buildProfile({
    baseDailyRateCents: 10000,
    weekendDailyRateCents: 15000,
    dateRangeOverrides: [
      {
        start: "2026-03-08",
        end: "2026-03-08",
        dailyRateCents: 22000,
        depositCents: 280000,
      },
    ],
  });

  const result = computeQuotePrice({
    profile,
    startAt: "2026-03-08T08:00:00.000Z",
    endAt: "2026-03-08T20:00:00.000Z",
    insuranceSelected: false,
    insurancePricePerDayCents: 0,
  });

  assert.equal(result.days, 1);
  assert.equal(result.baseTotalCents, 22000);
  assert.equal(result.depositRequiredCents, 280000);
  assert.equal(result.rateBreakdown[0]?.source, "date_override");
});

test("pricing rules: delivery fee uses matching zone when delivery selected", () => {
  const profile = buildProfile({
    deliveryEnabled: true,
    deliveryFeeCents: 3000,
    deliveryZones: [
      { label: "Montego Bay", feeCents: 4500 },
      { label: "Airport", feeCents: 5500 },
    ],
  });

  const result = computeQuotePrice({
    profile,
    startAt: "2026-03-10T09:00:00.000Z",
    endAt: "2026-03-11T09:00:00.000Z",
    insuranceSelected: false,
    insurancePricePerDayCents: 0,
    deliverySelected: true,
    deliveryZoneLabel: "airport",
  });

  assert.equal(result.baseTotalCents, 10000);
  assert.equal(result.deliveryFeeCents, 5500);
  assert.equal(result.extraFeesTotalCents, 5500);
  assert.equal(result.totalCents, 15500);
});

test("pricing rules: pricing snapshot contains stable keys", () => {
  const profile = buildProfile({
    baseDailyRateCents: 11000,
    deliveryEnabled: true,
    deliveryFeeCents: 2000,
  });

  const result = computeQuotePrice({
    profile,
    startAt: "2026-04-01T10:00:00.000Z",
    endAt: "2026-04-02T10:00:00.000Z",
    insuranceSelected: true,
    insurancePricePerDayCents: 1000,
    deliverySelected: true,
    promoCode: "SAVE10",
    promoDiscountCents: 1500,
  });

  const snapshot = result.pricingSnapshotJson as Record<string, unknown>;
  assert.ok(Array.isArray(snapshot.rate_breakdown));
  assert.equal(snapshot.delivery_fee_cents, 2000);
  assert.equal(snapshot.insurance_total_cents, 1000);
  assert.equal(snapshot.promo_discount_cents, 1500);
  assert.equal(snapshot.total_cents, result.totalCents);
});
