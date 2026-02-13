"use client";

import { useEffect, useMemo, useState } from "react";

import { BlockoutModal } from "@/components/admin/BlockoutModal";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type VehicleOption = {
  id: string;
  make: string;
  model: string;
};

type BlockoutRow = {
  id: string;
  vehicle_id: string;
  start_at: string;
  end_at: string;
  reason: string;
  notes?: string | null;
};

type VehicleBlockoutsProps = {
  vehicle: VehicleOption;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function rangeDefaults() {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 2);
  end.setDate(0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function VehicleBlockouts({ vehicle }: VehicleBlockoutsProps) {
  const [blockouts, setBlockouts] = useState<BlockoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeBlockout, setActiveBlockout] = useState<BlockoutRow | null>(null);

  const range = useMemo(() => rangeDefaults(), []);

  async function loadBlockouts() {
    setLoading(true);
    setError(null);
    setTableMissing(false);

    const url = `/api/admin/blockouts?start=${encodeURIComponent(
      range.start.toISOString(),
    )}&end=${encodeURIComponent(range.end.toISOString())}&vehicleId=${encodeURIComponent(
      vehicle.id,
    )}`;

    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));

    setLoading(false);

    if (!response.ok) {
      if (data.error === "BLOCKOUTS_TABLE_MISSING") {
        setTableMissing(true);
        setBlockouts([]);
        return;
      }
      setError(data.error ?? "Failed to load blockouts.");
      return;
    }

    setBlockouts(Array.isArray(data.blockouts) ? data.blockouts : []);
  }

  async function handleDelete(blockout: BlockoutRow) {
    const confirmed = window.confirm("Delete this blockout?");
    if (!confirmed) return;
    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/blockouts/${blockout.id}`, {
      method: "DELETE",
      headers: {
        "x-csrf-token": csrfToken ?? "",
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.error === "BLOCKOUTS_TABLE_MISSING") {
        setTableMissing(true);
        setError("Blockouts table is not installed.");
        return;
      }
      setError(data.error ?? "Failed to delete blockout.");
      return;
    }
    loadBlockouts();
  }

  useEffect(() => {
    loadBlockouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.id]);

  const modalInitial = useMemo(() => {
    if (activeBlockout) {
      return {
        id: activeBlockout.id,
        vehicleId: vehicle.id,
        startAt: activeBlockout.start_at,
        endAt: activeBlockout.end_at,
        reason: activeBlockout.reason,
        notes: activeBlockout.notes ?? "",
      };
    }

    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 1);
    return {
      vehicleId: vehicle.id,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      reason: "",
      notes: "",
    };
  }, [activeBlockout, vehicle.id]);

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Blockouts</h2>
          <p className="text-xs text-[var(--ccr-muted)]">
            {vehicle.make} {vehicle.model}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setActiveBlockout(null);
            setModalOpen(true);
          }}
          disabled={tableMissing}
          className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          + Add Blockout
        </button>
      </div>

      {tableMissing ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Blockouts not configured</p>
          <p className="mt-1">
            Apply the blockouts table section from schema.sql to enable maintenance scheduling.
          </p>
        </div>
      ) : null}

      {loading ? <p className="mt-4 text-sm text-[var(--ccr-muted)]">Loading...</p> : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {!loading && !error && blockouts.length === 0 && !tableMissing ? (
        <p className="mt-4 text-sm text-[var(--ccr-muted)]">No blockouts in this window.</p>
      ) : null}

      {!loading && blockouts.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2">End</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {blockouts.map((blockout) => (
                <tr key={blockout.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                  <td className="px-3 py-2 text-[var(--ccr-text)]">
                    {formatDateTime(blockout.start_at)}
                  </td>
                  <td className="px-3 py-2 text-[var(--ccr-text)]">
                    {formatDateTime(blockout.end_at)}
                  </td>
                  <td className="px-3 py-2 text-[var(--ccr-text)]">{blockout.reason}</td>
                  <td className="px-3 py-2 text-[var(--ccr-muted)]">
                    {blockout.notes ? blockout.notes.slice(0, 40) : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveBlockout(blockout);
                          setModalOpen(true);
                        }}
                        className="rounded-lg border border-[var(--ccr-border)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(blockout)}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <BlockoutModal
        key={`${modalInitial.id ?? "new"}:${modalInitial.vehicleId}:${modalInitial.startAt}:${modalInitial.endAt}`}
        open={modalOpen}
        vehicles={[vehicle]}
        initial={modalInitial}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          loadBlockouts();
        }}
        onDeleted={() => {
          setModalOpen(false);
          loadBlockouts();
        }}
      />
    </section>
  );
}
