/** Booking prices are whole JMD amounts, not minor currency units. */
export type DurationTier = { minDays: number; maxDays: number | null; dailyRateJmd: number };

export function validateDurationTiers(value: unknown): DurationTier[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error("Enter at most 64 duration ranges.");
  const tiers = value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid duration range.");
    const { minDays, maxDays, dailyRateJmd } = entry as DurationTier;
    if (!Number.isSafeInteger(minDays) || minDays < 1 || minDays > 36500 ||
        (maxDays !== null && (!Number.isSafeInteger(maxDays) || maxDays < minDays || maxDays > 36500))) {
      throw new Error("Day ranges must use whole days from 1 to 36,500, with maximum at least minimum.");
    }
    if (!Number.isSafeInteger(dailyRateJmd) || dailyRateJmd <= 0 || dailyRateJmd > 2147483647) {
      throw new Error("Daily rate must be a positive whole JMD amount within the supported amount limit.");
    }
    return { minDays, maxDays, dailyRateJmd };
  }).sort((a, b) => a.minDays - b.minDays);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minDays <= (tiers[i - 1].maxDays ?? Infinity)) throw new Error("Duration ranges cannot overlap.");
  }
  return tiers;
}

export function matchDurationTier(tiers: DurationTier[], days: number) {
  return tiers.find(tier => days >= tier.minDays && (tier.maxDays === null || days <= tier.maxDays)) ?? null;
}

export function durationTierLabel(tier: DurationTier) {
  if (tier.maxDays === null) return `${tier.minDays}+ days`;
  if (tier.minDays === tier.maxDays) return `${tier.minDays} ${tier.minDays === 1 ? "day" : "days"}`;
  return `${tier.minDays}–${tier.maxDays} days`;
}

export function billableRentalDays(start: string | Date, end: string | Date) {
  const duration = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(duration) && duration > 0 ? Math.ceil(duration / 86400000) : 0;
}

export function savedDurationTierLabel(value: unknown) {
  if (!value) return "";
  try { return durationTierLabel(validateDurationTiers([value])[0]).replace("–", "-"); }
  catch { return ""; }
}
