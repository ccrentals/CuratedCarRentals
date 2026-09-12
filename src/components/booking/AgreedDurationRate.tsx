import { savedDurationTierLabel } from "@/lib/bookings/durationPricing";
import { formatJmd } from "@/lib/money";

export function AgreedDurationRate({ pricing }: { pricing: Record<string, unknown> | null }) {
  const label = savedDurationTierLabel(pricing?.duration_tier);
  if (!label) return null;
  return <p className="text-sm">Agreed duration rate: {label} · {formatJmd(Number(pricing?.daily_rate_cents ?? 0))}/day
    {" "}× {Number(pricing?.days ?? 0)} days = {formatJmd(Number(pricing?.base_total_cents ?? 0))} rental subtotal.
    <span className="block text-xs">Rental days are started 24-hour periods.</span>
  </p>;
}
