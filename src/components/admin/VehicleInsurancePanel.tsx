"use client";

import { useEffect, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { buttonStyles } from "@/components/ui/Button";

type InsurancePlanRow = {
  id: string;
  vehicle_id: string | null;
  is_enabled: boolean;
  price_per_day_cents: number;
  is_global_default: boolean;
};

type InsurancePayload = {
  plans?: InsurancePlanRow[];
  error?: string;
};

type VehicleInsurancePanelProps = {
  vehicleId: string;
  vehicleLabel: string;
};

export function VehicleInsurancePanel({ vehicleId, vehicleLabel }: VehicleInsurancePanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [pricePerDay, setPricePerDay] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadPlan() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/insurance-plans", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as InsurancePayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load insurance settings.");
      }
      const plans = Array.isArray(payload.plans) ? payload.plans : [];
      const vehiclePlan = plans.find((plan) => plan.vehicle_id === vehicleId);
      const globalPlan = plans.find((plan) => plan.is_global_default);
      const resolvedPlan = vehiclePlan ?? globalPlan;

      setEnabled(resolvedPlan?.is_enabled ?? false);
      setPricePerDay(String(resolvedPlan?.price_per_day_cents ?? 0));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load insurance settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPlan();
    // vehicleId is stable for this page lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  async function saveVehicleInsurance() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const normalizedPrice = Math.max(0, Math.round(Number(pricePerDay) || 0));
      const effectiveEnabled = enabled;

      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/insurance-plans", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          scope: "VEHICLE",
          vehicleId,
          isEnabled: effectiveEnabled,
          pricePerDayCents: normalizedPrice,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save insurance.");
      }
      setPricePerDay(String(normalizedPrice));
      setMessage("Insurance saved.");
      await loadPlan();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save insurance.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
      <h2 className="text-xl font-bold text-[var(--ccr-text)]">Vehicle Insurance</h2>
      <p className="mt-1 text-sm text-[var(--ccr-muted)]">
        Configure Full Coverage Insurance for <span className="font-semibold text-[var(--ccr-text)]">{vehicleLabel}</span>.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-[var(--ccr-muted)]">Loading insurance settings…</p>
      ) : (
        <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-[var(--ccr-muted)]">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="h-4 w-4 rounded border-[var(--ccr-border)] accent-[var(--ccr-accent)]"
              />
              Enabled
            </label>
            <input
              type="number"
              min={0}
              value={pricePerDay}
              onChange={(event) => setPricePerDay(event.target.value)}
              className="w-44 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
            <button
              type="button"
              onClick={saveVehicleInsurance}
              disabled={saving}
              className={buttonStyles({ variant: "primary", size: "sm" })}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--ccr-muted)]">Price is JMD per day.</p>
        </div>
      )}

      {message ? <p className="mt-3 text-sm font-semibold text-[var(--ccr-text)]">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
    </section>
  );
}
