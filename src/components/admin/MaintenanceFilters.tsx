"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { buttonStyles } from "@/components/ui/Button";
import {
  MIN_MAINTENANCE_SEARCH_LENGTH,
  normalizeMaintenanceSearchTerm,
} from "@/lib/maintenance/normalize";

type MaintenanceFiltersProps = {
  initialQuery: string;
  vehicleId: string;
  status: string;
  category: string;
  from: string;
  to: string;
  onlyActive: boolean;
  scope: string;
  sortBy: string;
  sortDir: string;
  vehicleOptions: Array<{ id: string; label: string }>;
};

export function MaintenanceFilters({
  initialQuery,
  vehicleId,
  status,
  category,
  from,
  to,
  onlyActive,
  scope,
  sortBy,
  sortDir,
  vehicleOptions,
}: MaintenanceFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryParam = searchParams.get("q") ?? initialQuery;
  const [query, setQuery] = useState(queryParam);

  useEffect(() => {
    if (queryParam !== query) setQuery(queryParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParam]);

  const updateParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (!value) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });

      const next = params.toString();
      const nextUrl = next ? `${pathname}?${next}` : pathname;
      const current = searchParams.toString();
      const currentUrl = current ? `${pathname}?${current}` : pathname;
      if (nextUrl !== currentUrl) {
        router.replace(nextUrl, { scroll: false });
      }
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const normalized = normalizeMaintenanceSearchTerm(query);
      const current = searchParams.get("q") ?? "";
      if (normalized === current) return;
      updateParams({ q: normalized || null });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query, searchParams, updateParams]);

  return (
    <form action="/admin/maintenance" method="get" className="mt-4 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Search
          <input
            type="text"
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Vehicle, title, category (${MIN_MAINTENANCE_SEARCH_LENGTH}+ chars)`}
            className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Vehicle
          <select
            name="vehicleId"
            defaultValue={vehicleId}
            className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="">All vehicles</option>
            {vehicleOptions.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Status
          <select
            name="status"
            defaultValue={status}
            className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="all">All</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Category
          <select
            name="category"
            defaultValue={category}
            className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="all">All</option>
            <option value="SERVICE">Service</option>
            <option value="REPAIR">Repair</option>
            <option value="INSPECTION">Inspection</option>
            <option value="REGISTRATION">Registration</option>
            <option value="INSURANCE">Insurance</option>
            <option value="TIRE">Tire</option>
            <option value="BRAKE">Brake</option>
            <option value="BATTERY">Battery</option>
            <option value="OTHER">Other</option>
          </select>
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          From
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          To
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Records
          <select
            name="onlyActive"
            defaultValue={onlyActive ? "1" : "0"}
            className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="1">Only active</option>
            <option value="0">Include archived</option>
          </select>
        </label>
      </div>

      <input type="hidden" name="scope" value={scope === "all" ? "" : scope} />
      <input type="hidden" name="sortBy" value={sortBy} />
      <input type="hidden" name="sortDir" value={sortDir} />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          className={buttonStyles({ variant: "primary", size: "sm" })}
        >
          Apply filters
        </button>
        <Link
          href="/admin/maintenance"
          className={buttonStyles({
            variant: "secondary",
            size: "sm",
            className: "inline-flex items-center justify-center",
          })}
        >
          Reset
        </Link>
      </div>
    </form>
  );
}
