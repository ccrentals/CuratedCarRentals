"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TableDateTime } from "@/components/shared/TableDateTime";

type ReservationView = "upcoming" | "history";
type EventType = "ALL" | "BOOKING" | "BLOCKOUT" | "MAINTENANCE";

type VehicleHistoryRow = {
  id: string;
  publicId: string | null;
  eventType: Exclude<EventType, "ALL">;
  customerName: string | null;
  customerEmail: string | null;
  pickupAt: string;
  returnAt: string;
  status: string;
  totalCents: number | null;
  depositCents: number | null;
  source: string;
  activeNow: boolean;
  impactsAvailability: boolean;
  actionHref: string;
  createdAt: string;
};

type VehicleHistorySummary = {
  upcomingCount: number;
  onRentCount: number;
  completedCount: number;
  cancelledCount: number;
  activeBlockoutCount: number;
};

type VehicleHistoryPayload = {
  ok: boolean;
  rows?: VehicleHistoryRow[];
  summary?: VehicleHistorySummary;
  paging?: { limit: number; offset: number; total: number };
  statuses?: string[];
  error?: string;
};

const LIMIT = 50;

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function displayLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusTone(status: string) {
  const normalized = status.toUpperCase();
  if (["CANCELLED", "OVERRIDDEN", "NO_SHOW", "VOID"].includes(normalized)) {
    return "border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] text-[var(--ccr-status-danger-text)]";
  }
  if (["RETURNED", "COMPLETED"].includes(normalized)) {
    return "border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]";
  }
  return "border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
}

