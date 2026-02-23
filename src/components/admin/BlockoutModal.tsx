"use client";

import { useRef, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { useDialogA11y } from "@/components/admin/useDialogA11y";

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

function normalizeInitialDraft(initial: BlockoutDraft) {
  const knownReasons = ["Maintenance", "Unavailable", "Private Use", "Cleaning", "Other"];
  if (initial.reason && !knownReasons.includes(initial.reason)) {
    return {
      draft: { ...initial, reason: "Other" },
      customReason: initial.reason,
    };
  }
  return {
    draft: initial,
    customReason: "",
  };
}

export function BlockoutModal({
  open,
  vehicles,
  initial,
  onClose,
  onSaved,
  onDeleted,
}: BlockoutModalProps) {
  const [draft, setDraft] = useState<BlockoutDraft>(() => normalizeInitialDraft(initial).draft);
  const [customReason, setCustomReason] = useState(() => normalizeInitialDraft(initial).customReason);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useDialogA11y({
    open,
    onClose,
    dialogRef,
  });

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

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(
      isEditing ? `/api/admin/blockouts/${draft.id}` : "/api/admin/blockouts",
      {
        method: isEditing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
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

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/blockouts/${draft.id}`, {
      method: "DELETE",
      headers: {
        "x-csrf-token": csrfToken ?? "",
      },
    });
    setSaving(false);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Failed to delete blockout.");
      return;
    }

    onDeleted();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 py-6 sm:items-center sm:py-10"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? "Edit blockout" : "Add blockout"}
        tabIndex={open ? -1 : undefined}
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">
            {isEditing ? "Edit Blockout" : "Add Blockout"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close blockout modal"
            className="min-h-10 rounded-lg border border-[var(--ccr-border)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-4 text-sm">
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
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--ccr-border)] pt-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="min-h-11 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {isEditing ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 disabled:opacity-60"
            >
              Delete
            </button>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
            >
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
