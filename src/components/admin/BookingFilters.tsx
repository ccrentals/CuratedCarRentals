"use client";

import { CalendarIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ADMIN_ACCENT_RING_CLASS } from "@/components/admin/adminUiClasses";
import { buttonStyles } from "@/components/ui/Button";

const STATUS_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending_payment" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Completed", value: "completed" },
  { label: "Upcoming", value: "upcoming" },
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
  const dateFromInputRef = useRef<HTMLInputElement | null>(null);
  const dateToInputRef = useRef<HTMLInputElement | null>(null);

  const scopeParam = searchParams.get("scope")?.toLowerCase() === "upcoming" ? "upcoming" : "all";
  const statusParam = normalizeStatus(searchParams.get("status"));
  const selectedStatusParam = scopeParam === "upcoming" ? "upcoming" : statusParam;
  const qParam = searchParams.get("q") ?? "";
  const dateFromParam = searchParams.get("dateFrom") ?? "";
  const dateToParam = searchParams.get("dateTo") ?? "";
  const archivedParam = searchParams.get("archived") === "1";

  const [status, setStatus] = useState(selectedStatusParam);
  const [query, setQuery] = useState(qParam);
  const [dateFrom, setDateFrom] = useState(dateFromParam);
  const [dateTo, setDateTo] = useState(dateToParam);
  const [showArchived, setShowArchived] = useState(archivedParam);

  useEffect(() => {
    if (selectedStatusParam !== status) setStatus(selectedStatusParam);
    if (qParam !== query) setQuery(qParam);
    if (dateFromParam !== dateFrom) setDateFrom(dateFromParam);
    if (dateToParam !== dateTo) setDateTo(dateToParam);
    if (archivedParam !== showArchived) setShowArchived(archivedParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStatusParam, qParam, dateFromParam, dateToParam, archivedParam]);

  const updateParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const baseParams =
        typeof window === "undefined"
          ? new URLSearchParams(searchParams.toString())
          : new URLSearchParams(window.location.search);
      const params = new URLSearchParams(baseParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (!value) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      const next = params.toString();
      const nextUrl = next ? `${pathname}?${next}` : pathname;
      const current = baseParams.toString();
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

  const openNativePicker = useCallback((ref: RefObject<HTMLInputElement | null>) => {
    const input = ref.current;
    if (!input) return;

    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof pickerInput.showPicker === "function") {
      try {
        pickerInput.showPicker();
        return;
      } catch {
        // Fall through for browsers that block showPicker.
      }
    }

    input.focus();
    input.click();
  }, []);

  return (
    <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:min-w-0 sm:flex-1 sm:flex-nowrap sm:items-center sm:overflow-x-auto sm:px-2 sm:py-1 sm:scroll-pl-2 sm:scroll-pr-2">
          {STATUS_OPTIONS.map((option) => {
            const isActive = status === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setStatus(option.value);
                  if (option.value === "upcoming") {
                    updateParams({
                      scope: "upcoming",
                      status: null,
                      pickupDay: null,
                    });
                    return;
                  }
                  updateParams({
                    status: option.value === "all" ? null : option.value,
                    scope: null,
                    pickupDay: null,
                  });
                }}
                className={`rounded-full border px-2.5 py-1.5 text-[11px] font-semibold leading-none transition sm:px-4 sm:text-xs ${
                  isActive
                    ? `border-[var(--ccr-primary)] bg-[var(--ccr-primary)] text-white ${ADMIN_ACCENT_RING_CLASS}`
                    : "border-[var(--ccr-border)] bg-transparent text-[var(--ccr-text)] hover:border-[var(--ccr-primary)]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

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
            className={buttonStyles({
              variant: "secondary",
              size: "xs",
              className: "w-full rounded-full sm:ml-auto sm:w-auto",
            })}
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
          <div className="relative mt-1">
            <input
              ref={dateFromInputRef}
              type="date"
              value={dateFrom}
              onChange={(event) => {
                const value = event.target.value;
                setDateFrom(value);
                updateParams({
                  dateFrom: value && DATE_RE.test(value) ? value : null,
                  dateTo: dateTo && DATE_RE.test(dateTo) ? dateTo : null,
                });
              }}
              data-testid="bookings-filter-date-from"
              className="promo-date-time-input w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 pr-10 text-sm text-[var(--ccr-text)]"
            />
            <button
              type="button"
              onClick={() => openNativePicker(dateFromInputRef)}
              className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-[var(--ccr-muted)] opacity-80 transition hover:opacity-100"
              aria-label="Open date from calendar"
              title="Open calendar"
            >
              <CalendarIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Date to
          </label>
          <div className="relative mt-1">
            <input
              ref={dateToInputRef}
              type="date"
              value={dateTo}
              onChange={(event) => {
                const value = event.target.value;
                setDateTo(value);
                updateParams({
                  dateFrom: dateFrom && DATE_RE.test(dateFrom) ? dateFrom : null,
                  dateTo: value && DATE_RE.test(value) ? value : null,
                });
              }}
              data-testid="bookings-filter-date-to"
              className="promo-date-time-input w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 pr-10 text-sm text-[var(--ccr-text)]"
            />
            <button
              type="button"
              onClick={() => openNativePicker(dateToInputRef)}
              className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-[var(--ccr-muted)] opacity-80 transition hover:opacity-100"
              aria-label="Open date to calendar"
              title="Open calendar"
            >
              <CalendarIcon className="h-4 w-4" />
            </button>
          </div>
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
