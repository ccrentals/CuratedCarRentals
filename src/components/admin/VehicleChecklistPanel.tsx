"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

const DEFAULT_FOLDERS = ["Paperwork", "Insurance", "Registration", "Other"];

type VehicleChecklistPanelProps = {
  vehicleId: string;
  folders?: string[];
  templateItems?: string[];
};

type ChecklistItem = {
  id: string;
  label: string;
  folder: string;
  required: boolean;
  expirationDate: string | null;
  uploadedDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeFolders(input: string[] | undefined) {
  const cleaned = (input ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_FOLDERS];
}

function normalizeTemplates(input: string[] | undefined) {
  return (input ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function VehicleChecklistPanel({ vehicleId, folders: configuredFolders, templateItems }: VehicleChecklistPanelProps) {
  const folders = useMemo(() => normalizeFolders(configuredFolders), [configuredFolders]);
  const templates = useMemo(() => normalizeTemplates(templateItems), [templateItems]);

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [folder, setFolder] = useState(folders[0] ?? "Unsorted");
  const [required, setRequired] = useState(false);
  const [expirationDate, setExpirationDate] = useState("");

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/checklist`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: Array<{
          id: string;
          label: string;
          folder: string;
          required: boolean;
          expirationDate: string | null;
          uploadedDocumentId: string | null;
          createdAt: string;
          updatedAt: string;
        }>;
      };

      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Unable to load checklist.");
        setItems([]);
        return;
      }

      setItems(
        (payload.items ?? []).map((item) => ({
          id: item.id,
          label: item.label,
          folder: item.folder,
          required: Boolean(item.required),
          expirationDate: item.expirationDate ?? null,
          uploadedDocumentId: item.uploadedDocumentId ?? null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      );
    } catch {
      setError("Unable to load checklist.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!folders.includes(folder)) {
      setFolder(folders[0] ?? "Unsorted");
    }
  }, [folder, folders]);

  async function createItem(inputLabel: string, inputFolder: string, inputRequired: boolean, inputExpirationDate: string | null) {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/vehicles/${vehicleId}/checklist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        label: inputLabel,
        folder: inputFolder,
        required: inputRequired,
        expirationDate: inputExpirationDate,
        csrfToken,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Unable to save checklist item.");
    }
  }

  async function handleCreate() {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) {
      setError("Checklist label is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await createItem(normalizedLabel, folder, required, expirationDate || null);
      setLabel("");
      setRequired(false);
      setExpirationDate("");
      setMessage("Checklist item added.");
      await loadItems();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save checklist item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyTemplate() {
    if (templates.length < 1) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      for (const templateLabel of templates) {
        await createItem(templateLabel, folder, true, null);
      }
      setMessage("Template checklist items added.");
      await loadItems();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to apply template items.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(itemId: string) {
    const confirmed = window.confirm("Delete this checklist item?");
    if (!confirmed) return;

    setError(null);
    setMessage(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/vehicles/${vehicleId}/checklist/${itemId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ csrfToken }),
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setError(payload.error ?? "Unable to delete checklist item.");
      return;
    }

    setMessage("Checklist item deleted.");
    await loadItems();
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Checklist</h2>
          <p className="text-xs text-[var(--ccr-muted)]">Track required vehicle paperwork and renewals.</p>
        </div>
        {templates.length > 0 ? (
          <button
            type="button"
            onClick={() => void handleApplyTemplate()}
            disabled={saving}
            className="min-h-11 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
          >
            {saving ? "Applying..." : "Apply template"}
          </button>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Label
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="Insurance Certificate"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Folder
            <select
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              {folders.map((folderOption) => (
                <option key={folderOption} value={folderOption}>
                  {folderOption}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Expiration Date
            <input
              type="date"
              value={expirationDate}
              onChange={(event) => setExpirationDate(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] md:pt-6">
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
              className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
            />
            Required item
          </label>
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving}
            className="min-h-11 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Add checklist item"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-3 text-xs font-semibold text-red-300">{error}</p> : null}
      {message ? <p className="mt-3 text-xs font-semibold text-emerald-200">{message}</p> : null}

      <div className="mt-4 space-y-3">
        {loading ? <p className="text-sm text-[var(--ccr-muted)]">Loading checklist...</p> : null}
      {!loading && items.length < 1 ? (
          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-5">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">No checklist items yet.</p>
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">
              Add required paperwork and expiration checkpoints for this vehicle.
            </p>
          </div>
        ) : null}

        {items.map((item) => (
          <article
            key={item.id}
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-[var(--ccr-text)] break-words">{item.label}</p>
                <p className="text-xs text-[var(--ccr-muted)]">Folder: {item.folder}</p>
              </div>
              <div className="flex items-center gap-2">
                {item.required ? (
                  <span className="rounded-full border border-amber-300/50 bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-100">
                    Required
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleDelete(item.id)}
                  className="min-h-10 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="mt-2 text-xs text-[var(--ccr-muted)]">
              <p>Created: <DateTimeInline value={item.createdAt} /></p>
              <p>
                Expiration: {item.expirationDate ? item.expirationDate : "Not set"}
                {item.uploadedDocumentId ? " · Document attached" : ""}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
