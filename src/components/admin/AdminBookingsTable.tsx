"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { InfoTooltipIcon } from "@/components/admin/InfoTooltipIcon";
import { PaginationSummary } from "@/components/admin/PaginationSummaryNav";
import {
  mergeBookingsById,
  type BookingPageSize,
  withBookingPageSizeSearchParams,
} from "@/lib/bookings/adminBookingsPagination";
import type { AdminBookingListItem } from "@/lib/bookings/adminBookingsList";
import {
  buildLoadedPaginationProgress,
  STANDARD_PAGE_SIZE_OPTIONS,
} from "@/lib/pagination/sharedPagination";

type AdminBookingsTableProps = {
  initialRows: AdminBookingListItem[];
  initialNextCursor: string | null;
  initialHasMore: boolean;
  initialTotalCount: number;
  pageSize: BookingPageSize;
  filters: {
    status?: string;
    q?: string;
    dateFrom?: string;
    dateTo?: string;
    archived?: "1";
  };
  stateKey: string;
};

const STATUS_PILL_BASE_CLASS =
  "inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold leading-none";

function statusPillToneClass(status: string) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  if (normalized === "CONFIRMED") {
    return "border-sky-300/30 bg-sky-500/15 text-sky-100";
  }
  if (normalized === "PENDING_PAYMENT" || normalized === "PENDING") {
    return "border-amber-300/60 bg-amber-500/20 text-amber-100";
  }
  if (normalized === "CANCELLED") {
    return "border-rose-300/45 bg-rose-500/15 text-rose-100";
  }
  if (normalized === "OVERRIDDEN") {
    return "border-red-300/40 bg-red-500/15 text-red-100";
  }
  if (normalized === "RETURNED" || normalized === "COMPLETED") {
    return "border-emerald-300/40 bg-emerald-500/15 text-emerald-100";
  }
  if (normalized === "PICKED_UP" || normalized === "ACTIVE") {
    return "border-cyan-300/35 bg-cyan-500/15 text-cyan-100";
  }
  return "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]";
}

