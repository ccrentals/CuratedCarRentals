"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { buttonStyles } from "@/components/ui/Button";

type RulesPayload = {
  id: string | null;
  vehicleId: string;
  advanceNoticeHours: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  allowedPickupStartHour: number | null;
  allowedPickupEndHour: number | null;
  allowedDropoffStartHour: number | null;
  allowedDropoffEndHour: number | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type VehicleAvailabilityRulesPanelProps = {
  vehicleId: string;
};

type FormState = {
  advanceNoticeHours: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
  allowedPickupStartHour: string;
  allowedPickupEndHour: string;
  allowedDropoffStartHour: string;
  allowedDropoffEndHour: string;
  isActive: boolean;
};

function toInput(value: number | null) {
  return value === null || Number.isNaN(value) ? "" : String(value);
}

function toFormState(rules: RulesPayload): FormState {
  return {
    advanceNoticeHours: toInput(rules.advanceNoticeHours),
    bufferBeforeMinutes: toInput(rules.bufferBeforeMinutes),
    bufferAfterMinutes: toInput(rules.bufferAfterMinutes),
    allowedPickupStartHour: toInput(rules.allowedPickupStartHour),
    allowedPickupEndHour: toInput(rules.allowedPickupEndHour),
    allowedDropoffStartHour: toInput(rules.allowedDropoffStartHour),
    allowedDropoffEndHour: toInput(rules.allowedDropoffEndHour),
    isActive: rules.isActive,
  };
}

function normalizeNumberInput(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) return { value: 0 };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || Math.round(parsed) < 0) {
    return { error: `${label} must be a whole number greater than or equal to 0.` };
  }
  return { value: Math.round(parsed) };
}

function normalizeOptionalHour(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) return { value: null as number | null };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { error: `${label} must be a whole number from 0 to 23.` };
  }
  const rounded = Math.round(parsed);
  if (rounded < 0 || rounded > 23) {
    return { error: `${label} must be between 0 and 23.` };
  }
  return { value: rounded as number | null };
}

