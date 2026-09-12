import { durationTierLabel, matchDurationTier, type DurationTier } from "@/lib/bookings/durationPricing";
import { formatPublicJmd } from "@/lib/money";

export function DurationRates({ tiers = [], standardRate, days }: { tiers?: DurationTier[]; standardRate: number; days?: number }) {
  if (!tiers.length) return null;
  const matched = days ? matchDurationTier(tiers, days) : null;
  return <div className="my-3 space-y-1 text-sm" aria-label="Rental duration rates">
    {tiers.map(t => <p key={t.minDays} className={matched === t ? "rounded border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] p-2 font-semibold" : "px-2 py-1"}>
      {durationTierLabel(t)}: {formatPublicJmd(t.dailyRateJmd)}/day{matched === t ? " · Your rate" : ""}
    </p>)}
    <p className="px-2 text-xs text-[var(--ccr-muted)]">Other durations: standard rate {formatPublicJmd(standardRate)}/day; weekend/seasonal rates may apply.{days && !matched ? " Standard pricing applies to your dates." : ""}</p>
  </div>;
}
