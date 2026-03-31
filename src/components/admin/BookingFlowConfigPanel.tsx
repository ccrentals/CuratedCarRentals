"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { BookingLocationBuilder } from "@/components/admin/BookingLocationBuilder";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { buttonStyles } from "@/components/ui/Button";

type InsurancePlanRow = {
  id: string;
  vehicle_id: string | null;
  is_enabled: boolean;
  price_per_day_cents: number;
  is_global_default: boolean;
};

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  status: string;
};

type VehicleInsuranceDraft = {
  isEnabled: boolean;
  pricePerDayCents: string;
};

type InsurancePayload = {
  plans?: InsurancePlanRow[];
  vehicles?: VehicleRow[];
  error?: string;
};

function vehicleLabel(vehicle: VehicleRow) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim();
}

const PAGE_SIZE = 10;

export function BookingFlowConfigPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [globalPricePerDay, setGlobalPricePerDay] = useState("0");
  const [savingGlobalPlan, setSavingGlobalPlan] = useState(false);

  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [insurancePage, setInsurancePage] = useState(1);
  const [vehicleDrafts, setVehicleDrafts] = useState<Record<string, VehicleInsuranceDraft>>({});
  const [savingVehicleId, setSavingVehicleId] = useState<string | null>(null);

  const applyInsurancePayload = useCallback((payload: InsurancePayload) => {
    const plans = Array.isArray(payload.plans) ? payload.plans : [];
    const nextVehicles = Array.isArray(payload.vehicles) ? payload.vehicles : [];
    setVehicles(nextVehicles);

    const globalPlan =
      plans.find((plan) => plan.is_global_default) ??
      ({
        id: "",
        vehicle_id: null,
        is_enabled: false,
        price_per_day_cents: 0,
        is_global_default: true,
      } as InsurancePlanRow);
    setGlobalEnabled(globalPlan.is_enabled);
    setGlobalPricePerDay(String(globalPlan.price_per_day_cents ?? 0));

    const byVehicleId = new Map<string, InsurancePlanRow>();
    for (const plan of plans) {
      if (plan.vehicle_id && !byVehicleId.has(plan.vehicle_id)) {
        byVehicleId.set(plan.vehicle_id, plan);
      }
    }

    const drafts: Record<string, VehicleInsuranceDraft> = {};
    for (const vehicle of nextVehicles) {
      const plan = byVehicleId.get(vehicle.id);
      drafts[vehicle.id] = {
        isEnabled: plan ? plan.is_enabled : globalPlan.is_enabled,
        pricePerDayCents: String(
          plan ? plan.price_per_day_cents : globalPlan.price_per_day_cents ?? 0,
        ),
      };
    }
    setVehicleDrafts(drafts);
  }, []);

  const reloadInsuranceConfiguration = useCallback(async () => {
    const insuranceResponse = await fetch("/api/admin/insurance-plans", { cache: "no-store" });
    const insurancePayload = (await insuranceResponse
      .json()
      .catch(() => ({}))) as InsurancePayload;
    if (!insuranceResponse.ok) {
      throw new Error(insurancePayload.error ?? "Failed to load insurance plans.");
    }
    applyInsurancePayload(insurancePayload);
  }, [applyInsurancePayload]);

  const insurancePageCount = Math.max(1, Math.ceil(vehicles.length / PAGE_SIZE));
  const effectiveInsurancePage = Math.min(insurancePage, insurancePageCount);
  const pagedVehicles = useMemo(() => {
    const offset = (effectiveInsurancePage - 1) * PAGE_SIZE;
    return vehicles.slice(offset, offset + PAGE_SIZE);
  }, [effectiveInsurancePage, vehicles]);
  const insuranceStartIndex = vehicles.length === 0 ? 0 : (effectiveInsurancePage - 1) * PAGE_SIZE + 1;
  const insuranceEndIndex =
    vehicles.length === 0 ? 0 : Math.min(vehicles.length, effectiveInsurancePage * PAGE_SIZE);

  useEffect(() => {
    setInsurancePage((current) => Math.min(current, insurancePageCount));
  }, [insurancePageCount]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const insuranceResponse = await fetch("/api/admin/insurance-plans", { cache: "no-store" });
        const insurancePayload = (await insuranceResponse
          .json()
          .catch(() => ({}))) as InsurancePayload;

        if (!insuranceResponse.ok) {
          throw new Error(insurancePayload.error ?? "Failed to load insurance plans.");
        }
        if (!active) return;

        applyInsurancePayload(insurancePayload);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load configuration.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [applyInsurancePayload]);

  async function saveGlobalInsurancePlan() {
    if (savingGlobalPlan) return;
    setSavingGlobalPlan(true);
    setStatus(null);
    setError(null);
    try {
      const normalizedPrice = Math.max(0, Math.round(Number(globalPricePerDay) || 0));
      const effectiveEnabled = globalEnabled || normalizedPrice > 0;
      if (effectiveEnabled && !globalEnabled) {
        setGlobalEnabled(true);
      }
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/insurance-plans", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          scope: "GLOBAL",
          isEnabled: effectiveEnabled,
          pricePerDayCents: normalizedPrice,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save global insurance plan.");
      }
      await reloadInsuranceConfiguration();
      setStatus(
        effectiveEnabled && !globalEnabled
          ? "Global insurance plan saved (auto-enabled because price is greater than zero)."
          : "Global insurance plan saved.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save global insurance plan.",
      );
    } finally {
      setSavingGlobalPlan(false);
    }
  }

  async function saveVehicleInsurancePlan(vehicleId: string) {
    const draft = vehicleDrafts[vehicleId];
    if (!draft) return;
    setSavingVehicleId(vehicleId);
    setStatus(null);
    setError(null);
    try {
      const normalizedPrice = Math.max(0, Math.round(Number(draft.pricePerDayCents) || 0));
      const effectiveEnabled = draft.isEnabled || normalizedPrice > 0;
      if (effectiveEnabled && !draft.isEnabled) {
        setVehicleDrafts((current) => ({
          ...current,
          [vehicleId]: {
            ...draft,
            isEnabled: true,
            pricePerDayCents: String(normalizedPrice),
          },
        }));
      }
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
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save vehicle insurance plan.");
      }
      await reloadInsuranceConfiguration();
      setStatus(
        effectiveEnabled && !draft.isEnabled
          ? "Vehicle insurance plan saved (auto-enabled because price is greater than zero)."
          : "Vehicle insurance plan saved.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save vehicle insurance plan.",
      );
    } finally {
      setSavingVehicleId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--ccr-text)]">Booking Flow Configuration</h2>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Manage pickup/dropoff locations and Full Coverage Insurance pricing.
          </p>
        </div>
        {loading ? <span className="text-xs text-[var(--ccr-muted)]">Loading…</span> : null}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <BookingLocationBuilder />

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Full Coverage Insurance
          </h3>

          <div className="mt-3 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Global Default
            </p>
            <div className="mt-2 flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                <input
                  type="checkbox"
                  checked={globalEnabled}
                  onChange={(event) => setGlobalEnabled(event.target.checked)}
                  className="h-4 w-4 rounded border-[var(--ccr-border)] accent-[var(--ccr-accent)]"
                />
                Enabled
              </label>
              <input
                type="number"
                min={0}
                value={globalPricePerDay}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setGlobalPricePerDay(nextValue);
                  const parsed = Number(nextValue);
                  if (!globalEnabled && Number.isFinite(parsed) && parsed > 0) {
                    setGlobalEnabled(true);
                  }
                }}
                className="w-36 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
              <button
                type="button"
                onClick={saveGlobalInsurancePlan}
                disabled={savingGlobalPlan}
                className={buttonStyles({ variant: "primary", size: "sm" })}
              >
                {savingGlobalPlan ? "Saving..." : "Save"}
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {pagedVehicles.map((vehicle) => {
              const draft = vehicleDrafts[vehicle.id] ?? {
                isEnabled: false,
                pricePerDayCents: "0",
              };
              return (
                <div
                  key={vehicle.id}
                  className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3"
                >
                  <p className="text-sm font-semibold text-[var(--ccr-text)]">{vehicleLabel(vehicle)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                      <input
                        type="checkbox"
                        checked={draft.isEnabled}
                        onChange={(event) =>
                          setVehicleDrafts((current) => ({
                            ...current,
                            [vehicle.id]: {
                              ...draft,
                              isEnabled: event.target.checked,
                            },
                          }))
                        }
                        className="h-4 w-4 rounded border-[var(--ccr-border)] accent-[var(--ccr-accent)]"
                      />
                      Enabled
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={draft.pricePerDayCents}
                      onChange={(event) =>
                        setVehicleDrafts((current) => {
                          const nextValue = event.target.value;
                          const parsed = Number(nextValue);
                          return {
                            ...current,
                            [vehicle.id]: {
                              ...draft,
                              pricePerDayCents: nextValue,
                              isEnabled:
                                draft.isEnabled || (Number.isFinite(parsed) && parsed > 0),
                            },
                          };
                        })
                      }
                      className="w-32 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                    <button
                      type="button"
                      onClick={() => void saveVehicleInsurancePlan(vehicle.id)}
                      disabled={savingVehicleId === vehicle.id}
                      className={buttonStyles({ variant: "secondary", size: "xs" })}
                    >
                      {savingVehicleId === vehicle.id ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              );
            })}
            {pagedVehicles.length === 0 ? (
              <p className="text-xs text-[var(--ccr-muted)]">No vehicles found.</p>
            ) : null}
            {vehicles.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-[var(--ccr-muted)]">
                <span>
                  Showing {insuranceStartIndex}-{insuranceEndIndex} of {vehicles.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInsurancePage((current) => Math.max(1, current - 1))}
                    disabled={effectiveInsurancePage <= 1}
                    className={buttonStyles({
                      variant: "secondary",
                      size: "xs",
                      className: "rounded-md px-2",
                    })}
                  >
                    Prev
                  </button>
                  <span>
                    Page {effectiveInsurancePage} of {insurancePageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setInsurancePage((current) => Math.min(insurancePageCount, current + 1))
                    }
                    disabled={effectiveInsurancePage >= insurancePageCount}
                    className={buttonStyles({
                      variant: "secondary",
                      size: "xs",
                      className: "rounded-md px-2",
                    })}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <p className="mt-4 text-sm font-semibold text-red-500">{error}</p> : null}
      {status ? <p className="mt-4 text-sm font-semibold text-[var(--ccr-text)]">{status}</p> : null}
    </section>
  );
}
