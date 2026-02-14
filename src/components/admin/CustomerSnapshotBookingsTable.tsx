"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { PaginationSummary } from "@/components/admin/PaginationSummaryNav";
import type { CustomerSnapshotBookingItem } from "@/lib/customers/customerSnapshotBookings";
import {
  mergeBookingsById,
  type BookingPageSize,
  withBookingPageSizeSearchParams,
} from "@/lib/bookings/adminBookingsPagination";
import {
  buildLoadedPaginationProgress,
  STANDARD_PAGE_SIZE_OPTIONS,
} from "@/lib/pagination/sharedPagination";

type CustomerSnapshotBookingsTableProps = {
  customerId: string;
  initialRows: CustomerSnapshotBookingItem[];
  initialNextCursor: string | null;
  initialHasMore: boolean;
  initialTotalCount: number;
  pageSize: BookingPageSize;
  filters: {
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  stateKey: string;
};

export function CustomerSnapshotBookingsTable({
  customerId,
  initialRows,
  initialNextCursor,
  initialHasMore,
  initialTotalCount,
  pageSize,
  filters,
  stateKey,
}: CustomerSnapshotBookingsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPageSizePending, startPageSizeTransition] = useTransition();

  const [rows, setRows] = useState<CustomerSnapshotBookingItem[]>(initialRows);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");

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
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
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
      const response = await fetch(`/api/admin/customers/${customerId}/bookings?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load more bookings");
      }

      const payload = (await response.json()) as {
        bookings?: CustomerSnapshotBookingItem[];
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
    <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--ccr-border)]">
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-[var(--ccr-muted)]">No bookings found for this filter.</div>
      ) : (
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
            <tr>
              <th className="px-3 py-2">Booking</th>
              <th className="px-3 py-2">Vehicle</th>
              <th className="px-3 py-2">Dates</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Balance</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2 text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((booking) => (
              <tr key={booking.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                <td className="px-3 py-2 font-mono text-xs text-[var(--ccr-text)]">{booking.shortId}</td>
                <td className="px-3 py-2 text-[var(--ccr-text)]">{booking.vehicleLabel}</td>
                <td className="px-3 py-2 text-[var(--ccr-muted)]">{booking.datesLabel}</td>
                <td className="px-3 py-2 text-[var(--ccr-text)]">{booking.statusLabel}</td>
                <td className="px-3 py-2 text-[var(--ccr-text)]">{booking.totalLabel}</td>
                <td className="px-3 py-2 text-[var(--ccr-text)]">{booking.balanceLabel}</td>
                <td className="px-3 py-2 text-[var(--ccr-muted)]">{booking.createdAtLabel}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/admin/bookings/${booking.id}`} className="text-xs font-semibold text-[var(--ccr-text)]">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ccr-border)] px-3 py-3">
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