export function VehicleReservationsPanel({ vehicleId }: { vehicleId: string }) {
  const initialToday = useMemo(todayUtc, []);
  const [view, setView] = useState<ReservationView>("upcoming");
  const [eventType, setEventType] = useState<EventType>("ALL");
  const [status, setStatus] = useState("ALL");
  const [query, setQuery] = useState("");
  const [start, setStart] = useState(initialToday);
  const [end, setEnd] = useState(addDays(initialToday, 30));
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<VehicleHistoryRow[]>([]);
  const [summary, setSummary] = useState<VehicleHistorySummary>({
    upcomingCount: 0,
    onRentCount: 0,
    completedCount: 0,
    cancelledCount: 0,
    activeBlockoutCount: 0,
  });
  const [total, setTotal] = useState(0);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ view, eventType, status });
    if (query.trim()) params.set("q", query.trim());
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    return `/api/admin/vehicles/${vehicleId}/reservations/export?${params}`;
  }, [end, eventType, query, start, status, vehicleId, view]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      view,
      eventType,
      status,
      limit: String(LIMIT),
      offset: String(offset),
    });
    if (query.trim()) params.set("q", query.trim());
    if (start) params.set("start", start);
    if (end) params.set("end", end);

    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/reservations?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as VehicleHistoryPayload;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Failed to load vehicle history.");
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setSummary(payload.summary ?? {
        upcomingCount: 0,
        onRentCount: 0,
        completedCount: 0,
        cancelledCount: 0,
        activeBlockoutCount: 0,
      });
      setTotal(Number(payload.paging?.total ?? 0));
      setStatuses(Array.isArray(payload.statuses) ? payload.statuses : []);
    } catch (requestError) {
      setRows([]);
      setTotal(0);
      setError(requestError instanceof Error ? requestError.message : "Failed to load vehicle history.");
    } finally {
      setLoading(false);
    }
  }, [end, eventType, offset, query, start, status, vehicleId, view]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function switchView(nextView: ReservationView) {
    setView(nextView);
    setStatus("ALL");
    setEventType("ALL");
    setQuery("");
    setOffset(0);
    if (nextView === "history") {
      setStart("");
      setEnd("");
    } else {
      setStart(initialToday);
      setEnd(addDays(initialToday, 30));
    }
  }

  const cards = [
    ["On Rent Now", summary.onRentCount],
    ["Upcoming", summary.upcomingCount],
    ["Completed", summary.completedCount],
    ["Cancelled", summary.cancelledCount],
    ["Active Blockouts", summary.activeBlockoutCount],
  ] as const;

  return (
    <section data-testid="vehicle-reservations-panel" className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Vehicle History</h2>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Bookings, cancellations, blockouts, and maintenance availability events.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={exportHref} className="inline-flex min-h-10 items-center rounded-lg border border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]">Export CSV</a>
          <div className="inline-flex rounded-lg border border-[var(--ccr-border)] p-1">
            <button type="button" data-testid="vehicle-reservations-upcoming" onClick={() => switchView("upcoming")} className={`min-h-9 rounded-md px-3 text-xs font-semibold ${view === "upcoming" ? "bg-[var(--ccr-primary)] text-white" : "text-[var(--ccr-text)]"}`}>Upcoming</button>
            <button type="button" data-testid="vehicle-reservations-history" onClick={() => switchView("history")} className={`min-h-9 rounded-md px-3 text-xs font-semibold ${view === "history" ? "bg-[var(--ccr-primary)] text-white" : "text-[var(--ccr-text)]"}`}>All History</button>
          </div>
        </div>
      </div>

      <div data-testid="vehicle-reservations-summary" className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(([title, value]) => (
          <article key={title} className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase text-[var(--ccr-muted)]">{title}</p>
            <p className="mt-1 text-xl font-bold text-[var(--ccr-text)]">{value}</p>
          </article>
        ))}
      </div>

      <div data-testid="vehicle-reservations-filters" className="mt-4 grid gap-3 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1 text-xs text-[var(--ccr-muted)]">Start date<input type="date" value={start} onChange={(event) => { setStart(event.currentTarget.value); setOffset(0); }} className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]" /></label>
        <label className="grid gap-1 text-xs text-[var(--ccr-muted)]">End date<input type="date" value={end} onChange={(event) => { setEnd(event.currentTarget.value); setOffset(0); }} className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]" /></label>
        <label className="grid gap-1 text-xs text-[var(--ccr-muted)]">Event type<select value={eventType} onChange={(event) => { setEventType(event.currentTarget.value as EventType); setOffset(0); }} className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"><option value="ALL">All events</option><option value="BOOKING">Bookings</option><option value="BLOCKOUT">Blockouts</option><option value="MAINTENANCE">Maintenance</option></select></label>
        <label className="grid gap-1 text-xs text-[var(--ccr-muted)]">Status<select value={status} onChange={(event) => { setStatus(event.currentTarget.value); setOffset(0); }} className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"><option value="ALL">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{displayLabel(item)}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-[var(--ccr-muted)]">Search<input type="search" value={query} onChange={(event) => { setQuery(event.currentTarget.value); setOffset(0); }} placeholder="ID, customer, source" className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]" /></label>
      </div>

      {loading ? <p className="mt-4 text-sm text-[var(--ccr-muted)]">Loading vehicle history...</p> : null}
      {error ? <p className="mt-4 text-sm text-[var(--ccr-status-danger-text)]">{error}</p> : null}

      <div className="mt-4" data-testid="vehicle-reservations-table">
        {!loading && !error && rows.length === 0 ? (
          <div className="rounded-lg border border-[var(--ccr-border)] px-4 py-5 text-sm text-[var(--ccr-muted)]" data-testid={view === "upcoming" ? "vehicle-reservations-empty-upcoming" : "vehicle-reservations-empty-history"}>
            No vehicle events match these filters.
          </div>
        ) : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-[var(--ccr-border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--ccr-border)] text-xs uppercase text-[var(--ccr-muted)]">
                <tr><th className="px-3 py-2">Event</th><th className="px-3 py-2">Reference / Customer</th><th className="px-3 py-2">Start</th><th className="px-3 py-2">End</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Active now</th><th className="px-3 py-2">Availability</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Action</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.eventType}-${row.id}`} data-testid="vehicle-reservation-row" className="border-b border-[var(--ccr-border)] last:border-0">
                    <td className="px-3 py-3 font-semibold text-[var(--ccr-text)]">{displayLabel(row.eventType)}</td>
                    <td className="px-3 py-3"><p className="font-mono text-xs text-[var(--ccr-text)]">{row.publicId ?? row.id.slice(0, 8)}</p>{row.customerName ? <><p className="font-semibold text-[var(--ccr-text)]">{row.customerName}</p><p className="text-xs text-[var(--ccr-muted)]">{row.customerEmail ?? "—"}</p></> : null}</td>
                    <td className="px-3 py-3 text-[var(--ccr-text)]"><TableDateTime value={row.pickupAt} /></td>
                    <td className="px-3 py-3 text-[var(--ccr-text)]"><TableDateTime value={row.returnAt} /></td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(row.status)}`}>{displayLabel(row.status)}</span></td>
                    <td className="px-3 py-3 text-[var(--ccr-text)]">{row.activeNow ? "Yes" : "No"}</td>
                    <td className="px-3 py-3 text-[var(--ccr-text)]">{row.impactsAvailability ? "Blocks" : "No impact"}</td>
                    <td className="px-3 py-3 text-[var(--ccr-muted)]">{displayLabel(row.source)}</td>
                    <td className="px-3 py-3"><Link href={row.actionHref} className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] px-3 text-xs font-semibold text-[var(--ccr-text)]">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--ccr-muted)]">
        <p>Showing {rows.length} of {total} events</p>
        <div className="flex gap-2">
          <button type="button" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - LIMIT))} className="min-h-9 rounded-lg border border-[var(--ccr-border)] px-3 font-semibold text-[var(--ccr-text)] disabled:opacity-50">Previous</button>
          <button type="button" disabled={offset + rows.length >= total} onClick={() => setOffset((value) => value + LIMIT)} className="min-h-9 rounded-lg border border-[var(--ccr-border)] px-3 font-semibold text-[var(--ccr-text)] disabled:opacity-50">Next</button>
        </div>
      </div>
    </section>
  );
}
