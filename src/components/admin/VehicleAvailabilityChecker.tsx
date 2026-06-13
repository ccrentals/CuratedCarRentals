"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { TableDateTime } from "@/components/shared/TableDateTime";

type DiagnosticRow = {
  vehicle: {
    id: string;
    publicId?: string | null;
    make: string;
    model: string;
    year?: number | null;
    derivedStatus?: string | null;
    publicVisible?: boolean;
  };
  available: boolean;
  publicEligible: boolean;
  reasonCode: string;
  reason: string;
  conflict: {
    type: "BOOKING" | "BLOCKOUT";
    startAt: string;
    endAt: string;
    publicId?: string | null;
    reason?: string;
  } | null;
  conflictLink: string | null;
  vehicleLink: string;
};

type Payload = {
  ok?: boolean;
  rows?: DiagnosticRow[];
  error?: string;
};

type ResultFilter = "ALL" | "AVAILABLE" | "UNAVAILABLE";
type VisibilityFilter = "ALL" | "PUBLIC" | "PRIVATE";

function jamaicaDateParts(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function label(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function VehicleAvailabilityChecker({
  initialPickupDate,
  initialPickupTime,
  initialDropoffDate,
  initialDropoffTime,
}: {
  initialPickupDate?: string;
  initialPickupTime?: string;
  initialDropoffDate?: string;
  initialDropoffTime?: string;
}) {
  const [pickupDate, setPickupDate] = useState(initialPickupDate || jamaicaDateParts());
  const [pickupTime, setPickupTime] = useState(initialPickupTime || "10:00");
  const [dropoffDate, setDropoffDate] = useState(initialDropoffDate || jamaicaDateParts(2));
  const [dropoffTime, setDropoffTime] = useState(initialDropoffTime || "10:00");
  const [rows, setRows] = useState<DiagnosticRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("ALL");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("ALL");
  const [reasonFilter, setReasonFilter] = useState("ALL");
  const [query, setQuery] = useState("");

  const reasonOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.reasonCode))).sort(),
    [rows],
  );
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (resultFilter === "AVAILABLE" && !row.available) return false;
      if (resultFilter === "UNAVAILABLE" && row.available) return false;
      if (visibilityFilter === "PUBLIC" && !row.vehicle.publicVisible) return false;
      if (visibilityFilter === "PRIVATE" && row.vehicle.publicVisible) return false;
      if (reasonFilter !== "ALL" && row.reasonCode !== reasonFilter) return false;
      if (
        normalizedQuery &&
        !`${row.vehicle.publicId ?? ""} ${row.vehicle.make} ${row.vehicle.model}`
          .toLowerCase()
          .includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });
  }, [query, reasonFilter, resultFilter, rows, visibilityFilter]);

  async function runCheck() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ pickupDate, pickupTime, dropoffDate, dropoffTime });
    try {
      const response = await fetch(`/api/admin/vehicles/availability-diagnostics?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to check availability.");
      }
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setHasRun(true);
    } catch (requestError) {
      setRows([]);
      setHasRun(true);
      setError(requestError instanceof Error ? requestError.message : "Failed to check availability.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      data-testid="vehicle-availability-checker"
      className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 sm:p-6"
    >
      <div>
        <h2 className="text-lg font-bold text-[var(--ccr-text)]">Availability Checker</h2>
        <p className="mt-1 text-sm text-[var(--ccr-muted)]">
          See every vehicle and the exact reason it can or cannot be booked for a Jamaica-time window.
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1 text-xs font-semibold text-[var(--ccr-muted)]">
          Pickup date
          <input type="date" value={pickupDate} onChange={(event) => setPickupDate(event.currentTarget.value)} className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--ccr-muted)]">
          Pickup time
          <input type="time" value={pickupTime} onChange={(event) => setPickupTime(event.currentTarget.value)} className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--ccr-muted)]">
          Drop-off date
          <input type="date" value={dropoffDate} onChange={(event) => setDropoffDate(event.currentTarget.value)} className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--ccr-muted)]">
          Drop-off time
          <input type="time" value={dropoffTime} onChange={(event) => setDropoffTime(event.currentTarget.value)} className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]" />
        </label>
        <button type="button" onClick={() => void runCheck()} disabled={loading} className="min-h-11 self-end rounded-lg bg-[var(--ccr-primary)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
          {loading ? "Checking..." : "Check fleet"}
        </button>
      </div>

      {error ? <p className="mt-4 text-sm text-[var(--ccr-status-danger-text)]">{error}</p> : null}

      {hasRun && !error ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search vehicle" aria-label="Search availability results" className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]" />
            <select value={resultFilter} onChange={(event) => setResultFilter(event.currentTarget.value as ResultFilter)} aria-label="Availability result" className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]">
              <option value="ALL">All results</option>
              <option value="AVAILABLE">Available</option>
              <option value="UNAVAILABLE">Unavailable</option>
            </select>
            <select value={reasonFilter} onChange={(event) => setReasonFilter(event.currentTarget.value)} aria-label="Availability reason" className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]">
              <option value="ALL">All reasons</option>
              {reasonOptions.map((reason) => <option key={reason} value={reason}>{label(reason)}</option>)}
            </select>
            <select value={visibilityFilter} onChange={(event) => setVisibilityFilter(event.currentTarget.value as VisibilityFilter)} aria-label="Vehicle visibility" className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]">
              <option value="ALL">All visibility</option>
              <option value="PUBLIC">Public</option>
              <option value="PRIVATE">Private</option>
            </select>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--ccr-border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--ccr-border)] text-xs uppercase text-[var(--ccr-muted)]">
                <tr>
                  <th className="px-3 py-2">Vehicle</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Current state</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Conflict window</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.vehicle.id} className="border-b border-[var(--ccr-border)] last:border-0">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-[var(--ccr-text)]">{row.vehicle.year} {row.vehicle.make} {row.vehicle.model}</p>
                      <p className="text-xs text-[var(--ccr-muted)]">{row.vehicle.publicId ?? row.vehicle.id.slice(0, 8)} · {row.vehicle.publicVisible ? "Public" : "Private"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${row.available ? "border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]" : "border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] text-[var(--ccr-status-danger-text)]"}`}>
                        {row.available ? "Available" : "Unavailable"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[var(--ccr-text)]">{label(row.vehicle.derivedStatus)}</td>
                    <td className="max-w-sm px-3 py-3">
                      <p className="font-semibold text-[var(--ccr-text)]">{label(row.reasonCode)}</p>
                      <p className="text-xs text-[var(--ccr-muted)]">{row.reason}</p>
                    </td>
                    <td className="px-3 py-3 text-[var(--ccr-text)]">
                      {row.conflict ? <><TableDateTime value={row.conflict.startAt} /><span className="mx-1 text-[var(--ccr-muted)]">to</span><TableDateTime value={row.conflict.endAt} /></> : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link href={row.vehicleLink} className="rounded-lg border border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]">Vehicle</Link>
                        {row.conflictLink ? <Link href={row.conflictLink} className="rounded-lg border border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]">Conflict</Link> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredRows.length === 0 ? <p className="px-4 py-6 text-sm text-[var(--ccr-muted)]">No vehicles match these filters.</p> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
