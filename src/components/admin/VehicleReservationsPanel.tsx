"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TableDateTime } from "@/components/shared/TableDateTime";

type ReservationView = "upcoming" | "history";

type VehicleReservationRow = {
  id: string;
  customerName: string;
  customerEmail: string | null;
  pickupAt: string;
  returnAt: string;
  status: string;
  totalCents: number | null;
  depositCents: number | null;
  createdAt: string;
};

type VehicleReservationsSummary = {
  upcomingCount: number;
  activeCount: number;
  completedCount: number;
  cancelledCount: number;
};

type VehicleReservationsPayload = {
  ok: boolean;
  rows?: VehicleReservationRow[];
  summary?: VehicleReservationsSummary;
  paging?: {
    limit: number;
    offset: number;
    total: number;
  };
  statuses?: string[];
  error?: string;
};

type VehicleReservationsPanelProps = {
  vehicleId: string;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function dateOnlyUtc(input: Date) {
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

function defaultsForView(view: ReservationView) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (view === "history") {
    return {
      start: dateOnlyUtc(addDaysUtc(today, -90)),
      end: dateOnlyUtc(today),
    };
  }

  return {
    start: dateOnlyUtc(today),
    end: dateOnlyUtc(addDaysUtc(today, 30)),
  };
}

function formatCurrency(cents: number | null) {
  if (!Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    maximumFractionDigits: 2,
  }).format((cents as number) / 100);
}

function formatStatus(status: string) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();
  if (!normalized) return "Unknown";
  return normalized.replace(/_/g, " ");
}

function statusTone(status: string) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  if (["CANCELLED", "OVERRIDDEN", "NO_SHOW"].includes(normalized)) {
    return "border-rose-300/40 bg-rose-500/15 text-rose-100";
  }
  if (["PICKED_UP", "ACTIVE", "IN_PROGRESS", "CONFIRMED"].includes(normalized)) {
    return "border-cyan-300/35 bg-cyan-500/15 text-cyan-100";
  }
  if (["RETURNED", "COMPLETED"].includes(normalized)) {
    return "border-emerald-300/40 bg-emerald-500/15 text-emerald-100";
  }
  return "border-amber-300/45 bg-amber-500/15 text-amber-100";
}

