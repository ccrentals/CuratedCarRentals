"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type VehicleStatus = "AVAILABLE" | "RESERVED" | "RENTED" | "MAINTENANCE" | "INACTIVE";

type VehicleRow = {
  id: string;
  public_id: string;
  make: string;
  model: string;
  year: number;
  seat_count: number | null;
  daily_rate_cents: number;
  deposit_cents: number;
  status: VehicleStatus;
  created_at: string;
  deleted_at: string | null;
};

type VehicleFormDraft = {
  make: string;
  model: string;
  year: string;
  seatCount: string;
  dailyRateCents: string;
  depositCents: string;
  status: VehicleStatus;
};

const VEHICLE_STATUSES: VehicleStatus[] = [
  "AVAILABLE",
  "RESERVED",
  "RENTED",
  "MAINTENANCE",
  "INACTIVE",
];

const DEFAULT_DRAFT: VehicleFormDraft = {
  make: "",
  model: "",
  year: String(new Date().getFullYear()),
  seatCount: "",
  dailyRateCents: "",
  depositCents: "",
  status: "AVAILABLE",
};

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function vehicleLabel(vehicle: Pick<VehicleRow, "year" | "make" | "model">): string {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim();
}

export function SettingsVehiclesPanel() {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<VehicleFormDraft>(DEFAULT_DRAFT);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VehicleRow | null>(null);

  const loadVehicles = useCallback(async (archivedOnly = showArchived) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        archivedOnly ? "/api/admin/vehicles?includeDeleted=1" : "/api/admin/vehicles",
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        vehicles?: VehicleRow[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load vehicles.");
      }
      setVehicles(Array.isArray(payload.vehicles) ? payload.vehicles : []);
    } catch (loadError) {
      setVehicles([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load vehicles.");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    void loadVehicles(showArchived);
  }, [loadVehicles, showArchived]);

  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return vehicles;
    return vehicles.filter((vehicle) => {
      const text = [
        vehicle.public_id,
        vehicle.make,
        vehicle.model,
        String(vehicle.year),
        vehicle.status,
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(query);
    });
  }, [search, vehicles]);

  async function createVehicle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const make = form.make.trim();
    const model = form.model.trim();
    const year = Number.parseInt(form.year, 10);
    const dailyRateCents = Number.parseInt(form.dailyRateCents, 10);
    const depositCents = Number.parseInt(form.depositCents, 10);
    const seatCount = form.seatCount.trim()
      ? Number.parseInt(form.seatCount.trim(), 10)
      : null;

    if (!make || !model) {
      setError("Make and model are required.");
      return;
    }
    if (!Number.isFinite(year)) {
      setError("Year is required.");
      return;
    }
    if (!Number.isFinite(dailyRateCents) || dailyRateCents <= 0) {
      setError("Daily rate (cents) must be greater than 0.");
      return;
    }
    if (!Number.isFinite(depositCents) || depositCents < 0) {
      setError("Deposit (cents) must be 0 or greater.");
      return;
    }
    if (seatCount !== null && (!Number.isFinite(seatCount) || seatCount < 1 || seatCount > 60)) {
      setError("Seats must be between 1 and 60.");
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/vehicles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          make,
          model,
          year,
          seat_count: seatCount,
          daily_rate_cents: dailyRateCents,
          deposit_cents: depositCents,
          status: form.status,
          csrfToken: csrfToken ?? "",
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create vehicle.");
      }

      setForm(DEFAULT_DRAFT);
      setShowArchived(false);
      setStatus("Vehicle added.");
      await loadVehicles(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create vehicle.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setError(null);
    setStatus(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/vehicles/${deleteTarget.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ csrfToken: csrfToken ?? "" }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to delete vehicle.");
      }

      setDeleteTarget(null);
      setStatus("Vehicle deleted and removed from the fleet list.");
      await loadVehicles(showArchived);
    } catch (deleteError) {
      setDeleteTarget(null);
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete vehicle.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6" data-testid="settings-panel-vehicles">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--ccr-text)]">Vehicle Management</h2>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Add vehicles to the fleet, review existing inventory, and remove vehicles safely.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
            className="h-4 w-4 accent-[var(--ccr-accent)]"
          />
          Show archived vehicles
        </label>
      </div>

      <form onSubmit={createVehicle} className="mt-5 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Add vehicle</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Make
            <input
              value={form.make}
              onChange={(event) => setForm((current) => ({ ...current, make: event.target.value }))}
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm font-medium normal-case text-[var(--ccr-text)]"
              placeholder="Toyota"
              required
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Model
            <input
              value={form.model}
              onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm font-medium normal-case text-[var(--ccr-text)]"
              placeholder="Corolla"
              required
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Year
            <input
              value={form.year}
              onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))}
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm font-medium normal-case text-[var(--ccr-text)]"
              inputMode="numeric"
              required
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Seats (optional)
            <input
              value={form.seatCount}
              onChange={(event) => setForm((current) => ({ ...current, seatCount: event.target.value }))}
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm font-medium normal-case text-[var(--ccr-text)]"
              inputMode="numeric"
              placeholder="5"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Daily rate (cents)
            <input
              value={form.dailyRateCents}
              onChange={(event) =>
                setForm((current) => ({ ...current, dailyRateCents: event.target.value }))
              }
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm font-medium normal-case text-[var(--ccr-text)]"
              inputMode="numeric"
              placeholder="12500"
              required
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Deposit (cents)
            <input
              value={form.depositCents}
              onChange={(event) =>
                setForm((current) => ({ ...current, depositCents: event.target.value }))
              }
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm font-medium normal-case text-[var(--ccr-text)]"
              inputMode="numeric"
              placeholder="5000"
              required
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Status
            <select
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({ ...current, status: event.target.value as VehicleStatus }))
              }
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm font-medium normal-case text-[var(--ccr-text)]"
            >
              {VEHICLE_STATUSES.map((statusOption) => (
                <option key={statusOption} value={statusOption}>
                  {statusOption}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--ccr-muted)]">Tip: enter amounts in cents to match fleet pricing.</p>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] transition hover:bg-[var(--ccr-accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Adding…" : "Add vehicle"}
          </button>
        </div>
      </form>

      {status ? (
        <p className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="mt-5 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            {showArchived ? "Archived vehicles" : "Active fleet"}
          </h3>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full max-w-sm rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            placeholder="Search make, model, year, public id"
          />
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr className="border-b border-[var(--ccr-border)]">
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Daily rate</th>
                <th className="px-3 py-2">Deposit</th>
                <th className="px-3 py-2">Seats</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-4 text-[var(--ccr-muted)]" colSpan={7}>
                    Loading vehicles…
                  </td>
                </tr>
              ) : filteredVehicles.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-[var(--ccr-muted)]" colSpan={7}>
                    No vehicles found for this view.
                  </td>
                </tr>
              ) : (
                filteredVehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="border-b border-[var(--ccr-border)]/70 text-[var(--ccr-text)]">
                    <td className="px-3 py-3">
                      <p className="font-semibold">{vehicleLabel(vehicle)}</p>
                      <p className="text-xs text-[var(--ccr-muted)]">{vehicle.public_id}</p>
                    </td>
                    <td className="px-3 py-3">{vehicle.status}</td>
                    <td className="px-3 py-3">{formatCurrency(vehicle.daily_rate_cents)}</td>
                    <td className="px-3 py-3">{formatCurrency(vehicle.deposit_cents)}</td>
                    <td className="px-3 py-3">{vehicle.seat_count ?? "—"}</td>
                    <td className="px-3 py-3">
                      <DateTimeInline value={vehicle.created_at} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/vehicles/${vehicle.id}`}
                          className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]"
                        >
                          View
                        </Link>
                        {!showArchived ? (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(vehicle)}
                            className="rounded-lg border border-rose-300/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-2xl">
            <h3 className="text-xl font-semibold text-[var(--ccr-text)]">Delete vehicle?</h3>
            <p className="mt-2 text-sm text-[var(--ccr-muted)]">
              This will delete the vehicle and remove it from the fleet list.
            </p>
            <p className="mt-3 rounded-lg bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]">
              {vehicleLabel(deleteTarget)}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="rounded-lg border border-rose-300/50 bg-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
