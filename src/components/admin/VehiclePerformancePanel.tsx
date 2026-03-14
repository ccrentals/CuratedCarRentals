"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PaginationSummary } from "@/components/admin/PaginationSummaryNav";
import { SortableTh } from "@/components/admin/SortableTh";
import { TableDateTime } from "@/components/shared/TableDateTime";
import type { SortDir, SortState } from "@/components/admin/tableSort";

type RangePreset = "30d" | "90d" | "365d" | "custom";
type ByMonthSortBy = "month" | "booked" | "downtime" | "bookings" | "revenue";
type ByMonthSortState = {
  sortBy: ByMonthSortBy;
  sortDir: SortDir;
};
type RecentBookingSortBy = "booking" | "dates" | "status" | "customer" | "total";
type RecentBookingSortState = {
  sortBy: RecentBookingSortBy;
  sortDir: SortDir;
};

type PerformancePayload = {
  ok: boolean;
  range?: {
    start: string;
    end: string;
  };
  kpis?: {
    bookedDays: number;
    availableDays: number;
    utilizationPct: number;
    revenueCents: number | null;
    depositCents: number | null;
    bookingCount: number;
    avgBookingDays: number | null;
    downtimeDays: number;
    maintenanceBlockouts: number;
  };
  breakdown?: {
    byMonth: {
      rows: Array<{
        month: string;
        bookedDays: number;
        downtimeDays: number;
        bookingCount: number;
        revenueCents: number | null;
      }>;
      page: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
      from: number;
      to: number;
      hasPrev: boolean;
      hasNext: boolean;
    };
    recentBookings: {
      rows: Array<{
        id: string;
        publicId: string | null;
        start: string;
        end: string;
        status: string;
        customerName: string | null;
        totalCents: number | null;
        depositCents: number | null;
      }>;
      page: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
      from: number;
      to: number;
      hasPrev: boolean;
      hasNext: boolean;
    };
  };
  error?: string;
};

type VehiclePerformancePanelProps = {
  vehicleId: string;
};

type AppliedRange = {
  preset: RangePreset;
  start?: string;
  end?: string;
};

type PerformanceData = {
  range: {
    start: string;
    end: string;
  };
  kpis: {
    bookedDays: number;
    availableDays: number;
    utilizationPct: number;
    revenueCents: number | null;
    depositCents: number | null;
    bookingCount: number;
    avgBookingDays: number | null;
    downtimeDays: number;
    maintenanceBlockouts: number;
  };
  breakdown: {
    byMonth: {
      rows: Array<{
        month: string;
        bookedDays: number;
        downtimeDays: number;
        bookingCount: number;
        revenueCents: number | null;
      }>;
      page: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
      from: number;
      to: number;
      hasPrev: boolean;
      hasNext: boolean;
    };
    recentBookings: {
      rows: Array<{
        id: string;
        publicId: string | null;
        start: string;
        end: string;
        status: string;
        customerName: string | null;
        totalCents: number | null;
        depositCents: number | null;
      }>;
      page: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
      from: number;
      to: number;
      hasPrev: boolean;
      hasNext: boolean;
    };
  };
};

