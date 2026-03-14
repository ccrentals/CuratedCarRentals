"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import type { VehicleChecklistTemplateSetting } from "@/lib/adminSettings";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

const DEFAULT_FOLDERS = ["Paperwork", "Insurance", "Registration", "Other"];

type VehicleChecklistPanelProps = {
  vehicleId: string;
  folders?: string[];
  templates?: VehicleChecklistTemplateSetting[];
  initialChecklistItemId?: string;
};

type ChecklistItem = {
  id: string;
  label: string;
  folder: string;
  required: boolean;
  allowNotRequired: boolean;
  uploadedDocumentDisplayLabel: string | null;
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

function normalizeTemplates(
  input: VehicleChecklistTemplateSetting[] | undefined,
  folders: string[],
) {
  return (input ?? [])
    .map((template) => {
      const label = template.label.trim();
      if (!label) return null;
      return {
        ...template,
        label,
        folder: folders.includes(template.folder) ? template.folder : folders[0] ?? "Unsorted",
      };
    })
    .filter((template): template is VehicleChecklistTemplateSetting => Boolean(template))
    .slice(0, 40);
}

export function VehicleChecklistPanel({
  vehicleId,
  folders: configuredFolders,
  templates: configuredTemplates,
  initialChecklistItemId,
}: VehicleChecklistPanelProps) {
  const folders = useMemo(() => normalizeFolders(configuredFolders), [configuredFolders]);
  const templates = useMemo(
    () => normalizeTemplates(configuredTemplates, folders),
    [configuredTemplates, folders],
  );
  const activeTemplates = useMemo(
    () => templates.filter((template) => template.isActive),
    [templates],
  );

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(
    initialChecklistItemId?.trim() || null,
  );
  const [initialScrollHandled, setInitialScrollHandled] = useState(false);
  const [initialUrlFocusHandled, setInitialUrlFocusHandled] = useState(false);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

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
          allowNotRequired: boolean;
          uploadedDocumentDisplayLabel: string | null;
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
          allowNotRequired: Boolean(item.allowNotRequired),
          uploadedDocumentDisplayLabel: item.uploadedDocumentDisplayLabel ?? null,
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
    setHighlightedItemId(initialChecklistItemId?.trim() || null);
    setInitialScrollHandled(false);
    setInitialUrlFocusHandled(false);
  }, [initialChecklistItemId]);

  useEffect(() => {
    if (!folders.includes(folder)) {
      setFolder(folders[0] ?? "Unsorted");
    }
  }, [folder, folders]);

  const highlightedItem = useMemo(
    () => items.find((item) => item.id === highlightedItemId) ?? null,
    [highlightedItemId, items],
  );

  useEffect(() => {
    if (!highlightedItemId || initialScrollHandled || loading) return;
    const matchedItem = itemRefs.current[highlightedItemId];
    if (matchedItem) {
      matchedItem.scrollIntoView({ block: "center", behavior: "smooth" });
      setInitialScrollHandled(true);
      return;
    }
    if (!loading) {
      setInitialScrollHandled(true);
    }
  }, [highlightedItemId, initialScrollHandled, loading, items]);

  useEffect(() => {
    const shouldClearUrl =
      typeof window !== "undefined" &&
      initialChecklistItemId &&
      highlightedItemId === initialChecklistItemId &&
      initialScrollHandled &&
      !initialUrlFocusHandled;
    if (!shouldClearUrl) return;

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("checklistItemId");
    window.history.replaceState(window.history.state, "", nextUrl.toString());
    setInitialUrlFocusHandled(true);
  }, [
    highlightedItemId,
    initialChecklistItemId,
    initialScrollHandled,
    initialUrlFocusHandled,
  ]);

  async function createItem(
    inputLabel: string,
    inputFolder: string,
    inputRequired: boolean,
    inputAllowNotRequired: boolean,
    inputExpirationDate: string | null,
  ) {
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
        allowNotRequired: inputAllowNotRequired,
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
      await createItem(normalizedLabel, folder, required, true, expirationDate || null);
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
    if (activeTemplates.length < 1) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      for (const template of activeTemplates) {
        await createItem(
          template.label,
          template.folder,
          template.required,
          template.allowNotRequired,
          null,
        );
      }
      const expiryRequiredCount = activeTemplates.filter((template) => template.expiryRequired).length;
      setMessage(
        expiryRequiredCount > 0
          ? `Template checklist items added. ${expiryRequiredCount} item(s) still need expiration dates.`
          : "Template checklist items added.",
      );
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

  function clearHighlight() {
    setHighlightedItemId(null);
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Checklist</h2>
          <p className="text-xs text-[var(--ccr-muted)]">Track required vehicle paperwork and renewals.</p>
        </div>
        {activeTemplates.length > 0 ? (
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

      {templates.length > 0 ? (
        <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--ccr-text)]">Template coverage</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                Apply uses each template&apos;s own folder, required flag, and optional override
                rule.
              </p>
            </div>
            <p className="text-xs text-[var(--ccr-muted)]">
              Active templates:{" "}
              <span className="font-semibold text-[var(--ccr-text)]">{activeTemplates.length}</span>
            </p>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {templates.map((template) => (
              <article
                key={template.key}
                className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[var(--ccr-text)]">{template.label}</p>
                    <p className="text-xs text-[var(--ccr-muted)]">Folder: {template.folder}</p>
                  </div>
                  {!template.isActive ? (
                    <span className="rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-muted)]">
                      Inactive
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[var(--ccr-text)]">
                    {template.required ? "Required" : "Optional"}
                  </span>
                  <span className="rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[var(--ccr-text)]">
                    {template.allowNotRequired ? "Can be marked optional" : "Must stay required"}
                  </span>
                  {template.expiryRequired ? (
                    <span className="rounded-full border border-amber-300/50 bg-amber-500/15 px-2 py-1 text-[var(--ccr-required-text)]">
                      Expiry required
                    </span>
                  ) : null}
                  {template.expiryWarningDays !== null ? (
                    <span className="rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[var(--ccr-text)]">
                      Warn {template.expiryWarningDays}d
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

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
      {highlightedItem ? (
        <div
          data-testid="vehicle-checklist-focus-banner"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ccr-accent)] bg-[color-mix(in_srgb,var(--ccr-accent)_10%,var(--ccr-surface-soft))] px-4 py-3"
        >
          <div>
            <p className="text-sm font-semibold text-[var(--ccr-text)]">Focused from Files</p>
            <p className="text-xs text-[var(--ccr-muted)]">
              {highlightedItem.label} is highlighted in this checklist.
            </p>
          </div>
          <button
            type="button"
            data-testid="vehicle-checklist-clear-highlight"
            onClick={clearHighlight}
            className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Clear highlight
          </button>
        </div>
      ) : null}

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

        {items.map((item) => {
          const isHighlighted = highlightedItemId === item.id;
          return (
            <article
              key={item.id}
              ref={(node) => {
                itemRefs.current[item.id] = node;
              }}
              data-testid={`vehicle-checklist-item-${item.id}`}
              data-highlighted={isHighlighted ? "true" : "false"}
              className={`relative rounded-xl border p-4 pr-36 transition-colors sm:pr-44 ${
                isHighlighted
                  ? "border-[var(--ccr-accent)] bg-[color-mix(in_srgb,var(--ccr-accent)_10%,var(--ccr-surface-soft))] shadow-[0_0_0_1px_var(--ccr-accent)]"
                  : "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]"
              }`}
            >
              <div className="flex flex-wrap items-start gap-2">
                <div>
                  <p className="font-semibold text-[var(--ccr-text)] break-words">{item.label}</p>
                  {isHighlighted ? (
                    <span className="mt-1 inline-flex rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-accent-strong)]">
                      Focused from Files
                    </span>
                  ) : null}
                  <p className="text-xs text-[var(--ccr-muted)]">Folder: {item.folder}</p>
                </div>
              </div>

              <div className="mt-2 text-xs text-[var(--ccr-muted)]">
                <p>Created: <DateTimeInline value={item.createdAt} /></p>
                <p>
                  Expiration: {item.expirationDate ? item.expirationDate : "Not set"}
                  {item.uploadedDocumentId ? " · Document attached" : ""}
                </p>
                {item.uploadedDocumentId ? (
                  <div className="space-y-2">
                    <p>Attached file: {item.uploadedDocumentDisplayLabel ?? "Linked vehicle file"}</p>
                    <div className="flex flex-wrap gap-2">
                      <a
                        data-testid="vehicle-checklist-download-file"
                        href={`/api/admin/vehicles/${vehicleId}/documents/${item.uploadedDocumentId}/download`}
                        className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-text)]"
                      >
                        Download file
                      </a>
                      <Link
                        data-testid="vehicle-checklist-manage-file"
                        href={`/admin/vehicles/${vehicleId}?tab=files&folder=${encodeURIComponent(item.folder)}&documentId=${encodeURIComponent(item.uploadedDocumentId)}`}
                        className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-accent-strong)]"
                      >
                        Manage in Files
                      </Link>
                    </div>
                  </div>
                ) : null}
                {item.required && !item.allowNotRequired ? (
                  <p>This item should remain required.</p>
                ) : null}
              </div>

              <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
                {item.required ? (
                  <span className="rounded-full border border-amber-300/50 bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-[var(--ccr-required-text)]">
                    Required
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleDelete(item.id)}
                  className="rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-accent-strong)]"
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