export function VehicleAvailabilityRulesPanel({ vehicleId }: VehicleAvailabilityRulesPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaultsApplied, setDefaultsApplied] = useState(true);
  const [form, setForm] = useState<FormState>({
    advanceNoticeHours: "0",
    bufferBeforeMinutes: "0",
    bufferAfterMinutes: "0",
    allowedPickupStartHour: "",
    allowedPickupEndHour: "",
    allowedDropoffStartHour: "",
    allowedDropoffEndHour: "",
    isActive: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/availability-rules`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        rules?: RulesPayload;
        defaultsApplied?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.rules) {
        throw new Error(payload.error ?? "Failed to load availability rules.");
      }

      setForm(toFormState(payload.rules));
      setDefaultsApplied(Boolean(payload.defaultsApplied));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load availability rules.",
      );
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const helperText = useMemo(() => {
    if (defaultsApplied) {
      return "Defaults are active (no extra restrictions). Save once to apply vehicle-specific rules.";
    }
    return "Vehicle-specific availability rules are active for quote and booking availability checks.";
  }, [defaultsApplied]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const advanceNotice = normalizeNumberInput(form.advanceNoticeHours, "Advance notice");
    if (advanceNotice.error) {
      setError(advanceNotice.error);
      return;
    }

    const bufferBefore = normalizeNumberInput(form.bufferBeforeMinutes, "Buffer before");
    if (bufferBefore.error) {
      setError(bufferBefore.error);
      return;
    }

    const bufferAfter = normalizeNumberInput(form.bufferAfterMinutes, "Buffer after");
    if (bufferAfter.error) {
      setError(bufferAfter.error);
      return;
    }

    const pickupStart = normalizeOptionalHour(form.allowedPickupStartHour, "Pickup start hour");
    if (pickupStart.error) {
      setError(pickupStart.error);
      return;
    }

    const pickupEnd = normalizeOptionalHour(form.allowedPickupEndHour, "Pickup end hour");
    if (pickupEnd.error) {
      setError(pickupEnd.error);
      return;
    }

    const dropoffStart = normalizeOptionalHour(form.allowedDropoffStartHour, "Dropoff start hour");
    if (dropoffStart.error) {
      setError(dropoffStart.error);
      return;
    }

    const dropoffEnd = normalizeOptionalHour(form.allowedDropoffEndHour, "Dropoff end hour");
    if (dropoffEnd.error) {
      setError(dropoffEnd.error);
      return;
    }

    const pickupStartValue = pickupStart.value ?? null;
    const pickupEndValue = pickupEnd.value ?? null;
    const dropoffStartValue = dropoffStart.value ?? null;
    const dropoffEndValue = dropoffEnd.value ?? null;

    if (
      pickupStartValue !== null &&
      pickupEndValue !== null &&
      pickupStartValue > pickupEndValue
    ) {
      setError("Pickup start hour cannot be later than pickup end hour.");
      return;
    }

    if (
      dropoffStartValue !== null &&
      dropoffEndValue !== null &&
      dropoffStartValue > dropoffEndValue
    ) {
      setError("Dropoff start hour cannot be later than dropoff end hour.");
      return;
    }

    setSaving(true);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/availability-rules`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          advanceNoticeHours: advanceNotice.value,
          bufferBeforeMinutes: bufferBefore.value,
          bufferAfterMinutes: bufferAfter.value,
          allowedPickupStartHour: pickupStartValue,
          allowedPickupEndHour: pickupEndValue,
          allowedDropoffStartHour: dropoffStartValue,
          allowedDropoffEndHour: dropoffEndValue,
          isActive: form.isActive,
          csrfToken: csrfToken ?? null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        rules?: RulesPayload;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.rules) {
        throw new Error(payload.error ?? "Failed to save availability rules.");
      }

      setForm(toFormState(payload.rules));
      setDefaultsApplied(false);
      setMessage("Availability rules saved.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to save availability rules.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      data-testid="vehicle-availability-rules-panel"
      className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Availability Rules</h2>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Apply lead time, booking buffers, and pickup/dropoff hour windows for this vehicle.
          </p>
        </div>
        <p className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-muted)]">
          {defaultsApplied ? "Defaults" : "Vehicle override"}
        </p>
      </div>

      {loading ? <p className="mt-4 text-sm text-[var(--ccr-muted)]">Loading availability rules...</p> : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      {message ? <p className="mt-4 text-sm text-emerald-600">{message}</p> : null}

      {!loading ? (
        <form className="mt-4 space-y-4" onSubmit={handleSave}>
          <p className="text-xs text-[var(--ccr-muted)]">{helperText}</p>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
            <span>
              <span className="block text-sm font-semibold text-[var(--ccr-text)]">Rules active</span>
              <span className="block text-xs text-[var(--ccr-muted)]">
                Disable to fall back to default availability behavior for this vehicle.
              </span>
            </span>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((current) => ({ ...current, isActive: event.target.checked }))
              }
              className="h-5 w-5 accent-[var(--ccr-primary)]"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--ccr-muted)]">Advance notice (hours)</span>
              <input
                data-testid="availability-rules-advance-notice"
                type="number"
                min={0}
                step={1}
                value={form.advanceNoticeHours}
                onChange={(event) =>
                  setForm((current) => ({ ...current, advanceNoticeHours: event.target.value }))
                }
                className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--ccr-muted)]">Buffer before (minutes)</span>
              <input
                data-testid="availability-rules-buffer-before"
                type="number"
                min={0}
                step={1}
                value={form.bufferBeforeMinutes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, bufferBeforeMinutes: event.target.value }))
                }
                className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--ccr-muted)]">Buffer after (minutes)</span>
              <input
                data-testid="availability-rules-buffer-after"
                type="number"
                min={0}
                step={1}
                value={form.bufferAfterMinutes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, bufferAfterMinutes: event.target.value }))
                }
                className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="rounded-xl border border-[var(--ccr-border)] p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Pickup hour window
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-[var(--ccr-muted)]">Start hour (0-23)</span>
                  <input
                    data-testid="availability-rules-pickup-start"
                    type="number"
                    min={0}
                    max={23}
                    step={1}
                    value={form.allowedPickupStartHour}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, allowedPickupStartHour: event.target.value }))
                    }
                    className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-[var(--ccr-muted)]">End hour (0-23)</span>
                  <input
                    data-testid="availability-rules-pickup-end"
                    type="number"
                    min={0}
                    max={23}
                    step={1}
                    value={form.allowedPickupEndHour}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, allowedPickupEndHour: event.target.value }))
                    }
                    className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="rounded-xl border border-[var(--ccr-border)] p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Dropoff hour window
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-[var(--ccr-muted)]">Start hour (0-23)</span>
                  <input
                    data-testid="availability-rules-dropoff-start"
                    type="number"
                    min={0}
                    max={23}
                    step={1}
                    value={form.allowedDropoffStartHour}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, allowedDropoffStartHour: event.target.value }))
                    }
                    className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-[var(--ccr-muted)]">End hour (0-23)</span>
                  <input
                    data-testid="availability-rules-dropoff-end"
                    type="number"
                    min={0}
                    max={23}
                    step={1}
                    value={form.allowedDropoffEndHour}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, allowedDropoffEndHour: event.target.value }))
                    }
                    className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                  />
                </label>
              </div>
            </fieldset>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMessage(null);
                void loadRules();
              }}
              className={buttonStyles({ variant: "secondary", size: "sm" })}
            >
              Reset
            </button>
            <button
              data-testid="availability-rules-save"
              type="submit"
              disabled={saving}
              className={buttonStyles({ variant: "primary", size: "sm" })}
            >
              {saving ? "Saving..." : "Save Rules"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
