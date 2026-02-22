"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type CustomersFiltersProps = {
  initialQuery: string;
};

export function CustomersFilters({ initialQuery }: CustomersFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const queryParam = searchParams.get("q") ?? initialQuery;
  const sortByParam = searchParams.get("sortBy") ?? "";
  const sortDirParam = searchParams.get("sortDir") ?? "";

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
      {sortByParam ? <input type="hidden" name="sortBy" value={sortByParam} /> : null}
      {sortDirParam ? <input type="hidden" name="sortDir" value={sortDirParam} /> : null}
      <div className="grid gap-3 md:grid-cols-[2fr_auto]">
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
        <div className="grid grid-cols-2 gap-2 md:flex md:items-end">
          <button
            type="submit"
            className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white md:w-auto"
          >
            Apply
          </button>
          <Link
            href="/admin/customers"
            className="inline-flex w-full items-center justify-center rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] md:w-auto"
          >
            Reset
          </Link>
        </div>
      </div>
    </form>
  );
}
