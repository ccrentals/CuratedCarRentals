"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  VEHICLE_FILTER_OPTIONS,
  VEHICLE_SORT_COLUMNS,
  type VehicleFilterOption,
  type VehicleSortBy,
  type VehicleSortState,
} from "@/lib/vehicles/adminVehicles";
import { normalizeSortDir } from "@/components/admin/tableSort";

type VehiclesFiltersProps = {
  initialQuery: string;
  initialFilter: VehicleFilterOption;
  initialSort: VehicleSortState;
};

const FILTER_LABELS: Record<VehicleFilterOption, string> = {
  all: "All",
  available: "Available",
  upcoming: "Upcoming",
  dirty: "Dirty",
  on_rent: "On Rent",
};

const SORT_LABELS: Record<VehicleSortBy, string> = {
  vehicle: "Vehicle",
  dailyRate: "Daily Rate",
  deposit: "Deposit",
  status: "Status",
  created: "Created",
};

function normalizeSortBy(value: string | null, fallback: VehicleSortBy): VehicleSortBy {
  if (!value) return fallback;
  if (!VEHICLE_SORT_COLUMNS.includes(value as VehicleSortBy)) return fallback;
  return value as VehicleSortBy;
}

export function VehiclesFilters({ initialQuery, initialFilter, initialSort }: VehiclesFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const queryParam = searchParams.get("q") ?? initialQuery;
  const filterParam = (searchParams.get("fleet") as VehicleFilterOption | null) ?? initialFilter;
  const sortByParam = normalizeSortBy(searchParams.get("sortBy"), initialSort.sortBy);
  const sortDirParam = normalizeSortDir(searchParams.get("sortDir")) ?? initialSort.sortDir;
  const [query, setQuery] = useState(queryParam);
  const [filter, setFilter] = useState<VehicleFilterOption>(filterParam);
  const [sortBy, setSortBy] = useState<VehicleSortBy>(sortByParam);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(sortDirParam);

  useEffect(() => {
    if (queryParam !== query) setQuery(queryParam);
    if (filterParam !== filter && VEHICLE_FILTER_OPTIONS.includes(filterParam)) {
      setFilter(filterParam);
    }
    if (sortByParam !== sortBy) {
      setSortBy(sortByParam);
    }
    if (sortDirParam !== sortDir) {
      setSortDir(sortDirParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParam, filterParam, sortByParam, sortDirParam]);

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
      const trimmed = query.trim();
      if (trimmed.length > 0 && trimmed.length < 3) return;
      const current = searchParams.get("q") ?? "";
      if (trimmed === current) return;
      updateParams({ q: trimmed ? trimmed : null });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query, searchParams, updateParams]);

  return (
    <form
      action="/admin/vehicles"
      method="get"
      className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4"
    >
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:min-w-0 sm:flex-1 sm:flex-nowrap sm:items-center sm:overflow-x-auto sm:px-2 sm:py-1 sm:scroll-pl-2 sm:scroll-pr-2">
        {VEHICLE_FILTER_OPTIONS.map((option) => {
          const active = filter === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => {
                setFilter(option);
                updateParams({ fleet: option === "all" ? null : option });
              }}
              className={`min-h-11 rounded-full border px-3 py-1.5 text-[11px] font-semibold leading-none transition sm:min-h-0 sm:px-4 sm:text-xs ${
                active
                  ? "border-[var(--ccr-primary)] bg-[var(--ccr-primary)] text-white ring-1 ring-[var(--ccr-accent)]"
                  : "border-[var(--ccr-border)] bg-transparent text-[var(--ccr-text)] hover:border-[var(--ccr-primary)]"
              }`}
            >
              {FILTER_LABELS[option]}
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3 sm:hidden">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Sort</p>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Sort by
            <select
              data-testid="vehicles-mobile-sort-by"
              value={sortBy}
              onChange={(event) => {
                const next = normalizeSortBy(event.target.value, "created");
                setSortBy(next);
                updateParams({ sortBy: next, sortDir });
              }}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              {VEHICLE_SORT_COLUMNS.map((option) => (
                <option key={option} value={option}>
                  {SORT_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              const next = sortDir === "asc" ? "desc" : "asc";
              setSortDir(next);
              updateParams({ sortBy, sortDir: next });
            }}
            data-testid="vehicles-mobile-sort-dir"
            className="min-h-11 self-end rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            aria-label={`Sort direction ${sortDir === "asc" ? "ascending" : "descending"}`}
          >
            {sortDir === "asc" ? "Asc" : "Desc"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:flex sm:flex-wrap sm:items-end">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] sm:min-w-[260px] sm:flex-1">
          Search
          <input
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search make, model, year, ID, VIN, or plate"
            className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <input type="hidden" name="fleet" value={filter === "all" ? "" : filter} />
        <input type="hidden" name="sortBy" value={sortBy} />
        <input type="hidden" name="sortDir" value={sortDir} />
        <button
          type="submit"
          className="min-h-11 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white sm:w-auto"
        >
          Apply
        </button>
        <Link
          href="/admin/vehicles"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] sm:w-auto"
        >
          Reset
        </Link>
      </div>
    </form>
  );
}
