import assert from "node:assert/strict";
import test from "node:test";
import { billableRentalDays, validateDurationTiers, matchDurationTier, savedDurationTierLabel } from "@/lib/bookings/durationPricing";
import { computeQuotePrice, normalizeRulesRow, type VehiclePricingProfile } from "@/lib/bookings/pricingRules";
import { pricingFingerprint } from "@/lib/bookings/pricingFingerprint";
import { bookingDateTimeToUtcIso } from "@/lib/bookings/bookingDateTime";
import { computeBookingPricingFromStoredSnapshot } from "@/lib/payments/pricing";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DurationRates } from "@/components/booking/DurationRates";

const tiers = validateDurationTiers([
  { minDays: 8, maxDays: null, dailyRateJmd: 10000 },
  { minDays: 2, maxDays: 3, dailyRateJmd: 3000 },
  { minDays: 4, maxDays: 7, dailyRateJmd: 5000 },
]);
function profile(): VehiclePricingProfile {
  return { vehicleId: "v", vehicleLabel: "Test", vehicleClass: null, defaultsApplied: false,
    defaultDailyRateCents: 7000, defaultDepositCents: 20000,
    rules: { ...normalizeRulesRow("v", null), durationPricingEnabled: true, durationTiers: tiers },
  };
}
function quote(days: number, p = profile()) {
  return computeQuotePrice({ profile: p, startAt: "2026-09-12T16:00:00Z", endAt: new Date(Date.parse("2026-09-12T16:00:00Z") + days * 86400000) });
}
test("duration tiers select inclusive boundaries and apply one rate to every day", () => {
  for (const [days, total] of [[1,7000],[2,6000],[3,9000],[4,20000],[7,35000],[8,80000],[10,100000]]) {
    assert.equal(quote(days).baseTotalCents, total);
  }
  assert.equal(matchDurationTier(tiers, 3)?.dailyRateJmd, 3000);
  assert.equal(savedDurationTierLabel(tiers[0]), "2-3 days");
});
test("exact durations, gaps, and disabled schedules preserve fallback", () => {
  const p = profile();
  p.rules.durationTiers = [{ minDays: 3, maxDays: 3, dailyRateJmd: 1000 }];
  assert.equal(quote(3, p).baseTotalCents, 3000);
  assert.equal(quote(2, p).baseTotalCents, 14000);
  p.rules.durationPricingEnabled = false;
  assert.equal(quote(3, p).baseTotalCents, 21000);
  p.rules.durationPricingEnabled = true;
  p.rules.isActive = false;
  assert.equal(quote(3, p).baseTotalCents, 21000);
});
test("duration validation rejects malformed, fractional, overlapping and unbounded overlaps", () => {
  for (const entry of [{minDays:0,maxDays:3,dailyRateJmd:1},{minDays:2.5,maxDays:3,dailyRateJmd:1},
    {minDays:3,maxDays:2,dailyRateJmd:1},{minDays:2,maxDays:3,dailyRateJmd:1.5},
    {minDays:2,maxDays:3,dailyRateJmd:0},{minDays:2,maxDays:3,dailyRateJmd:"3000"}]) {
    assert.throws(() => validateDurationTiers([entry]));
  }
  assert.throws(() => validateDurationTiers([tiers[0], tiers[0]]));
  assert.throws(() => validateDurationTiers([{minDays:1,maxDays:null,dailyRateJmd:1},tiers[0]]));
  assert.throws(() => validateDurationTiers([{minDays:1,maxDays:2,dailyRateJmd:1},tiers[0]]));
  assert.equal(validateDurationTiers([{minDays:1,maxDays:1,dailyRateJmd:9999},tiers[0]]).length, 2);
});
test("Jamaica pickup times use started 24-hour periods", () => {
  const start = bookingDateTimeToUtcIso("2026-09-12", "11:00")!;
  assert.equal(start, "2026-09-12T16:00:00.000Z");
  assert.equal(billableRentalDays(start, bookingDateTimeToUtcIso("2026-09-14", "11:00")!), 2);
  assert.equal(billableRentalDays(start, bookingDateTimeToUtcIso("2026-09-14", "12:00")!), 3);
  assert.equal(quote(49/24).baseTotalCents, 9000);
});
test("tier overrides daily seasonal/weekend rates but not fees, insurance, promo or deposit rules", () => {
  const p = profile();
  p.rules.weekendDailyRateCents = 40000;
  p.rules.dateRangeOverrides = [{start:"2026-09-12",end:"2026-09-15",dailyRateCents:50000,depositCents:4000}];
  p.rules.deliveryEnabled = true;
  p.rules.deliveryFeeCents = 700;
  const q = computeQuotePrice({profile:p,startAt:"2026-09-12T16:00:00Z",endAt:"2026-09-15T16:00:00Z",insuranceSelected:true,insurancePricePerDayCents:500,deliverySelected:true,promoDiscountCents:1000});
  assert.equal(q.baseTotalCents,9000);
  assert.equal(q.insuranceTotalCents,1500);
  assert.equal(q.totalCents,10200);
  assert.equal(q.depositRequiredCents,4000);
  assert.ok(q.rateBreakdown.every(day => day.source === "duration_tier"));
  assert.equal(quote(2).depositRequiredCents,6000);
  p.rules.durationTiers = [];
  assert.equal(quote(1,p).baseTotalCents,50000);
});
test("fingerprints change with agreed price but ignore ledger updates; snapshots protect historical totals", () => {
  const q = quote(3);
  const before = pricingFingerprint(q.pricingSnapshotJson);
  assert.equal(pricingFingerprint({...q.pricingSnapshotJson,paid_to_date:1000}),before);
  assert.notEqual(pricingFingerprint({...q.pricingSnapshotJson,total_cents:9500}),before);
  const stored = computeBookingPricingFromStoredSnapshot({bookingId:"b",bookingStatus:"CONFIRMED",startDate:"2026-09-12",endDate:"2026-09-15",pricing:q.pricingSnapshotJson,fallbackDailyRate:100000,fallbackDeposit:100000,netPaidToDate:1000});
  assert.equal(stored.total,9000);
  assert.equal(stored.balanceDue,8000);
});
test("all three offers render with conditions, fallback and automatic matching", () => {
  const html = renderToStaticMarkup(createElement(DurationRates, {tiers, standardRate:7000,days:3}));
  for (const label of ["2–3 days","4–7 days","8+ days","Your rate","standard rate"]) assert.ok(html.includes(label),label);
});
