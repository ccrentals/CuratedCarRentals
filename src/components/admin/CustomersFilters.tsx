"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type CustomersFiltersProps = {
  initialQuery: string;
  initialSort: "last_booked" | "total_bookings" | "total_spend";
};

function normalizeSort(value: string | null): "last_booked" | "total_bookings" | "total_spend" {
  if (value === "total_bookings") return "total_bookings";
  if (value === "total_spend") return "total_spend";
  return "last_booked";
}

export function CustomersFilters({ initialQuery, initialSort }: CustomersFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const queryParam = searchParams.get("q") ?? initialQuery;
  const sortParam = normalizeSort(searchParams.get("sort") ?? initialSort);

  const [query, setQuery] = useState(queryParam);
  const [sort, setSort] = useState(sortParam);

  useEffect(() => {
    if (queryParam !== query) setQuery(queryParam);
    if (sortParam !== sort) setSort(sortParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParam, sortParam]);

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
      action="/admin/customers"
      method="get"
      className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4"
    >
      <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto_auto]">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Search
          <input
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, or phone"
            className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Sort
          <select
            name="sort"
            value={sort}
            onChange={(event) => {
              const nextSort = normalizeSort(event.target.value);
              setSort(nextSort);
              updateParams({ sort: nextSort });
            }}
            className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="last_booked">Last Booked</option>
            <option value="total_bookings">Most Bookings</option>
            <option value="total_spend">Highest Spend</option>
          </select>
        </label>
        <button
          type="submit"
          className="mt-6 w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white md:w-auto"
        >
          Apply
        </button>
        <Link
          href="/admin/customers"
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] md:w-auto"
        >
          Reset
        </Link>
      </div>
    </form>
  );
}