function toDateOnlyUtc(input: Date) {
  const year = input.getUTCFullYear();
  const month = `${input.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${input.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysUtc(input: Date, days: number) {
  const next = new Date(input);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function defaultCustomRange() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return {
    start: toDateOnlyUtc(addDaysUtc(today, -89)),
    end: toDateOnlyUtc(today),
  };
}

function formatCurrency(cents: number | null) {
  if (!Number.isFinite(cents)) return "N/A";
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    maximumFractionDigits: 2,
  }).format((cents as number) / 100);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0.00%";
  return `${value.toFixed(2)}%`;
}

function formatStatus(value: string) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!normalized) return "UNKNOWN";
  return normalized.replace(/_/g, " ");
}

function statusTone(value: string) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (["CONFIRMED", "PICKED_UP", "ACTIVE", "IN_PROGRESS"].includes(normalized)) {
    return "border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
  }
  if (["RETURNED", "COMPLETED"].includes(normalized)) {
    return "border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]";
  }
  if (["CANCELLED", "NO_SHOW", "OVERRIDDEN"].includes(normalized)) {
    return "border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] text-[var(--ccr-status-danger-text)]";
  }
  return "border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] text-[var(--ccr-status-warning-text)]";
}

function fallbackData(): PerformanceData {
  return {
    range: {
      start: "",
      end: "",
    },
    kpis: {
      bookedDays: 0,
      availableDays: 0,
      utilizationPct: 0,
      revenueCents: null,
      depositCents: null,
      bookingCount: 0,
      avgBookingDays: null,
      downtimeDays: 0,
      maintenanceBlockouts: 0,
    },
    breakdown: {
      byMonth: {
        rows: [] as Array<{
          month: string;
          bookedDays: number;
          downtimeDays: number;
          bookingCount: number;
          revenueCents: number | null;
        }>,
        page: 1,
        pageSize: 5,
        totalCount: 0,
        totalPages: 1,
        from: 0,
        to: 0,
        hasPrev: false,
        hasNext: false,
      },
      recentBookings: {
        rows: [] as Array<{
          id: string;
          publicId: string | null;
          start: string;
          end: string;
          status: string;
          customerName: string | null;
          totalCents: number | null;
          depositCents: number | null;
        }>,
        page: 1,
        pageSize: 5,
        totalCount: 0,
        totalPages: 1,
        from: 0,
        to: 0,
        hasPrev: false,
        hasNext: false,
      },
    },
  };
}

export function VehiclePerformancePanel({ vehicleId }: VehiclePerformancePanelProps) {
  const [selectedRange, setSelectedRange] = useState<RangePreset>("90d");
  const [appliedRange, setAppliedRange] = useState<AppliedRange>({ preset: "90d" });
  const [customRange, setCustomRange] = useState(defaultCustomRange);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PerformanceData>(fallbackData);
  const [byMonthSort, setByMonthSort] = useState<ByMonthSortState>({
    sortBy: "month",
    sortDir: "asc",
  });
  const [byMonthPage, setByMonthPage] = useState(1);
  const [recentBookingsSort, setRecentBookingsSort] = useState<RecentBookingSortState>({
    sortBy: "dates",
    sortDir: "desc",
  });
  const [recentBookingsPage, setRecentBookingsPage] = useState(1);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("range", appliedRange.preset);
      if (appliedRange.preset === "custom") {
        if (appliedRange.start) params.set("start", appliedRange.start);
        if (appliedRange.end) params.set("end", appliedRange.end);
      }
      params.set("monthlySortBy", byMonthSort.sortBy);
      params.set("monthlySortDir", byMonthSort.sortDir);
      params.set("monthlyPage", String(byMonthPage));
      params.set("sortBy", recentBookingsSort.sortBy);
      params.set("sortDir", recentBookingsSort.sortDir);
      params.set("bookingsPage", String(recentBookingsPage));

      const response = await fetch(`/api/admin/vehicles/${vehicleId}/performance?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as PerformancePayload;

      if (!response.ok || !payload.ok || !payload.range || !payload.kpis || !payload.breakdown) {
        throw new Error(payload.error ?? "Failed to load vehicle performance.");
      }

      setData({
        range: payload.range,
        kpis: payload.kpis,
        breakdown: payload.breakdown,
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load vehicle performance.",
      );
      setData(fallbackData());
    } finally {
      setLoading(false);
    }
  }, [
    appliedRange.end,
    appliedRange.preset,
    appliedRange.start,
    byMonthPage,
    byMonthSort.sortBy,
    byMonthSort.sortDir,
    recentBookingsPage,
    recentBookingsSort.sortBy,
    recentBookingsSort.sortDir,
    vehicleId,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const hasBookings = data.kpis.bookingCount > 0;

  const rangeLabel = useMemo(() => {
    if (!data.range.start || !data.range.end) return "";
    return `${data.range.start} to ${data.range.end}`;
  }, [data.range.end, data.range.start]);

  function applyPreset(preset: Exclude<RangePreset, "custom">) {
    setSelectedRange(preset);
    setAppliedRange({ preset });
    setByMonthPage(1);
    setRecentBookingsPage(1);
  }

  function applyCustomRange() {
    if (!customRange.start || !customRange.end) {
      setError("Custom range requires both start and end dates.");
      return;
    }
    setSelectedRange("custom");
    setAppliedRange({ preset: "custom", start: customRange.start, end: customRange.end });
    setByMonthPage(1);
    setRecentBookingsPage(1);
  }

  function updateByMonthSort(next: SortState) {
    const sortBy = next.sortBy;
    const sortDir = next.sortDir;
    if (
      sortBy !== "month" &&
      sortBy !== "booked" &&
      sortBy !== "downtime" &&
      sortBy !== "bookings" &&
      sortBy !== "revenue"
    ) {
      return;
    }
    if (sortDir !== "asc" && sortDir !== "desc") {
      return;
    }
    setByMonthSort({ sortBy, sortDir });
    setByMonthPage(1);
  }

  function updateRecentBookingsSort(next: SortState) {
    const sortBy = next.sortBy;
    const sortDir = next.sortDir;
    if (
      sortBy !== "booking" &&
      sortBy !== "dates" &&
      sortBy !== "status" &&
      sortBy !== "customer" &&
      sortBy !== "total"
    ) {
      return;
    }
    if (sortDir !== "asc" && sortDir !== "desc") {
      return;
    }
    setRecentBookingsSort({ sortBy, sortDir });
    setRecentBookingsPage(1);
  }

  return (
    <section
      data-testid="vehicle-performance-panel"
      className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Performance</h2>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Utilization, revenue, and maintenance downtime for this vehicle.
          </p>
        </div>
        <p className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-muted)]">
          {rangeLabel || "Range pending"}
        </p>
      </div>

      <div
        data-testid="performance-range-selector"
        className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3"
      >
        <div className="flex flex-wrap gap-2">
          {(["30d", "90d", "365d"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`min-h-10 rounded-full border px-3 py-2 text-xs font-semibold transition ${
                selectedRange === preset
                  ? "border-[var(--ccr-accent)] bg-[var(--ccr-primary)] text-white"
                  : "border-[var(--ccr-border)] text-[var(--ccr-text)] hover:bg-[var(--ccr-surface)]"
              }`}
            >
              {preset.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedRange("custom")}
            className={`min-h-10 rounded-full border px-3 py-2 text-xs font-semibold transition ${
              selectedRange === "custom"
                ? "border-[var(--ccr-accent)] bg-[var(--ccr-primary)] text-white"
                : "border-[var(--ccr-border)] text-[var(--ccr-text)] hover:bg-[var(--ccr-surface)]"
            }`}
          >
            Custom
          </button>
        </div>

        {selectedRange === "custom" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--ccr-muted)]">Start date</span>
              <input
                type="date"
                value={customRange.start}
                onChange={(event) =>
                  setCustomRange((current) => ({ ...current, start: event.target.value }))
                }
                data-testid="performance-custom-start"
                className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--ccr-muted)]">End date</span>
              <input
                type="date"
                value={customRange.end}
                onChange={(event) =>
                  setCustomRange((current) => ({ ...current, end: event.target.value }))
                }
                data-testid="performance-custom-end"
                className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
              />
            </label>
            <button
              type="button"
              onClick={applyCustomRange}
              className="min-h-11 rounded-lg bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              Apply
            </button>
          </div>
        ) : null}
      </div>

      {loading ? <p className="mt-4 text-sm text-[var(--ccr-muted)]">Loading performance data...</p> : null}
      {error ? <p className="mt-4 text-sm text-[var(--ccr-status-danger-text)]">{error}</p> : null}

      {!loading ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <article
              data-testid="performance-kpi-utilization"
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Utilization</p>
              <p className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">{formatPercent(data.kpis.utilizationPct)}</p>
            </article>
            <article
              data-testid="performance-kpi-bookedDays"
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Booked days</p>
              <p className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">{data.kpis.bookedDays}</p>
            </article>
            <article
              data-testid="performance-kpi-downtimeDays"
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Downtime days</p>
              <p className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">{data.kpis.downtimeDays}</p>
            </article>
            <article className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Booking count</p>
              <p className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">{data.kpis.bookingCount}</p>
            </article>
            <article className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Revenue</p>
              <p className="mt-2 text-xl font-bold text-[var(--ccr-text)]">{formatCurrency(data.kpis.revenueCents)}</p>
            </article>
          </div>

          {!hasBookings ? (
            <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-5">
              <p className="text-sm font-semibold text-[var(--ccr-text)]">No bookings in this range.</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                Availability and maintenance downtime are still shown for the selected range.
              </p>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section
              data-testid="performance-byMonth-table"
              className="overflow-hidden rounded-xl border border-[var(--ccr-border)]"
            >
              <header className="border-b border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2">
                <h3 className="text-sm font-semibold text-[var(--ccr-text)]">By month</h3>
              </header>

              {data.breakdown.byMonth.rows.length === 0 ? (
                <p className="px-3 py-4 text-sm text-[var(--ccr-muted)]">No monthly data for this range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs sm:text-sm">
                    <thead className="border-b border-[var(--ccr-border)] text-[11px] uppercase tracking-wide text-[var(--ccr-muted)]">
                      <tr>
                        <SortableTh
                          label="Month"
                          columnKey="month"
                          sort={byMonthSort}
                          onChange={updateByMonthSort}
                          className="px-3 py-2"
                          defaultDirection="asc"
                        />
                        <SortableTh
                          label="Booked"
                          columnKey="booked"
                          sort={byMonthSort}
                          onChange={updateByMonthSort}
                          className="px-3 py-2"
                          defaultDirection="desc"
                        />
                        <SortableTh
                          label="Downtime"
                          columnKey="downtime"
                          sort={byMonthSort}
                          onChange={updateByMonthSort}
                          className="px-3 py-2"
                          defaultDirection="desc"
                        />
                        <SortableTh
                          label="Bookings"
                          columnKey="bookings"
                          sort={byMonthSort}
                          onChange={updateByMonthSort}
                          className="px-3 py-2"
                          defaultDirection="desc"
                        />
                        <SortableTh
                          label="Revenue"
                          columnKey="revenue"
                          sort={byMonthSort}
                          onChange={updateByMonthSort}
                          className="px-3 py-2"
                          defaultDirection="desc"
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {data.breakdown.byMonth.rows.map((row) => (
                        <tr key={row.month} className="border-b border-[var(--ccr-border)] last:border-b-0">
                          <td className="px-3 py-2 text-[var(--ccr-text)]">{row.month}</td>
                          <td className="px-3 py-2 text-[var(--ccr-text)]">{row.bookedDays}</td>
                          <td className="px-3 py-2 text-[var(--ccr-text)]">{row.downtimeDays}</td>
                          <td className="px-3 py-2 text-[var(--ccr-text)]">{row.bookingCount}</td>
                          <td className="px-3 py-2 text-[var(--ccr-text)]">{formatCurrency(row.revenueCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="border-t border-[var(--ccr-border)] px-3 py-2">
                    <PaginationSummary
                      from={data.breakdown.byMonth.from}
                      to={data.breakdown.byMonth.to}
                      totalCount={data.breakdown.byMonth.totalCount}
                      page={data.breakdown.byMonth.page}
                      totalPages={data.breakdown.byMonth.totalPages}
                      rightContent={
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setByMonthPage((current) => Math.max(1, current - 1))}
                            disabled={!data.breakdown.byMonth.hasPrev}
                            className={`rounded-lg border px-2 py-1 font-semibold ${
                              data.breakdown.byMonth.hasPrev
                                ? "border-[var(--ccr-border)] text-[var(--ccr-text)]"
                                : "cursor-not-allowed border-[var(--ccr-border)]/40 text-[var(--ccr-muted)]/60"
                            }`}
                          >
                            Prev
                          </button>
                          <span className="font-semibold text-[var(--ccr-text)]">
                            Page {data.breakdown.byMonth.page} of {data.breakdown.byMonth.totalPages}
                          </span>
                          <button
                            type="button"
                            onClick={() => setByMonthPage((current) => current + 1)}
                            disabled={!data.breakdown.byMonth.hasNext}
                            className={`rounded-lg border px-2 py-1 font-semibold ${
                              data.breakdown.byMonth.hasNext
                                ? "border-[var(--ccr-border)] text-[var(--ccr-text)]"
                                : "cursor-not-allowed border-[var(--ccr-border)]/40 text-[var(--ccr-muted)]/60"
                            }`}
                          >
                            Next
                          </button>
                        </div>
                      }
                    />
                  </div>
                </div>
              )}
            </section>

            <section
              data-testid="performance-recentBookings-table"
              className="overflow-hidden rounded-xl border border-[var(--ccr-border)]"
            >
              <header className="border-b border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2">
                <h3 className="text-sm font-semibold text-[var(--ccr-text)]">Recent bookings</h3>
              </header>

              {data.breakdown.recentBookings.rows.length === 0 ? (
                <p className="px-3 py-4 text-sm text-[var(--ccr-muted)]">No bookings found for this range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs sm:text-sm">
                    <thead className="border-b border-[var(--ccr-border)] text-[11px] uppercase tracking-wide text-[var(--ccr-muted)]">
                      <tr>
                        <SortableTh
                          label="Booking"
                          columnKey="booking"
                          sort={recentBookingsSort}
                          onChange={updateRecentBookingsSort}
                          className="px-3 py-2"
                          defaultDirection="asc"
                        />
                        <SortableTh
                          label="Dates"
                          columnKey="dates"
                          sort={recentBookingsSort}
                          onChange={updateRecentBookingsSort}
                          className="px-3 py-2"
                          defaultDirection="desc"
                        />
                        <SortableTh
                          label="Status"
                          columnKey="status"
                          sort={recentBookingsSort}
                          onChange={updateRecentBookingsSort}
                          className="px-3 py-2"
                          defaultDirection="asc"
                        />
                        <SortableTh
                          label="Customer"
                          columnKey="customer"
                          sort={recentBookingsSort}
                          onChange={updateRecentBookingsSort}
                          className="px-3 py-2"
                          defaultDirection="asc"
                        />
                        <SortableTh
                          label="Total"
                          columnKey="total"
                          sort={recentBookingsSort}
                          onChange={updateRecentBookingsSort}
                          className="px-3 py-2"
                          defaultDirection="desc"
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {data.breakdown.recentBookings.rows.map((row) => (
                        <tr key={row.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                          <td className="px-3 py-2 text-[var(--ccr-text)]">
                            <Link
                              href={`/admin/bookings/${row.id}`}
                              className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                              title="Open booking"
                            >
                              {row.publicId?.trim() || row.id}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-[var(--ccr-text)]">
                            <div className="space-y-1">
                              <p>
                                <TableDateTime value={row.start} />
                              </p>
                              <p>
                                <TableDateTime value={row.end} />
                              </p>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-semibold ${statusTone(
                                row.status,
                              )}`}
                            >
                              {formatStatus(row.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[var(--ccr-text)]">
                            {row.customerName?.trim() || "Unknown customer"}
                          </td>
                          <td className="px-3 py-2 text-[var(--ccr-text)]">{formatCurrency(row.totalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="border-t border-[var(--ccr-border)] px-3 py-2">
                    <PaginationSummary
                      from={data.breakdown.recentBookings.from}
                      to={data.breakdown.recentBookings.to}
                      totalCount={data.breakdown.recentBookings.totalCount}
                      page={data.breakdown.recentBookings.page}
                      totalPages={data.breakdown.recentBookings.totalPages}
                      rightContent={
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setRecentBookingsPage((current) => Math.max(1, current - 1))
                            }
                            disabled={!data.breakdown.recentBookings.hasPrev}
                            className={`rounded-lg border px-2 py-1 font-semibold ${
                              data.breakdown.recentBookings.hasPrev
                                ? "border-[var(--ccr-border)] text-[var(--ccr-text)]"
                                : "cursor-not-allowed border-[var(--ccr-border)]/40 text-[var(--ccr-muted)]/60"
                            }`}
                          >
                            Prev
                          </button>
                          <span className="font-semibold text-[var(--ccr-text)]">
                            Page {data.breakdown.recentBookings.page} of {data.breakdown.recentBookings.totalPages}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setRecentBookingsPage((current) => current + 1)
                            }
                            disabled={!data.breakdown.recentBookings.hasNext}
                            className={`rounded-lg border px-2 py-1 font-semibold ${
                              data.breakdown.recentBookings.hasNext
                                ? "border-[var(--ccr-border)] text-[var(--ccr-text)]"
                                : "cursor-not-allowed border-[var(--ccr-border)]/40 text-[var(--ccr-muted)]/60"
                            }`}
                          >
                            Next
                          </button>
                        </div>
                      }
                    />
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
}
