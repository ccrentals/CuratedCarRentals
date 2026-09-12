"use client";
import { durationTierLabel, matchDurationTier, validateDurationTiers } from "@/lib/bookings/durationPricing";
import { formatPublicJmd } from "@/lib/money";

export type DurationTierInput = { minDays: string; maxDays: string; dailyRateJmd: string };
export function parseTierInputs(rows: DurationTierInput[]) {
  return validateDurationTiers(rows.map(row => ({ minDays: Number(row.minDays), maxDays: row.maxDays.trim() ? Number(row.maxDays) : null, dailyRateJmd: Number(row.dailyRateJmd) })));
}

export function DurationPricingEditor({ enabled, rows, standardRate, onEnabled, onRows }: {
  enabled: boolean; rows: DurationTierInput[]; standardRate: number;
  onEnabled: (value: boolean) => void; onRows: (rows: DurationTierInput[]) => void;
}) {
  let error = "";
  let tiers: ReturnType<typeof parseTierInputs> = [];
  try { tiers = parseTierInputs(rows); } catch (cause) { error = (cause as Error).message; }
  const boundaries = [...new Set(tiers.flatMap(t => [t.minDays - 1, t.minDays, ...(t.maxDays === null ? [] : [t.maxDays, t.maxDays + 1])]))].filter(d => d > 0).sort((a,b) => a-b);
  return <fieldset className="space-y-3 rounded-xl border border-[var(--ccr-border)] p-4">
    <legend className="px-2 font-semibold">Duration pricing</legend>
    <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={e => onEnabled(e.target.checked)} />Enable duration pricing</label>
    <p className="text-sm text-[var(--ccr-muted)]">One range sets the daily rate for the entire rental. Uncovered durations use standard pricing, including weekend and seasonal rates. Leave maximum blank for “and above”.</p>
    {rows.map((row, i) => <div key={i} className="grid gap-2 sm:grid-cols-4">
      {([['minDays','Minimum days'], ['maxDays','Maximum days (optional)'], ['dailyRateJmd','Daily rate (JMD)']] as const).map(([key,label]) => <label key={key} className="text-xs">{label}<input className="mt-1 w-full rounded border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-2 text-sm" type="number" min="1" step="1" value={row[key]} onChange={e => onRows(rows.map((r,j) => j === i ? {...r,[key]: e.target.value} : r))} /></label>)}
      <button type="button" className="self-end rounded border border-[var(--ccr-border)] p-2 text-sm" onClick={() => onRows(rows.filter((_,j) => j !== i))}>Remove range {i+1}</button>
    </div>)}
    <button type="button" className="rounded border border-[var(--ccr-border)] px-3 py-2 text-sm" disabled={rows.length >= 64} onClick={() => onRows([...rows,{minDays:'',maxDays:'',dailyRateJmd:''}])}>Add duration range</button>
    {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : <div aria-live="polite" className="space-y-2 text-sm">
      {tiers.map(t => <p key={t.minDays}>{durationTierLabel(t)}: {formatPublicJmd(t.dailyRateJmd)} per day</p>)}
      {boundaries.length > 0 && <><p className="font-semibold">Rental totals at range boundaries</p><p className="text-xs text-[var(--ccr-muted)]">Preview assumes duration pricing is enabled. Excludes extras and discounts; uncovered days use the standard base rate here. Actual dates may apply weekend/seasonal rates.</p>
        <div className="grid gap-1 sm:grid-cols-2">{boundaries.map(days => <p key={days}>{days} days × {formatPublicJmd(matchDurationTier(tiers, days)?.dailyRateJmd ?? standardRate)} = {formatPublicJmd(days * (matchDurationTier(tiers, days)?.dailyRateJmd ?? standardRate))}</p>)}</div></>}
    </div>}
  </fieldset>;
}
