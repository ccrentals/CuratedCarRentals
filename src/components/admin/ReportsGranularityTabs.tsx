"use client";

import { useEffect, useMemo, useRef, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { ReportGranularity } from "@/lib/reports/adminReports";

type ReportsGranularityTabsProps = {
  active: ReportGranularity;
  hrefs: Record<ReportGranularity, string>;
};

const OPTIONS: ReportGranularity[] = ["day", "week", "month"];

function labelFor(value: ReportGranularity) {
  if (value === "week") return "Week";
  if (value === "month") return "Month";
  return "Day";
}

export function ReportsGranularityTabs({ active, hrefs }: ReportsGranularityTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const restoreScrollTopRef = useRef<number | null>(null);
  const searchParamsKey = useMemo(() => searchParams.toString(), [searchParams]);

  useEffect(() => {
    if (restoreScrollTopRef.current === null) return;
    const targetY = restoreScrollTopRef.current;
    const restore = () => window.scrollTo({ top: targetY, left: window.scrollX, behavior: "auto" });
    restore();
    requestAnimationFrame(restore);
    restoreScrollTopRef.current = null;
  }, [pathname, searchParamsKey]);

  return (
    <div className="flex flex-wrap gap-2">
      {OPTIONS.map((option) => {
        const isActive = active === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isActive}
            disabled={isPending || isActive}
            onClick={() => {
              if (isActive || isPending) return;
              restoreScrollTopRef.current = window.scrollY;
              startTransition(() => {
                router.push(hrefs[option], { scroll: false });
              });
            }}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition hover:ring-2 hover:ring-[var(--ccr-accent)] hover:ring-offset-1 hover:ring-offset-[var(--ccr-surface)] ${
              isActive
                ? "bg-[var(--ccr-primary)] text-white"
                : "border border-[var(--ccr-border)] text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]"
            } ${isPending ? "opacity-80" : ""}`}
          >
            {labelFor(option)}
          </button>
        );
      })}
    </div>
  );
}
