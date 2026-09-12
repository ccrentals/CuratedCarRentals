import { durationTierLabel, matchDurationTier, type DurationTier } from "@/lib/bookings/durationPricing";
import { formatPublicJmd } from "@/lib/money";

export function DurationRates({ tiers = [], standardRate, days }: { tiers?: DurationTier[]; standardRate: number; days?: number }) {
  if (!tiers.length) return null;
  const matched = days ? matchDurationTier(tiers, days) : null;
  return (
    <section
      className="my-4 overflow-hidden rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
      aria-label="Rental duration rates"
    >
      <div className="flex items-center justify-between border-b border-[var(--ccr-border)] px-3.5 py-2.5">
        <p className="text-[0.68rem] font-bold uppercase tracking-[0.15em] text-[var(--ccr-muted)]">Duration rates</p>
        <span className="text-[0.68rem] font-medium uppercase tracking-[0.1em] text-[var(--ccr-muted)]">Daily rate</span>
      </div>
      <ul className="divide-y divide-[var(--ccr-border)]">
        {tiers.map((tier) => {
          const isMatched = matched === tier;
          return (
            <li
              key={tier.minDays}
              className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${
                isMatched ? "bg-[color-mix(in_srgb,var(--ccr-accent)_12%,transparent)]" : ""
              }`}
            >
              <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--ccr-text)]">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${
                  isMatched
                    ? "border-[var(--ccr-accent)] bg-[var(--ccr-accent)] text-[var(--ccr-primary)]"
                    : "border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-muted)]"
                }`}>
                  {durationTierLabel(tier)}
                </span>
                {isMatched ? <span className="text-xs font-medium text-[var(--ccr-accent-strong)]">Your rate</span> : null}
              </span>
              <span className="shrink-0 text-right text-sm font-bold tabular-nums text-[var(--ccr-text)]">
                {formatPublicJmd(tier.dailyRateJmd)}
                <span className="ml-1 text-xs font-medium text-[var(--ccr-muted)]">/ day</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-[var(--ccr-border)] px-3.5 py-2.5 text-xs leading-5 text-[var(--ccr-muted)]">
        Other durations use the standard rate of <span className="font-semibold text-[var(--ccr-text)]">{formatPublicJmd(standardRate)}/day</span>; weekend and seasonal rates may apply.
        {days && !matched ? " Standard pricing applies to your dates." : ""}
      </p>
    </section>
  );
}
