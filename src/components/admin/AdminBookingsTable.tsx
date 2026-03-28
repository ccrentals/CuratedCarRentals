"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { InfoTooltipIcon } from "@/components/admin/InfoTooltipIcon";
import { PaginationSummary } from "@/components/admin/PaginationSummaryNav";
import { SortableTh } from "@/components/admin/SortableTh";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { StackedDateTimeRange } from "@/components/shared/StackedDateTimeRange";
import {
  applySortToSearchParams,
  readSortFromSearchParams,
  type SortState,
} from "@/components/admin/tableSort";
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
    scope?: string;
    pickupDay?: string;
    sortBy?: string;
    sortDir?: string;
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
const BOOKING_SORT_COLUMNS = ["booking", "customer", "vehicle", "dates", "status", "created"] as const;

function statusPillToneClass(status: string, phase: AdminBookingListItem["derivedPhase"]) {
  if (phase === "UPCOMING") {
    return "border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
  }
  if (phase === "ON_RENT") {
    return "border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
  }

  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  if (normalized === "CONFIRMED") {
    return "border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
  }
  if (normalized === "PENDING_PAYMENT" || normalized === "PENDING") {
    return "border-[var(--ccr-status-accent-border)] bg-[var(--ccr-status-accent-bg)] text-[var(--ccr-status-accent-text)]";
  }
  if (normalized === "CANCELLED") {
    return "border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] text-[var(--ccr-status-danger-text)]";
  }
  if (normalized === "OVERRIDDEN") {
    return "border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] text-[var(--ccr-status-danger-text)]";
  }
  if (normalized === "RETURNED" || normalized === "COMPLETED") {
    return "border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]";
  }
  if (normalized === "PICKED_UP" || normalized === "ACTIVE") {
    return "border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
  }
  return "border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]";
}

