"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { buttonStyles } from "@/components/ui/Button";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type DateRangeOverride = {
  start: string;
  end: string;
  dailyRateCents: number;
  depositCents: number | null;
};

type DeliveryZone = {
  label: string;
  feeCents: number;
};

type RulesPayload = {
  id: string | null;
  vehicleId: string;
  baseDailyRateCents: number | null;
  baseDepositCents: number | null;
  weekendDailyRateCents: number | null;
  dateRangeOverrides: DateRangeOverride[];
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  deliveryZones: DeliveryZone[];
  currency: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type VehiclePricingRulesPanelProps = {
  vehicleId: string;
};

type DateRangeFormItem = {
  start: string;
  end: string;
  dailyRateCents: string;
  depositCents: string;
};

type DeliveryZoneFormItem = {
  label: string;
  feeCents: string;
};

type FormState = {
  baseDailyRateCents: string;
  baseDepositCents: string;
  weekendDailyRateCents: string;
  dateRangeOverrides: DateRangeFormItem[];
  deliveryEnabled: boolean;
  deliveryFeeCents: string;
  deliveryZones: DeliveryZoneFormItem[];
  currency: string;
  isActive: boolean;
};

function toInput(value: number | null) {
  return value === null || Number.isNaN(value) ? "" : String(value);
}

function toFormState(rules: RulesPayload): FormState {
  return {
    baseDailyRateCents: toInput(rules.baseDailyRateCents),
    baseDepositCents: toInput(rules.baseDepositCents),
    weekendDailyRateCents: toInput(rules.weekendDailyRateCents),
    dateRangeOverrides: rules.dateRangeOverrides.map((entry) => ({
      start: entry.start,
      end: entry.end,
      dailyRateCents: String(entry.dailyRateCents),
      depositCents: toInput(entry.depositCents),
    })),
    deliveryEnabled: rules.deliveryEnabled,
    deliveryFeeCents: String(rules.deliveryFeeCents),
    deliveryZones: rules.deliveryZones.map((entry) => ({
      label: entry.label,
      feeCents: String(entry.feeCents),
    })),
    currency: rules.currency,
    isActive: rules.isActive,
  };
}

function parseOptionalMoney(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) return { value: null as number | null };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { error: `${label} must be a whole number greater than or equal to 0.` };
  }
  const rounded = Math.round(parsed);
  if (rounded < 0) {
    return { error: `${label} must be a whole number greater than or equal to 0.` };
  }
  return { value: rounded as number | null };
}

function parseRequiredMoney(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) return { value: 0 };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { error: `${label} must be a whole number greater than or equal to 0.` };
  }
  const rounded = Math.round(parsed);
  if (rounded < 0) {
    return { error: `${label} must be a whole number greater than or equal to 0.` };
  }
  return { value: rounded };
}

function addDateOverride(form: FormState) {
  return {
    ...form,
    dateRangeOverrides: [
      ...form.dateRangeOverrides,
      { start: "", end: "", dailyRateCents: "", depositCents: "" },
    ],
  };
}

function addDeliveryZone(form: FormState) {
  return {
    ...form,
    deliveryZones: [...form.deliveryZones, { label: "", feeCents: "" }],
  };
}