export function VehicleReservationsPanel({ vehicleId }: VehicleReservationsPanelProps) {
  const [view, setView] = useState<ReservationView>("upcoming");
  const [status, setStatus] = useState("ALL");
  const [query, setQuery] = useState("");
  const [start, setStart] = useState(() => defaultsForView("upcoming").start);
  const [end, setEnd] = useState(() => defaultsForView("upcoming").end);
  const [limit] = useState(DEFAULT_LIMIT);
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<VehicleReservationRow[]>([]);
  const [summary, setSummary] = useState<VehicleReservationsSummary>({
    upcomingCount: 0,
    activeCount: 0,
    completedCount: 0,
    cancelledCount: 0,
  });
  const [total, setTotal] = useState(0);
  const [statusOptions, setStatusOptions] = useState<string[]>(["ALL"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPrev = offset > 0;
  const hasNext = offset + rows.length < total;

  const panelStateLabel = useMemo(() => {
    const upper = view.toUpperCase();
    return upper === "UPCOMING" ? "Upcoming" : "History";
  }, [view]);
  const reservationsExportHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("view", view);
    params.set("status", status);
    if (query.trim()) params.set("q", query.trim());
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    return `/api/admin/vehicles/${vehicleId}/reservations/export?${params.toString()}`;
  }, [end, query, start, status, vehicleId, view]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("view", view);
      params.set("status", status);
      if (query.trim()) params.set("q", query.trim());
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      params.set("limit", String(Math.min(MAX_LIMIT, Math.max(1, limit))));
      params.set("offset", String(Math.max(0, offset)));

      const response = await fetch(
        `/api/admin/vehicles/${vehicleId}/reservations?${params.toString()}`,
        {
          cache: "no-store",
        },
      );

      const payload = (await response.json().catch(() => ({}))) as VehicleReservationsPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to load reservations.");
      }

      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setSummary(
        payload.summary ?? {
          upcomingCount: 0,
          activeCount: 0,
          completedCount: 0,
          cancelledCount: 0,
        },
      );
      setTotal(Number(payload.paging?.total ?? 0));

      const nextStatusOptions = Array.isArray(payload.statuses) && payload.statuses.length > 0
        ? ["ALL", ...payload.statuses.filter((value) => value !== "ALL")]
        : ["ALL"];
      setStatusOptions(nextStatusOptions);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load reservations.",
      );
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [end, limit, offset, query, start, status, vehicleId, view]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const applyView = (nextView: ReservationView) => {
    if (nextView === view) return;
    const nextDefaults = defaultsForView(nextView);
    setView(nextView);
    setStatus("ALL");
    setQuery("");
    setStart(nextDefaults.start);
    setEnd(nextDefaults.end);
    setOffset(0);
  };

  const resetFilters = () => {
    const nextDefaults = defaultsForView(view);
    setStatus("ALL");
    setQuery("");
    setStart(nextDefaults.start);
    setEnd(nextDefaults.end);
    setOffset(0);
  };

  return (
    <section
      data-testid="vehicle-reservations-panel"
      className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Reservations</h2>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Vehicle-specific bookings with upcoming and history filters.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={reservationsExportHref}
            className="inline-flex min-h-10 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Export CSV
          </a>
          <div className="inline-flex items-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-1">
            <button
              type="button"
              data-testid="vehicle-reservations-upcoming"
              onClick={() => applyView("upcoming")}
              className={`min-h-10 rounded-full px-3 py-2 text-xs font-semibold transition ${
                view === "upcoming"
                  ? "bg-[var(--ccr-primary)] text-white"
                  : "text-[var(--ccr-text)]"
              }`}
            >
              Upcoming
            </button>
            <button
              type="button"
              data-testid="vehicle-reservations-history"
              onClick={() => applyView("history")}
              className={`min-h-10 rounded-full px-3 py-2 text-xs font-semibold transition ${
                view === "history"
                  ? "bg-[var(--ccr-primary)] text-white"
                  : "text-[var(--ccr-text)]"
              }`}
            >
              History
            </button>
          </div>
        </div>
      </div>

      <div
        data-testid="vehicle-reservations-summary"
        className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <article className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Upcoming</p>
          <p className="mt-1 text-xl font-bold text-[var(--ccr-text)]">{summary.upcomingCount}</p>
        </article>
        <article className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Active</p>
          <p className="mt-1 text-xl font-bold text-[var(--ccr-text)]">{summary.activeCount}</p>
        </article>
        <article className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Completed</p>
          <p className="mt-1 text-xl font-bold text-[var(--ccr-text)]">{summary.completedCount}</p>
        </article>
        <article className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Cancelled</p>
          <p className="mt-1 text-xl font-bold text-[var(--ccr-text)]">{summary.cancelledCount}</p>
        </article>
      </div>

      <div
        data-testid="vehicle-reservations-filters"
        className="mt-4 grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3 lg:grid-cols-5"
      >
        <label className="grid gap-1 text-xs text-[var(--ccr-muted)]">
          Start date
          <input
            type="date"
            value={start}
            onChange={(event) => {
              setStart(event.currentTarget.value);
              setOffset(0);
            }}
            className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
          />
        </label>

        <label className="grid gap-1 text-xs text-[var(--ccr-muted)]">
          End date
          <input
            type="date"
            value={end}
            onChange={(event) => {
              setEnd(event.currentTarget.value);
              setOffset(0);
            }}
            className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
          />
        </label>

        <label className="grid gap-1 text-xs text-[var(--ccr-muted)]">
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.currentTarget.value);
              setOffset(0);
            }}
            className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option === "ALL" ? "All" : formatStatus(option)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs text-[var(--ccr-muted)] lg:col-span-2">
          Search (reservation id, customer name, email)
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setOffset(0);
            }}
            placeholder="Search reservations"
            className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
          />
        </label>

        <div className="lg:col-span-5">
          <button
            type="button"
            onClick={resetFilters}
            className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {loading ? <p className="mt-4 text-sm text-[var(--ccr-muted)]">Loading reservations…</p> : null}
      {error ? <p className="mt-4 text-sm text-red-500">{error}</p> : null}

      <div className="mt-4" data-testid="vehicle-reservations-table">
        {!loading && !error && rows.length === 0 ? (
          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-5">
            <p
              data-testid={
                view === "upcoming"
                  ? "vehicle-reservations-empty-upcoming"
                  : "vehicle-reservations-empty-history"
              }
              className="text-sm font-semibold text-[var(--ccr-text)]"
            >
              {view === "upcoming"
                ? "No upcoming reservations for this vehicle"
                : "No reservations match your filters"}
            </p>
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-[var(--ccr-border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                <tr>
                  <th className="px-3 py-2">Reservation</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Pickup</th>
                  <th className="px-3 py-2">Return</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Total / Deposit</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-testid="vehicle-reservation-row"
                    data-booking-id={row.id}
                    className="border-b border-[var(--ccr-border)] last:border-b-0"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-[var(--ccr-text)]">{row.id.slice(0, 8)}</td>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-[var(--ccr-text)]">{row.customerName}</p>
                      <p className="text-xs text-[var(--ccr-muted)]">{row.customerEmail ?? "—"}</p>
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">
                      <TableDateTime value={row.pickupAt} />
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">
                      <TableDateTime value={row.returnAt} />
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(
                          row.status,
                        )}`}
                      >
                        {formatStatus(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--ccr-muted)]">
                      <p>Total: {formatCurrency(row.totalCents)}</p>
                      <p>Deposit: {formatCurrency(row.depositCents)}</p>
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">
                      <TableDateTime value={row.createdAt} />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/bookings/${row.id}`}
                        className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--ccr-muted)]">
        <p>
          {panelStateLabel} reservations: showing {rows.length} of {total}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => setOffset((current) => Math.max(0, current - limit))}
            className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-1 font-semibold text-[var(--ccr-text)] disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => setOffset((current) => current + limit)}
            className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-1 font-semibold text-[var(--ccr-text)] disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
