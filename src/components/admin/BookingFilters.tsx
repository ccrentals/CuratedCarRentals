"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ADMIN_ACCENT_RING_CLASS } from "@/components/admin/adminUiClasses";

const STATUS_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Pending payment", value: "pending_payment" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Lost to first deposit", value: "lost_to_first_deposit" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeStatus(value: string | null) {
  if (!value) return "all";
  const normalized = value.toLowerCase();
  return STATUS_OPTIONS.some((option) => option.value === normalized) ? normalized : "all";
}

export default function BookingFilters({ canAdmin }: { canAdmin?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const statusParam = normalizeStatus(searchParams.get("status"));
  const qParam = searchParams.get("q") ?? "";
  const dateFromParam = searchParams.get("dateFrom") ?? "";
  const dateToParam = searchParams.get("dateTo") ?? "";
  const archivedParam = searchParams.get("archived") === "1";

  const [status, setStatus] = useState(statusParam);
  const [query, setQuery] = useState(qParam);
  const [dateFrom, setDateFrom] = useState(dateFromParam);
  const [dateTo, setDateTo] = useState(dateToParam);
  const [showArchived, setShowArchived] = useState(archivedParam);

  useEffect(() => {
    if (statusParam !== status) setStatus(statusParam);
    if (qParam !== query) setQuery(qParam);
    if (dateFromParam !== dateFrom) setDateFrom(dateFromParam);
    if (dateToParam !== dateTo) setDateTo(dateToParam);
    if (archivedParam !== showArchived) setShowArchived(archivedParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusParam, qParam, dateFromParam, dateToParam, archivedParam]);

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
    const timer = setTimeout(() => {
      const trimmed = query.trim();
      if (trimmed.length > 0 && trimmed.length < 3) {
        if ((searchParams.get("q") ?? "") !== "") {
          updateParams({ q: null });
        }
        return;
      }
      const current = searchParams.get("q") ?? "";
      if (trimmed === current) return;
      updateParams({ q: trimmed ? trimmed : null });
    }, 400);

    return () => clearTimeout(timer);
  }, [query, searchParams, updateParams]);

  const activeFilters = useMemo(
    () => status !== "all" || query.trim() || dateFrom || dateTo || showArchived,
    [status, query, dateFrom, dateTo, showArchived],
  );

  return (
    <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        {STATUS_OPTIONS.map((option) => {
          const isActive = status === option.value;
          return (
            <button
              key={option.value}
              type="button"
            onClick={() => {
                setStatus(option.value);
                updateParams({ status: option.value === "all" ? null : option.value });
              }}
              className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? `border-[var(--ccr-primary)] bg-[var(--ccr-primary)] text-white ${ADMIN_ACCENT_RING_CLASS}`
                  : "border-[var(--ccr-border)] bg-transparent text-[var(--ccr-text)] hover:border-[var(--ccr-primary)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}

        {activeFilters ? (
          <button
            type="button"
            onClick={() => {
              setStatus("all");
              setQuery("");
              setDateFrom("");
              setDateTo("");
              setShowArchived(false);
              router.push(pathname);
            }}
            className="ml-auto rounded-full border border-[var(--ccr-border)] px-4 py-1.5 text-xs font-semibold text-[var(--ccr-text)] hover:border-[var(--ccr-primary)]"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-[1.5fr_repeat(2,1fr)]">
        <div className="col-span-2 md:col-span-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Search
          </label>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, phone, booking ID"
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Date from
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              const value = event.target.value;
              setDateFrom(value);
              updateParams({ dateFrom: value && DATE_RE.test(value) ? value : null });
            }}
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Date to
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => {
              const value = event.target.value;
              setDateTo(value);
              updateParams({ dateTo: value && DATE_RE.test(value) ? value : null });
            }}
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </div>
      </div>

      {canAdmin ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2">
          <div>
            <p className="text-xs font-semibold text-[var(--ccr-text)]">Show archived</p>
            <p className="text-xs text-[var(--ccr-muted)]">Include archived bookings in this list.</p>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ccr-text)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => {
                const next = event.target.checked;
                setShowArchived(next);
                updateParams({ archived: next ? "1" : null });
              }}
              className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent"
            />
            Archived
          </label>
        </div>
      ) : null}
    </div>
  );
}