export function VehiclePricingRulesPanel({ vehicleId }: VehiclePricingRulesPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoringDefaults, setRestoringDefaults] = useState(false);
  const [defaultsApplied, setDefaultsApplied] = useState(true);
  const [form, setForm] = useState<FormState>({
    baseDailyRateCents: "",
    baseDepositCents: "",
    weekendDailyRateCents: "",
    dateRangeOverrides: [],
    deliveryEnabled: false,
    deliveryFeeCents: "0",
    deliveryZones: [],
    currency: "JMD",
    isActive: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const [rulesResponse, vehicleResponse] = await Promise.all([
        fetch(`/api/admin/vehicles/${vehicleId}/pricing-rules`, {
          cache: "no-store",
        }),
        fetch(`/api/admin/vehicles/${vehicleId}`, {
          cache: "no-store",
        }),
      ]);

      const payload = (await rulesResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        rules?: RulesPayload;
        defaultsApplied?: boolean;
        error?: string;
      };
      const vehiclePayload = (await vehicleResponse.json().catch(() => ({}))) as {
        vehicle?: {
          daily_rate_cents?: number;
          deposit_cents?: number;
        };
        error?: string;
      };

      if (!rulesResponse.ok || !payload.ok || !payload.rules) {
        throw new Error(payload.error ?? "Failed to load pricing rules.");
      }
      if (!vehicleResponse.ok || !vehiclePayload.vehicle) {
        throw new Error(vehiclePayload.error ?? "Failed to load vehicle pricing.");
      }

      const next = toFormState(payload.rules);
      next.baseDailyRateCents = toInput(vehiclePayload.vehicle.daily_rate_cents ?? 0);
      next.baseDepositCents = toInput(vehiclePayload.vehicle.deposit_cents ?? 0);
      setForm(next);
      setDefaultsApplied(Boolean(payload.defaultsApplied));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load pricing rules.");
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const panelState = useMemo(() => {
    if (defaultsApplied) {
      return {
        badgeLabel: "Defaults",
        helperText:
          "Base vehicle pricing is active. Save to create a vehicle-specific advanced pricing override for the public site and payment flows.",
        toggleHint: "Enable and save to apply vehicle-specific pricing rules for this vehicle.",
      };
    }
    if (!form.isActive) {
      return {
        badgeLabel: "Override inactive",
        helperText:
          "Saved vehicle-specific pricing values are inactive. Quotes, bookings, and payments currently use base vehicle pricing only.",
        toggleHint: "Enable to apply the saved advanced pricing rules for this vehicle.",
      };
    }
    return {
      badgeLabel: "Override active",
      helperText:
        "Vehicle-specific advanced pricing is active for public quotes, bookings, and payment totals.",
      toggleHint: "Disable to fall back to base vehicle pricing for this vehicle.",
    };
  }, [defaultsApplied, form.isActive]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const baseDaily = parseRequiredMoney(form.baseDailyRateCents, "Daily rate");
    if (baseDaily.error) {
      setSaving(false);
      setError(baseDaily.error);
      return;
    }

    const baseDeposit = parseRequiredMoney(form.baseDepositCents, "Deposit");
    if (baseDeposit.error) {
      setSaving(false);
      setError(baseDeposit.error);
      return;
    }

    const weekendDaily = parseOptionalMoney(form.weekendDailyRateCents, "Weekend daily rate");
    if (weekendDaily.error) {
      setSaving(false);
      setError(weekendDaily.error);
      return;
    }

    const deliveryFee = parseRequiredMoney(form.deliveryFeeCents, "Delivery fee");
    if (deliveryFee.error) {
      setSaving(false);
      setError(deliveryFee.error);
      return;
    }

    const dateRangeOverrides: DateRangeOverride[] = [];
    for (const entry of form.dateRangeOverrides) {
      const isBlank =
        !entry.start.trim() &&
        !entry.end.trim() &&
        !entry.dailyRateCents.trim() &&
        !entry.depositCents.trim();
      if (isBlank) continue;

      if (!entry.start.trim() || !entry.end.trim() || !entry.dailyRateCents.trim()) {
        setSaving(false);
        setError("Each date override requires start date, end date, and daily rate.");
        return;
      }
      if (entry.start > entry.end) {
        setSaving(false);
        setError("Date override start date cannot be after end date.");
        return;
      }

      const dailyRate = parseRequiredMoney(entry.dailyRateCents, "Date override daily rate");
      if (dailyRate.error) {
        setSaving(false);
        setError(dailyRate.error);
        return;
      }

      const depositRate = parseOptionalMoney(entry.depositCents, "Date override deposit");
      if (depositRate.error) {
        setSaving(false);
        setError(depositRate.error);
        return;
      }

      dateRangeOverrides.push({
        start: entry.start,
        end: entry.end,
        dailyRateCents: dailyRate.value ?? 0,
        depositCents: depositRate.value ?? null,
      });
    }

    const deliveryZones: DeliveryZone[] = [];
    for (const entry of form.deliveryZones) {
      const label = entry.label.trim();
      const feeValue = entry.feeCents.trim();
      const isBlank = !label && !feeValue;
      if (isBlank) continue;

      if (!label) {
        setSaving(false);
        setError("Each delivery zone must include a label.");
        return;
      }

      const zoneFee = parseRequiredMoney(entry.feeCents, "Delivery zone fee");
      if (zoneFee.error) {
        setSaving(false);
        setError(zoneFee.error);
        return;
      }
      deliveryZones.push({ label, feeCents: zoneFee.value ?? 0 });
    }

    try {
      const csrfToken = await ensureCsrfToken();
      const vehicleResponse = await fetch(`/api/admin/vehicles/${vehicleId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          daily_rate_cents: baseDaily.value ?? 0,
          deposit_cents: baseDeposit.value ?? 0,
        }),
      });

      const vehiclePayload = (await vehicleResponse.json().catch(() => ({}))) as {
        vehicle?: {
          daily_rate_cents?: number;
          deposit_cents?: number;
        };
        error?: string;
      };
      if (!vehicleResponse.ok || !vehiclePayload.vehicle) {
        throw new Error(vehiclePayload.error ?? "Failed to save vehicle pricing.");
      }

      const response = await fetch(`/api/admin/vehicles/${vehicleId}/pricing-rules`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          // Base rates are now managed on the vehicle record so all pricing surfaces stay in sync.
          baseDailyRateCents: null,
          baseDepositCents: null,
          weekendDailyRateCents: weekendDaily.value,
          dateRangeOverrides,
          deliveryEnabled: form.deliveryEnabled,
          deliveryFeeCents: deliveryFee.value ?? 0,
          deliveryZones,
          currency: form.currency.trim().toUpperCase() || "JMD",
          isActive: form.isActive,
          csrfToken: csrfToken ?? null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        rules?: RulesPayload;
        defaultsApplied?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.rules) {
        throw new Error(payload.error ?? "Failed to save pricing rules.");
      }

      const next = toFormState(payload.rules);
      next.baseDailyRateCents = toInput(vehiclePayload.vehicle.daily_rate_cents ?? 0);
      next.baseDepositCents = toInput(vehiclePayload.vehicle.deposit_cents ?? 0);
      setForm(next);
      setDefaultsApplied(Boolean(payload.defaultsApplied));
      setMessage("Vehicle pricing saved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to save vehicle pricing.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRestoreDefaults() {
    setError(null);
    setMessage(null);
    setRestoringDefaults(true);

    try {
      const csrfToken = await ensureCsrfToken();
      const [response, vehicleResponse] = await Promise.all([
        fetch(`/api/admin/vehicles/${vehicleId}/pricing-rules`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken ?? "",
          },
          body: JSON.stringify({
            csrfToken: csrfToken ?? null,
          }),
        }),
        fetch(`/api/admin/vehicles/${vehicleId}`, {
          cache: "no-store",
        }),
      ]);

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        rules?: RulesPayload;
        defaultsApplied?: boolean;
        error?: string;
      };
      const vehiclePayload = (await vehicleResponse.json().catch(() => ({}))) as {
        vehicle?: {
          daily_rate_cents?: number;
          deposit_cents?: number;
        };
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.rules) {
        throw new Error(payload.error ?? "Failed to restore default pricing rules.");
      }
      if (!vehicleResponse.ok || !vehiclePayload.vehicle) {
        throw new Error(vehiclePayload.error ?? "Failed to reload vehicle pricing.");
      }

      const next = toFormState(payload.rules);
      next.baseDailyRateCents = toInput(vehiclePayload.vehicle.daily_rate_cents ?? 0);
      next.baseDepositCents = toInput(vehiclePayload.vehicle.deposit_cents ?? 0);
      setForm(next);
      setDefaultsApplied(Boolean(payload.defaultsApplied));
      setMessage("Default pricing rules restored.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to restore default pricing rules.",
      );
    } finally {
      setRestoringDefaults(false);
    }
  }

  return (
    <section
      data-testid="vehicle-pricing-panel"
      className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Vehicle Pricing</h2>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Manage base vehicle pricing, delivery fees, and date-based pricing behavior.
          </p>
        </div>
        <p className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-muted)]">
          {panelState.badgeLabel}
        </p>
      </div>

      {loading ? <p className="mt-4 text-sm text-[var(--ccr-muted)]">Loading pricing rules...</p> : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      {message ? <p className="mt-4 text-sm text-emerald-600">{message}</p> : null}

      {!loading ? (
        <form className="mt-4 space-y-6" onSubmit={handleSave}>
          <p className="text-xs text-[var(--ccr-muted)]">
            {panelState.helperText}
          </p>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
            <span>
              <span className="block text-sm font-semibold text-[var(--ccr-text)]">Rules active</span>
              <span className="block text-xs text-[var(--ccr-muted)]">
                {panelState.toggleHint}
              </span>
            </span>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isActive: event.target.checked,
                }))
              }
              className="h-5 w-5 accent-[var(--ccr-primary)]"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--ccr-muted)]">Daily rate (cents)</span>
              <input
                data-testid="pricing-base-daily"
                type="number"
                min={0}
                step={1}
                value={form.baseDailyRateCents}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    baseDailyRateCents: event.target.value,
                  }))
                }
                className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--ccr-muted)]">Deposit (cents)</span>
              <input
                data-testid="pricing-base-deposit"
                type="number"
                min={0}
                step={1}
                value={form.baseDepositCents}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    baseDepositCents: event.target.value,
                  }))
                }
                className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--ccr-muted)]">Weekend daily rate (cents)</span>
              <input
                data-testid="pricing-weekend-daily"
                type="number"
                min={0}
                step={1}
                value={form.weekendDailyRateCents}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    weekendDailyRateCents: event.target.value,
                  }))
                }
                className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
              />
            </label>
          </div>

          <div
            data-testid="pricing-date-overrides"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--ccr-text)]">Date range overrides</p>
              <button
                type="button"
                onClick={() => setForm((current) => addDateOverride(current))}
                className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
              >
                Add range
              </button>
            </div>

            {form.dateRangeOverrides.length === 0 ? (
              <p className="text-xs text-[var(--ccr-muted)]">
                No date overrides yet. Add one to apply seasonal or event pricing.
              </p>
            ) : null}

            <div className="space-y-2">
              {form.dateRangeOverrides.map((entry, index) => (
                <div key={`date-override-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                  <input
                    type="date"
                    value={entry.start}
                    onChange={(event) =>
                      setForm((current) => {
                        const next = [...current.dateRangeOverrides];
                        next[index] = { ...next[index], start: event.target.value };
                        return { ...current, dateRangeOverrides: next };
                      })
                    }
                    className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                  />
                  <input
                    type="date"
                    value={entry.end}
                    onChange={(event) =>
                      setForm((current) => {
                        const next = [...current.dateRangeOverrides];
                        next[index] = { ...next[index], end: event.target.value };
                        return { ...current, dateRangeOverrides: next };
                      })
                    }
                    className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                  />
                  <input
                    type="number"
                    min={0}
                    step={1}
                    placeholder="Daily rate cents"
                    value={entry.dailyRateCents}
                    onChange={(event) =>
                      setForm((current) => {
                        const next = [...current.dateRangeOverrides];
                        next[index] = { ...next[index], dailyRateCents: event.target.value };
                        return { ...current, dateRangeOverrides: next };
                      })
                    }
                    className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                  />
                  <input
                    type="number"
                    min={0}
                    step={1}
                    placeholder="Deposit cents (optional)"
                    value={entry.depositCents}
                    onChange={(event) =>
                      setForm((current) => {
                        const next = [...current.dateRangeOverrides];
                        next[index] = { ...next[index], depositCents: event.target.value };
                        return { ...current, dateRangeOverrides: next };
                      })
                    }
                    className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        dateRangeOverrides: current.dateRangeOverrides.filter((_, rowIndex) => rowIndex !== index),
                      }))
                    }
                    className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-xs font-semibold text-[var(--ccr-text)]"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                <span className="text-xs font-semibold text-[var(--ccr-text)]">Enable delivery</span>
                <input
                  data-testid="pricing-delivery-enabled"
                  type="checkbox"
                  checked={form.deliveryEnabled}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      deliveryEnabled: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-[var(--ccr-primary)]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold text-[var(--ccr-muted)]">Delivery fee (cents)</span>
                <input
                  data-testid="pricing-delivery-fee"
                  type="number"
                  min={0}
                  step={1}
                  value={form.deliveryFeeCents}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      deliveryFeeCents: event.target.value,
                    }))
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold text-[var(--ccr-muted)]">Currency</span>
                <input
                  value={form.currency}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      currency: event.target.value.toUpperCase().slice(0, 8),
                    }))
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                />
              </label>
            </div>

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[var(--ccr-text)]">Delivery zones (optional)</p>
                <button
                  type="button"
                  onClick={() => setForm((current) => addDeliveryZone(current))}
                  className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
                >
                  Add zone
                </button>
              </div>

              {form.deliveryZones.length === 0 ? (
                <p className="text-xs text-[var(--ccr-muted)]">
                  No delivery zones configured. The default delivery fee is used when selected.
                </p>
              ) : null}

              {form.deliveryZones.map((entry, index) => (
                <div key={`delivery-zone-${index}`} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
                  <input
                    value={entry.label}
                    onChange={(event) =>
                      setForm((current) => {
                        const next = [...current.deliveryZones];
                        next[index] = { ...next[index], label: event.target.value };
                        return { ...current, deliveryZones: next };
                      })
                    }
                    placeholder="Zone label"
                    className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                  />
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={entry.feeCents}
                    onChange={(event) =>
                      setForm((current) => {
                        const next = [...current.deliveryZones];
                        next[index] = { ...next[index], feeCents: event.target.value };
                        return { ...current, deliveryZones: next };
                      })
                    }
                    placeholder="Fee cents"
                    className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-sm text-[var(--ccr-text)]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        deliveryZones: current.deliveryZones.filter((_, rowIndex) => rowIndex !== index),
                      }))
                    }
                    className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 text-xs font-semibold text-[var(--ccr-text)]"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => void loadRules()}
              disabled={saving || restoringDefaults}
              className={buttonStyles({
                variant: "secondary",
                size: "sm",
                className: "rounded-xl disabled:opacity-60",
              })}
            >
              Discard changes
            </button>
            {!defaultsApplied ? (
              <button
                type="button"
                onClick={() => void handleRestoreDefaults()}
                disabled={saving || restoringDefaults}
                className={buttonStyles({
                  variant: "secondary",
                  size: "sm",
                  className: "rounded-xl border-amber-500/40 text-amber-100 disabled:opacity-60",
                })}
              >
                {restoringDefaults ? "Restoring..." : "Restore defaults"}
              </button>
            ) : null}
            <button
              data-testid="pricing-save"
              type="submit"
              disabled={saving || restoringDefaults}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save pricing"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
