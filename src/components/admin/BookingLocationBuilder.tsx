"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { buttonStyles } from "@/components/ui/Button";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type LocationFieldRow = {
  key: string;
  label: string;
  input_type: "text" | "date" | "time";
  required: boolean;
  applies_to: "pickup" | "dropoff" | "both";
  default_source: "pickup_date" | "pickup_time" | "dropoff_date" | "dropoff_time" | null;
};

type LocationRow = {
  id: string | null;
  label: string;
  location_type_key: string;
  pickup_label: string;
  dropoff_label: string;
  allow_pickup: boolean;
  allow_dropoff: boolean;
  applies_to_pickup: boolean;
  applies_to_dropoff: boolean;
  is_active: boolean;
  sort_order: number;
  field_schema: LocationFieldRow[];
};

type LocationDraft = {
  draftKey: string;
  id: string | null;
  label: string;
  locationTypeKey: string;
  pickupLabel: string;
  dropoffLabel: string;
  appliesToPickup: boolean;
  appliesToDropoff: boolean;
  isActive: boolean;
  sortOrder: string;
  fieldSchema: LocationFieldRow[];
};

const FIELD_INPUT_TYPES = ["text", "date", "time"] as const;
const APPLIES_TO_OPTIONS = ["pickup", "dropoff", "both"] as const;
const DEFAULT_SOURCE_OPTIONS = [
  "",
  "pickup_date",
  "pickup_time",
  "dropoff_date",
  "dropoff_time",
] as const;

function createDraftKey() {
  return `draft:${crypto.randomUUID()}`;
}

function locationCardKey(location: { id: string | null; location_type_key: string }) {
  return location.id ?? location.location_type_key;
}

function toDraft(location: LocationRow): LocationDraft {
  return {
    draftKey: locationCardKey(location),
    id: location.id,
    label: location.label,
    locationTypeKey: location.location_type_key,
    pickupLabel: location.pickup_label,
    dropoffLabel: location.dropoff_label,
    appliesToPickup: location.applies_to_pickup ?? location.allow_pickup,
    appliesToDropoff: location.applies_to_dropoff ?? location.allow_dropoff,
    isActive: location.is_active,
    sortOrder: String(location.sort_order),
    fieldSchema: location.field_schema ?? [],
  };
}

function createEmptyDraft(): LocationDraft {
  return {
    draftKey: createDraftKey(),
    id: null,
    label: "",
    locationTypeKey: "",
    pickupLabel: "",
    dropoffLabel: "",
    appliesToPickup: true,
    appliesToDropoff: true,
    isActive: true,
    sortOrder: "0",
    fieldSchema: [],
  };
}

function emptyField(): LocationFieldRow {
  return {
    key: "",
    label: "",
    input_type: "text",
    required: false,
    applies_to: "both",
    default_source: null,
  };
}