export function AdminBookingsTable({
  initialRows,
  initialNextCursor,
  initialHasMore,
  initialTotalCount,
  pageSize,
  filters,
  stateKey,
}: AdminBookingsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPageSizePending, startPageSizeTransition] = useTransition();

  const [rows, setRows] = useState<AdminBookingListItem[]>(initialRows);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string>("");

  useEffect(() => {
    setRows(initialRows);
    setNextCursor(initialNextCursor);
    setHasMore(initialHasMore);
    setTotalCount(initialTotalCount);
    setLoadMoreError("");
  }, [stateKey, initialRows, initialNextCursor, initialHasMore, initialTotalCount]);

  const baseApiQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.q) params.set("q", filters.q);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    if (filters.archived === "1") params.set("archived", "1");
    params.set("limit", String(pageSize));
    return params;
  }, [filters, pageSize]);

  const handlePageSizeChange = (nextValue: string) => {
    const next = withBookingPageSizeSearchParams(searchParams.toString(), nextValue);
    const nextUrl = next.toString() ? `${pathname}?${next.toString()}` : pathname;
    startPageSizeTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  };

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadMoreError("");

    try {
      const params = new URLSearchParams(baseApiQuery.toString());
      params.set("cursor", nextCursor);
      const response = await fetch(`/api/admin/bookings?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load more bookings");
      }

      const payload = (await response.json()) as {
        bookings?: AdminBookingListItem[];
        nextCursor?: string | null;
        hasMore?: boolean;
        totalCount?: number;
      };

      const incomingRows = Array.isArray(payload.bookings) ? payload.bookings : [];
      setRows((existing) => mergeBookingsById(existing, incomingRows));
      setNextCursor(payload.nextCursor ?? null);
      setHasMore(Boolean(payload.hasMore));
      if (typeof payload.totalCount === "number" && Number.isFinite(payload.totalCount)) {
        setTotalCount(Math.max(0, Math.floor(payload.totalCount)));
      }
    } catch {
      setLoadMoreError("Unable to load more bookings right now.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  const pagination = buildLoadedPaginationProgress(rows.length, totalCount, pageSize);

  return (
    <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
      {rows.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
          No bookings found for these filters.
        </div>
      ) : (
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
            <tr>
              <th className="px-4 py-3">Booking</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((booking) => (
              <tr key={booking.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                <td className="px-4 py-3 font-mono text-xs text-[var(--ccr-text)]">
                  <Link
                    href={`/admin/bookings/${booking.id}`}
                    className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                    title="Open booking"
                  >
                    {booking.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-[var(--ccr-text)]">{booking.customerName}</p>
                  <p className="text-xs text-[var(--ccr-muted)]">{booking.customerEmail}</p>
                </td>
                <td className="px-4 py-3 text-[var(--ccr-text)]">{booking.vehicleLabel}</td>
                <td className="px-4 py-3 text-[var(--ccr-muted)]">
                  <span className="hidden md:inline">{booking.datesLabel}</span>
                  <details className="group md:hidden">
                    <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-text)]">
                        See more
                        <svg
                          viewBox="0 0 20 20"
                          className="h-3 w-3 transition-transform group-open:rotate-180"
                          aria-hidden="true"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 7l5 6 5-6" />
                        </svg>
                      </span>
                    </summary>
                    <div className="mt-2 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-2 text-xs text-[var(--ccr-muted)]">
                      {booking.datesLabel}
                    </div>
                  </details>
                </td>
                <td className="px-4 py-3">
                  <div className="flex w-full items-center gap-2">
                    <span className={`${STATUS_PILL_BASE_CLASS} ${statusPillToneClass(booking.status)}`}>
                      {booking.statusLabel}
                    </span>
                    {booking.substatusIndicators.length > 0 ? (
                      <span className="ml-auto flex flex-nowrap items-center justify-end gap-2">
                        {booking.substatusIndicators.map((indicator) => (
                          <InfoTooltipIcon
                            key={`${booking.id}-${indicator.key}`}
                            message={indicator.message}
                            variant={indicator.variant}
                          />
                        ))}
                      </span>
                    ) : null}
                  </div>
                  {booking.overriddenByBookingId ? (
                    <span
                      className="mt-1 inline-flex flex-wrap items-center gap-1 rounded-full border border-red-300/40 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-100"
                      title={`Overridden by booking ${booking.overriddenByBookingId}`}
                    >
                      Overridden
                      <Link
                        href={`/admin/bookings/${booking.overriddenByBookingId}`}
                        className="underline underline-offset-2"
                      >
                        by {booking.overriddenByCustomerName ?? booking.overriddenByBookingId.slice(0, 8)}
                      </Link>
                    </span>
                  ) : null}
                  {booking.lostToFirstDeposit ? (
                    <span className="mt-1 inline-flex rounded-full border border-amber-300/40 bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                      Lost to first deposit
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-[var(--ccr-muted)]">
                  <span className="hidden md:inline">{booking.createdAtLabel}</span>
                  {booking.cancelledAtLabel ? (
                    <p className="mt-1 hidden text-[11px] text-rose-200 md:block">
                      Cancelled: {booking.cancelledAtLabel}
                    </p>
                  ) : null}
                  <details className="group md:hidden">
                    <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-text)]">
                        See more
                        <svg
                          viewBox="0 0 20 20"
                          className="h-3 w-3 transition-transform group-open:rotate-180"
                          aria-hidden="true"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 7l5 6 5-6" />
                        </svg>
                      </span>
                    </summary>
                    <div className="mt-2 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-2 text-xs text-[var(--ccr-muted)]">
                      {booking.createdAtLabel}
                      {booking.cancelledAtLabel ? ` • Cancelled: ${booking.cancelledAtLabel}` : ""}
                    </div>
                  </details>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/admin/bookings/${booking.id}`} className="text-sm font-semibold text-[var(--ccr-text)]">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ccr-border)] px-4 py-3">
        <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Rows per page
          <select
            value={String(pageSize)}
            onChange={(event) => handlePageSizeChange(event.target.value)}
            disabled={isPageSizePending || isLoadingMore}
            className="cursor-pointer rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
          >
            {STANDARD_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={String(size)}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex min-w-[250px] flex-col items-end gap-2">
          <PaginationSummary
            from={pagination.from}
            to={pagination.to}
            totalCount={totalCount}
            page={pagination.page}
            totalPages={pagination.totalPages}
            className="mt-0 w-full justify-end"
          />
          <div className="flex items-center gap-3">
            {loadMoreError ? <span className="text-xs text-rose-300">{loadMoreError}</span> : null}
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={!hasMore || !nextCursor || isLoadingMore || rows.length === 0}
              className="cursor-pointer rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingMore ? "Loading..." : hasMore ? "Load more" : "No more bookings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
