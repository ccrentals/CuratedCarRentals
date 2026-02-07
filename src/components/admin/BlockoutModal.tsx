"use client";

import { useEffect, useState } from "react";

type VehicleOption = {
  id: string;
  make: string;
  model: string;
};

type BlockoutDraft = {
  id?: string;
  vehicleId: string;
  startAt: string;
  endAt: string;
  reason: string;
  notes: string;
};

type BlockoutModalProps = {
  open: boolean;
  vehicles: VehicleOption[];
  initial: BlockoutDraft;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
};

function toLocalInput(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function BlockoutModal({
  open,
  vehicles,
  initial,
  onClose,
  onSaved,
  onDeleted,
}: BlockoutModalProps) {
  const [draft, setDraft] = useState<BlockoutDraft>(initial);
  const [customReason, setCustomReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const knownReasons = ["Maintenance", "Unavailable", "Private Use", "Cleaning", "Other"];
    if (initial.reason && !knownReasons.includes(initial.reason)) {
      setDraft({ ...initial, reason: "Other" });
      setCustomReason(initial.reason);
    } else {
      setDraft(initial);
      setCustomReason("");
    }
    setError(null);
  }, [initial]);

  if (!open) return null;

  const isEditing = Boolean(draft.id);

  async function handleSave() {
    if (!draft.vehicleId || !draft.startAt || !draft.endAt || !draft.reason) {
      setError("Please complete all required fields.");
      return;
    }

    setSaving(true);
    setError(null);

    const finalReason =
      draft.reason === "Other" && customReason.trim() ? customReason.trim() : draft.reason;

    const payload = {
      vehicleId: draft.vehicleId,
      startAt: new Date(draft.startAt).toISOString(),
      endAt: new Date(draft.endAt).toISOString(),
      reason: finalReason,
      notes: draft.notes,
    };

    const response = await fetch(
      isEditing ? `/api/admin/blockouts/${draft.id}` : "/api/admin/blockouts",
      {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    setSaving(false);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Failed to save blockout.");
      return;
    }

    onSaved();
  }

  async function handleDelete() {
    if (!draft.id) return;
    const confirmed = window.confirm("Delete this blockout?");
    if (!confirmed) return;

    setSaving(true);
    setError(null);

    const response = await fetch(`/api/admin/blockouts/${draft.id}`, { method: "DELETE" });
    setSaving(false);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Failed to delete blockout.");
      return;
    }

    onDeleted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-10">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--ccr-primary)]">
            {isEditing ? "Edit Blockout" : "Add Blockout"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close blockout modal"
            className="rounded-lg border border-[var(--ccr-border)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4 text-sm">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Vehicle
            <select
              value={draft.vehicleId}
              onChange={(event) => setDraft((prev) => ({ ...prev, vehicleId: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="">Select vehicle</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.make} {vehicle.model}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Start
              <input
                type="datetime-local"
                value={toLocalInput(draft.startAt)}
                onChange={(event) => setDraft((prev) => ({ ...prev, startAt: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              End
              <input
                type="datetime-local"
                value={toLocalInput(draft.endAt)}
                onChange={(event) => setDraft((prev) => ({ ...prev, endAt: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>
          </div>

          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Reason
            <select
              value={draft.reason}
              onChange={(event) => setDraft((prev) => ({ ...prev, reason: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="">Select reason</option>
              <option value="Maintenance">Maintenance</option>
              <option value="Unavailable">Unavailable</option>
              <option value="Private Use">Private Use</option>
              <option value="Cleaning">Cleaning</option>
              <option value="Other">Other</option>
            </select>
          </label>

          {draft.reason === "Other" ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Custom reason
              <input
                value={customReason}
                onChange={(event) => setCustomReason(event.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>
          ) : null}

          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Notes
            <textarea
              value={draft.notes}
              onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {isEditing ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 disabled:opacity-60"
            >
              Delete
            </button>
          ) : null}
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
