"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type UsersFiltersProps = {
  initialQuery: string;
};

export function UsersFilters({ initialQuery }: UsersFiltersProps) {
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
      const trimmed = query.trim();
      if (trimmed.length > 0 && trimmed.length < 3) return;
      const current = searchParams.get("q") ?? "";
      if (trimmed === current) return;
      updateParams({ q: trimmed ? trimmed : null });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query, searchParams, updateParams]);

  return (
    <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
      <form action="/admin/users" method="get" className="flex flex-wrap items-end gap-3">
        <label className="min-w-[240px] flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Search
          <input
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, or username"
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <button
          type="submit"
          className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white"
        >
          Apply
        </button>
        <Link
          href="/admin/users"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
        >
          Reset
        </Link>
      </form>
    </div>
  );
}