export function BookingLocationBuilder() {
  const [drafts, setDrafts] = useState<Record<string, LocationDraft>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savingDraftKey, setSavingDraftKey] = useState<string | null>(null);
  const [deactivatingDraftKey, setDeactivatingDraftKey] = useState<string | null>(null);

  const applyLocations = useCallback((nextLocations: LocationRow[]) => {
    setDrafts((current) => {
      const unsavedDrafts = Object.values(current).filter((draft) => draft.id === null);
      const nextEntries = nextLocations.map((location) => {
        const draft = toDraft(location);
        return [draft.draftKey, draft] as const;
      });
      for (const draft of unsavedDrafts) {
        nextEntries.push([draft.draftKey, draft] as const);
      }
      return Object.fromEntries(nextEntries);
    });
  }, []);

  const loadLocations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/booking-locations", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        locations?: LocationRow[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load booking locations.");
      }
      applyLocations(Array.isArray(payload.locations) ? payload.locations : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load booking locations.");
      applyLocations([]);
    } finally {
      setLoading(false);
    }
  }, [applyLocations]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  const orderedDrafts = useMemo(
    () =>
      Object.values(drafts).sort((left, right) => {
        const leftOrder = Number(left.sortOrder) || 0;
        const rightOrder = Number(right.sortOrder) || 0;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.locationTypeKey.localeCompare(right.locationTypeKey);
      }),
    [drafts],
  );

  function updateDraft(
    draftKey: string,
    updater: (draft: LocationDraft) => LocationDraft,
  ) {
    setDrafts((current) => {
      const draft = current[draftKey];
      if (!draft) return current;
      return {
        ...current,
        [draftKey]: updater(draft),
      };
    });
  }

  function addDraft() {
    const draft = createEmptyDraft();
    setDrafts((current) => ({
      ...current,
      [draft.draftKey]: draft,
    }));
    setStatus(null);
    setError(null);
  }

  function removeUnsavedDraft(draftKey: string) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[draftKey];
      return next;
    });
  }

  function addField(draftKey: string) {
    updateDraft(draftKey, (draft) => ({
      ...draft,
      fieldSchema: [...draft.fieldSchema, emptyField()],
    }));
  }

  function updateField(
    draftKey: string,
    index: number,
    updater: (field: LocationFieldRow) => LocationFieldRow,
  ) {
    updateDraft(draftKey, (draft) => ({
      ...draft,
      fieldSchema: draft.fieldSchema.map((field, fieldIndex) =>
        fieldIndex === index ? updater(field) : field,
      ),
    }));
  }

  function removeField(draftKey: string, index: number) {
    updateDraft(draftKey, (draft) => ({
      ...draft,
      fieldSchema: draft.fieldSchema.filter((_, fieldIndex) => fieldIndex !== index),
    }));
  }

  async function saveDraft(draft: LocationDraft) {
    if (savingDraftKey) return;
    setSavingDraftKey(draft.draftKey);
    setError(null);
    setStatus(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/booking-locations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          csrfToken,
          id: draft.id,
          label: draft.label,
          locationTypeKey: draft.locationTypeKey,
          pickupLabel: draft.pickupLabel,
          dropoffLabel: draft.dropoffLabel,
          appliesToPickup: draft.appliesToPickup,
          appliesToDropoff: draft.appliesToDropoff,
          isActive: draft.isActive,
          sortOrder: Number(draft.sortOrder) || 0,
          fieldSchema: draft.fieldSchema,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to save location type.");
      }
      setStatus(
        draft.id ? "Booking location type updated." : "Booking location type created.",
      );
      await loadLocations();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save location type.");
    } finally {
      setSavingDraftKey(null);
    }
  }

  async function deactivateDraft(draft: LocationDraft) {
    if (!draft.id || deactivatingDraftKey) return;
    setDeactivatingDraftKey(draft.draftKey);
    setError(null);
    setStatus(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/booking-locations", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          csrfToken,
          id: draft.id,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to deactivate location type.");
      }
      setStatus("Booking location type deactivated.");
      await loadLocations();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to deactivate location type.",
      );
    } finally {
      setDeactivatingDraftKey(null);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Locations
          </h3>
          <p className="mt-3 text-xs leading-5 text-[var(--ccr-muted)]">
            Manage the canonical booking location types, labels, side support, ordering, and
            conditional fields used by both the public wizard and the admin booking flows.
          </p>
        </div>
        <button
          type="button"
          onClick={addDraft}
          className={buttonStyles({ variant: "secondary", size: "sm" })}
        >
          Add location type
        </button>
      </div>

      {loading ? <p className="mt-4 text-xs text-[var(--ccr-muted)]">Loading…</p> : null}
      {error ? <p className="mt-4 text-sm text-red-500">{error}</p> : null}
      {status ? <p className="mt-4 text-sm text-[var(--ccr-accent)]">{status}</p> : null}

      <div className="mt-4 space-y-4">
        {orderedDrafts.map((draft) => (
          <div
            key={draft.draftKey}
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Type key
                <input
                  type="text"
                  value={draft.locationTypeKey}
                  onChange={(event) =>
                    updateDraft(draft.draftKey, (current) => ({
                      ...current,
                      locationTypeKey: event.target.value.toUpperCase().replace(/\s+/g, "_"),
                    }))
                  }
                  className="mt-2 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  placeholder="AIRPORT"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Neutral label
                <input
                  type="text"
                  value={draft.label}
                  onChange={(event) =>
                    updateDraft(draft.draftKey, (current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  placeholder="Custom Address"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Pickup label
                <input
                  type="text"
                  value={draft.pickupLabel}
                  onChange={(event) =>
                    updateDraft(draft.draftKey, (current) => ({
                      ...current,
                      pickupLabel: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  placeholder="Pick up Address"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Dropoff label
                <input
                  type="text"
                  value={draft.dropoffLabel}
                  onChange={(event) =>
                    updateDraft(draft.draftKey, (current) => ({
                      ...current,
                      dropoffLabel: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  placeholder="Return Address"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Sort order
                <input
                  type="number"
                  min={0}
                  value={draft.sortOrder}
                  onChange={(event) =>
                    updateDraft(draft.draftKey, (current) => ({
                      ...current,
                      sortOrder: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="mt-6 flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                  <input
                    type="checkbox"
                    checked={draft.appliesToPickup}
                    onChange={(event) =>
                      updateDraft(draft.draftKey, (current) => ({
                        ...current,
                        appliesToPickup: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-[var(--ccr-border)] accent-[var(--ccr-accent)]"
                  />
                  Pickup
                </label>
                <label className="mt-6 flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                  <input
                    type="checkbox"
                    checked={draft.appliesToDropoff}
                    onChange={(event) =>
                      updateDraft(draft.draftKey, (current) => ({
                        ...current,
                        appliesToDropoff: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-[var(--ccr-border)] accent-[var(--ccr-accent)]"
                  />
                  Dropoff
                </label>
                <label className="mt-6 flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(event) =>
                      updateDraft(draft.draftKey, (current) => ({
                        ...current,
                        isActive: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-[var(--ccr-border)] accent-[var(--ccr-accent)]"
                  />
                  Active
                </label>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Conditional fields
                </p>
                <button
                  type="button"
                  onClick={() => addField(draft.draftKey)}
                  className={buttonStyles({ variant: "ghost", size: "sm" })}
                >
                  Add field
                </button>
              </div>

              <div className="mt-3 space-y-3">
                {draft.fieldSchema.map((field, index) => (
                  <div
                    key={`${draft.draftKey}-${index}`}
                    className="grid gap-2 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3 lg:grid-cols-[minmax(8rem,1fr)_minmax(14rem,2fr)_minmax(7rem,0.8fr)_minmax(7rem,0.8fr)_minmax(10rem,1fr)_auto]"
                  >
                    <input
                      type="text"
                      value={field.key}
                      onChange={(event) =>
                        updateField(draft.draftKey, index, (current) => ({
                          ...current,
                          key: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                      placeholder="key"
                    />
                    <input
                      type="text"
                      value={field.label}
                      onChange={(event) =>
                        updateField(draft.draftKey, index, (current) => ({
                          ...current,
                          label: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                      placeholder="Label"
                    />
                    <select
                      value={field.input_type}
                      onChange={(event) =>
                        updateField(draft.draftKey, index, (current) => ({
                          ...current,
                          input_type: event.target.value as LocationFieldRow["input_type"],
                        }))
                      }
                      className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    >
                      {FIELD_INPUT_TYPES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <select
                      value={field.applies_to}
                      onChange={(event) =>
                        updateField(draft.draftKey, index, (current) => ({
                          ...current,
                          applies_to: event.target.value as LocationFieldRow["applies_to"],
                        }))
                      }
                      className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    >
                      {APPLIES_TO_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <select
                      value={field.default_source ?? ""}
                      onChange={(event) =>
                        updateField(draft.draftKey, index, (current) => ({
                          ...current,
                          default_source:
                            event.target.value.length > 0
                              ? (event.target.value as LocationFieldRow["default_source"])
                              : null,
                        }))
                      }
                      className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    >
                      {DEFAULT_SOURCE_OPTIONS.map((option) => (
                        <option key={option || "none"} value={option}>
                          {option || "No default"}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(event) =>
                            updateField(draft.draftKey, index, (current) => ({
                              ...current,
                              required: event.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-[var(--ccr-border)] accent-[var(--ccr-accent)]"
                        />
                        Required
                      </label>
                      <button
                        type="button"
                        onClick={() => removeField(draft.draftKey, index)}
                        className={buttonStyles({ variant: "ghost", size: "sm" })}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                {draft.fieldSchema.length === 0 ? (
                  <p className="text-xs text-[var(--ccr-muted)]">
                    No conditional fields configured for this location type.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {draft.id ? (
                <button
                  type="button"
                  onClick={() => void deactivateDraft(draft)}
                  disabled={deactivatingDraftKey === draft.draftKey}
                  className={buttonStyles({ variant: "ghost", size: "sm" })}
                >
                  {deactivatingDraftKey === draft.draftKey ? "Deactivating..." : "Deactivate"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => removeUnsavedDraft(draft.draftKey)}
                  className={buttonStyles({ variant: "ghost", size: "sm" })}
                >
                  Remove draft
                </button>
              )}
              <button
                type="button"
                onClick={() => void saveDraft(draft)}
                disabled={savingDraftKey === draft.draftKey}
                className={buttonStyles({ variant: "primary", size: "sm" })}
              >
                {savingDraftKey === draft.draftKey ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ))}

        {!loading && orderedDrafts.length === 0 ? (
          <p className="text-xs text-[var(--ccr-muted)]">
            Booking locations are unavailable in this environment.
          </p>
        ) : null}
      </div>
    </div>
  );
}