function bookingPhaseLabel(booking: AdminBookingListItem) {
  if (booking.derivedPhase === "UPCOMING") return "Upcoming";
  if (booking.derivedPhase === "ON_RENT") return "On Rent";
  return booking.statusLabel;
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
  const defaultSort = useMemo<SortState>(() => {
    const scope = String(filters.scope ?? "").toLowerCase();
    const pickupDay = String(filters.pickupDay ?? "").toLowerCase();
    if (scope === "upcoming" || pickupDay === "today") {
      return { sortBy: "dates", sortDir: "asc" };
    }
    return { sortBy: "created", sortDir: "desc" };
  }, [filters.pickupDay, filters.scope]);
  const sort = useMemo(
    () =>
      readSortFromSearchParams(searchParams, {
        allowedSortBy: BOOKING_SORT_COLUMNS,
        defaultSortBy: defaultSort.sortBy,
        defaultSortDir: defaultSort.sortDir,
      }),
    [defaultSort.sortBy, defaultSort.sortDir, searchParams],
  );

  useEffect(() => {
    setRows(initialRows);
    setNextCursor(initialNextCursor);
    setHasMore(initialHasMore);
    setTotalCount(initialTotalCount);
    setLoadMoreError("");
  }, [stateKey, initialRows, initialNextCursor, initialHasMore, initialTotalCount]);

  const baseApiQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.scope) params.set("scope", filters.scope);
    if (filters.pickupDay) params.set("pickupDay", filters.pickupDay);
    if (sort.sortBy) params.set("sortBy", sort.sortBy);
    if (sort.sortDir) params.set("sortDir", sort.sortDir);
    if (filters.status) params.set("status", filters.status);
    if (filters.q) params.set("q", filters.q);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    if (filters.archived === "1") params.set("archived", "1");
    params.set("limit", String(pageSize));
    return params;
  }, [filters, pageSize, sort.sortBy, sort.sortDir]);

  const updateSort = (next: SortState) => {
    const params = applySortToSearchParams(searchParams, next);
    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    router.replace(nextUrl, { scroll: false });
  };

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
    <div
      data-testid="bookings-list"
      className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
    >
      {rows.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
          No bookings found for these filters.
        </div>
      ) : (
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
            <tr>
              <SortableTh
                label="Booking"
                columnKey="booking"
                sort={sort}
                onChange={updateSort}
                defaultDirection="asc"
              />
              <SortableTh
                label="Customer"
                columnKey="customer"
                sort={sort}
                onChange={updateSort}
                defaultDirection="asc"
              />
              <SortableTh
                label="Vehicle"
                columnKey="vehicle"
                sort={sort}
                onChange={updateSort}
                defaultDirection="asc"
              />
              <SortableTh
                label="Dates"
                columnKey="dates"
                sort={sort}
                onChange={updateSort}
                defaultDirection="asc"
              />
              <SortableTh
                label="Status"
                columnKey="status"
                sort={sort}
                onChange={updateSort}
                defaultDirection="asc"
              />
              <SortableTh
                label="Created"
                columnKey="created"
                sort={sort}
                onChange={updateSort}
                defaultDirection="desc"
              />
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((booking) => (
              <tr
                key={booking.id}
                data-testid="booking-row"
                data-booking-id={booking.id}
                data-booking-public-id={booking.publicId}
                className="border-b border-[var(--ccr-border)] last:border-b-0"
              >
                <td className="px-4 py-3 font-mono text-xs text-[var(--ccr-text)]">
                  <Link
                    href={`/admin/bookings/${booking.id}`}
                    data-testid="booking-public-id"
                    className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                    title="Open booking"
                  >
                    {booking.publicId}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-[var(--ccr-text)]">{booking.customerName}</p>
                  <p className="text-xs text-[var(--ccr-muted)]">{booking.customerEmail}</p>
                </td>
                <td className="px-4 py-3 text-[var(--ccr-text)]">{booking.vehicleLabel}</td>
                <td className="px-4 py-3 text-[var(--ccr-muted)]">
                  <span className="hidden md:inline-flex">
                    <StackedDateTimeRange
                      startLabel={booking.startDateLabel}
                      endLabel={booking.endDateLabel}
                    />
                  </span>
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
                      <StackedDateTimeRange
                        startLabel={booking.startDateLabel}
                        endLabel={booking.endDateLabel}
                      />
                    </div>
                  </details>
                </td>
                <td className="px-4 py-3">
                  <div className="flex w-full items-center gap-2">
                    <span
                      data-testid="booking-row-status"
                      className={`${STATUS_PILL_BASE_CLASS} ${statusPillToneClass(booking.status, booking.derivedPhase)}`}
                    >
                      {bookingPhaseLabel(booking)}
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
                  {booking.lostToFirstDeposit ? (
                    <span className="mt-1 inline-flex rounded-full border border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ccr-status-warning-text)]">
                      Lost to first deposit
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-[var(--ccr-muted)]">
                  <TableDateTime value={booking.createdAtLabel} className="hidden md:inline-flex" />
                  {booking.cancelledAtLabel ? (
                    <div className="mt-1 hidden text-[11px] text-[var(--ccr-status-danger-text)] md:block">
                      <span className="font-semibold uppercase tracking-wide">Cancelled</span>
                      <TableDateTime value={booking.cancelledAtLabel} className="mt-1 inline-flex" />
                    </div>
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
                      <TableDateTime value={booking.createdAtLabel} />
                      {booking.cancelledAtLabel ? (
                        <div className="mt-2 text-[var(--ccr-status-danger-text)]">
                          <p className="font-semibold uppercase tracking-wide">Cancelled</p>
                          <TableDateTime value={booking.cancelledAtLabel} className="mt-1 inline-flex" />
                        </div>
                      ) : null}
                    </div>
                  </details>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/bookings/${booking.id}`}
                    data-testid="booking-row-view"
                    className="text-sm font-semibold text-[var(--ccr-text)]"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-col gap-3 border-t border-[var(--ccr-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
            {loadMoreError ? <span className="text-xs text-[var(--ccr-status-danger-text)]">{loadMoreError}</span> : null}
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
