"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { PaginationSummary } from "@/components/admin/PaginationSummaryNav";
import { SortableTh } from "@/components/admin/SortableTh";
import { type SortState } from "@/components/admin/tableSort";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { StackedDateTimeRange } from "@/components/shared/StackedDateTimeRange";
import {
  CUSTOMER_SNAPSHOT_SORT_COLUMNS,
  sortCustomerSnapshotBookings,
  type CustomerSnapshotBookingItem,
} from "@/lib/customers/customerSnapshotBookingView";
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
  const [sort, setSort] = useState<SortState>({ sortBy: "created", sortDir: "desc" });

  useEffect(() => {
    setRows(initialRows);
    setNextCursor(initialNextCursor);
    setHasMore(initialHasMore);
    setTotalCount(initialTotalCount);
    setLoadMoreError("");
    setSort({ sortBy: "created", sortDir: "desc" });
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
  const sortedRows = useMemo(
    () =>
      sortCustomerSnapshotBookings(
        rows,
        (sort.sortBy as (typeof CUSTOMER_SNAPSHOT_SORT_COLUMNS)[number] | undefined) ?? "created",
        sort.sortDir ?? "desc",
      ),
    [rows, sort],
  );
  const bookingLinkClass =
    "inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]";

  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--ccr-border)]">
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-[var(--ccr-muted)]">No bookings found for this filter.</div>
      ) : (
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
            <tr>
              <SortableTh label="Booking" columnKey="booking" sort={sort} onChange={setSort} className="px-3 py-2" defaultDirection="asc" />
              <SortableTh label="Vehicle" columnKey="vehicle" sort={sort} onChange={setSort} className="px-3 py-2" defaultDirection="asc" />
              <SortableTh label="Dates" columnKey="dates" sort={sort} onChange={setSort} className="px-3 py-2" defaultDirection="asc" />
              <SortableTh label="Status" columnKey="status" sort={sort} onChange={setSort} className="px-3 py-2" defaultDirection="asc" />
              <SortableTh label="Total" columnKey="total" sort={sort} onChange={setSort} className="px-3 py-2" defaultDirection="desc" />
              <SortableTh label="Balance" columnKey="balance" sort={sort} onChange={setSort} className="px-3 py-2" defaultDirection="desc" />
              <SortableTh label="Created" columnKey="created" sort={sort} onChange={setSort} className="px-3 py-2" defaultDirection="desc" />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((booking) => (
              <tr key={booking.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/bookings/${booking.id}`}
                    data-testid="customer-booking-public-id"
                    className={bookingLinkClass}
                    title="Open booking"
                  >
                    {booking.publicId}
                  </Link>
                </td>
                <td className="px-3 py-2 text-[var(--ccr-text)]">{booking.vehicleLabel}</td>
                <td className="px-3 py-2 text-[var(--ccr-muted)]">
                  <StackedDateTimeRange
                    startLabel={booking.startDateLabel}
                    endLabel={booking.endDateLabel}
                  />
                </td>
                <td className="px-3 py-2 text-[var(--ccr-text)]">{booking.statusLabel}</td>
                <td className="px-3 py-2 text-[var(--ccr-text)]">{booking.totalLabel}</td>
                <td className="px-3 py-2 text-[var(--ccr-text)]">{booking.balanceLabel}</td>
                <td className="px-3 py-2 text-[var(--ccr-muted)]">
                  <TableDateTime value={booking.createdAtValue} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-col gap-3 border-t border-[var(--ccr-border)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
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

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          <PaginationSummary
            from={pagination.from}
            to={pagination.to}
            totalCount={totalCount}
            page={pagination.page}
            totalPages={pagination.totalPages}
            className="mt-0 shrink-0 flex-nowrap justify-end gap-3 whitespace-nowrap"
          />
          <div className="flex shrink-0 items-center gap-3">
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
