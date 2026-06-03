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
  coverage_cents: number;
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
  coverageCents: string;
};

type InsurancePayload = {
  plans?: InsurancePlanRow[];
  vehicles?: VehicleRow[];
  error?: string;
};

type MinimumRentalDaysSettings = {
  globalDefaultDays: number;
};

type MinimumRentalDaysPayload = {
  minimumRentalDays?: MinimumRentalDaysSettings;
  error?: string;
};

type SecurityDepositsPayload = {
  securityDeposits?: {
    vehicleDepositsJmd?: Record<string, number | null>;
  };
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
  const [globalCoverage, setGlobalCoverage] = useState("155000");
  const [savingGlobalPlan, setSavingGlobalPlan] = useState(false);

  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [insurancePage, setInsurancePage] = useState(1);
  const [vehicleDrafts, setVehicleDrafts] = useState<Record<string, VehicleInsuranceDraft>>({});
  const [savingVehicleId, setSavingVehicleId] = useState<string | null>(null);
  const [minimumGlobalDays, setMinimumGlobalDays] = useState("2");
  const [savingMinimumGlobal, setSavingMinimumGlobal] = useState(false);
  const [securityDepositDrafts, setSecurityDepositDrafts] = useState<Record<string, string>>({});
  const [savingSecurityDepositVehicleId, setSavingSecurityDepositVehicleId] = useState<string | null>(
    null,
  );

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
        coverage_cents: 155000,
        is_global_default: true,
      } as InsurancePlanRow);
    setGlobalEnabled(globalPlan.is_enabled);
    setGlobalPricePerDay(String(globalPlan.price_per_day_cents ?? 0));
    setGlobalCoverage(String(globalPlan.coverage_cents ?? 155000));

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
        coverageCents: String(plan ? plan.coverage_cents : globalPlan.coverage_cents ?? 155000),
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

  const applyMinimumRentalDaysPayload = useCallback((payload: MinimumRentalDaysPayload) => {
    const minimumRentalDays = payload.minimumRentalDays ?? {
      globalDefaultDays: 2,
    };
    setMinimumGlobalDays(String(minimumRentalDays.globalDefaultDays ?? 2));
  }, []);

  const reloadMinimumRentalDaysConfiguration = useCallback(async () => {
    const response = await fetch("/api/admin/minimum-rental-days", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as MinimumRentalDaysPayload;
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load minimum rental days.");
    }
    applyMinimumRentalDaysPayload(payload);
  }, [applyMinimumRentalDaysPayload]);

  const applySecurityDepositsPayload = useCallback((payload: SecurityDepositsPayload) => {
    const deposits = payload.securityDeposits?.vehicleDepositsJmd ?? {};
    const drafts: Record<string, string> = {};
    for (const vehicleId of Object.keys(deposits)) {
      const amount = deposits[vehicleId];
      drafts[vehicleId] = typeof amount === "number" && amount > 0 ? String(amount) : "";
    }
    setSecurityDepositDrafts(drafts);
  }, []);

  const reloadSecurityDepositsConfiguration = useCallback(async () => {
    const response = await fetch("/api/admin/security-deposits", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as SecurityDepositsPayload;
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load security deposits.");
    }
    applySecurityDepositsPayload(payload);
  }, [applySecurityDepositsPayload]);

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
        const [insuranceResponse, minimumResponse, securityDepositsResponse] = await Promise.all([
          fetch("/api/admin/insurance-plans", { cache: "no-store" }),
          fetch("/api/admin/minimum-rental-days", { cache: "no-store" }),
          fetch("/api/admin/security-deposits", { cache: "no-store" }),
        ]);
        const insurancePayload = (await insuranceResponse.json().catch(() => ({}))) as InsurancePayload;
        const minimumPayload = (await minimumResponse.json().catch(() => ({}))) as MinimumRentalDaysPayload;
        const securityDepositsPayload = (await securityDepositsResponse.json().catch(
          () => ({}),
        )) as SecurityDepositsPayload;

        if (!insuranceResponse.ok) {
          throw new Error(insurancePayload.error ?? "Failed to load insurance plans.");
        }
        if (!minimumResponse.ok) {
          throw new Error(minimumPayload.error ?? "Failed to load minimum rental days.");
        }
        if (!securityDepositsResponse.ok) {
          throw new Error(securityDepositsPayload.error ?? "Failed to load security deposits.");
        }
        if (!active) return;

        applyInsurancePayload(insurancePayload);
        applyMinimumRentalDaysPayload(minimumPayload);
        applySecurityDepositsPayload(securityDepositsPayload);
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
  }, [applyInsurancePayload, applyMinimumRentalDaysPayload, applySecurityDepositsPayload]);

  async function saveGlobalInsurancePlan() {
    if (savingGlobalPlan) return;
    setSavingGlobalPlan(true);
    setStatus(null);
    setError(null);
    try {
      const normalizedPrice = Math.max(0, Math.round(Number(globalPricePerDay) || 0));
      const normalizedCoverage = Math.max(0, Math.round(Number(globalCoverage) || 0));
      const effectiveEnabled = globalEnabled;
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
          coverageCents: normalizedCoverage,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save global insurance plan.");
      }
      await reloadInsuranceConfiguration();
      setStatus("Global insurance plan saved.");
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
      const normalizedCoverage = Math.max(0, Math.round(Number(draft.coverageCents) || 0));
      const effectiveEnabled = draft.isEnabled;
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
          coverageCents: normalizedCoverage,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save vehicle insurance plan.");
      }
      await reloadInsuranceConfiguration();
      setStatus("Vehicle insurance plan saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save vehicle insurance plan.",
      );
    } finally {
      setSavingVehicleId(null);
    }
  }

  async function saveGlobalMinimumRentalDays() {
    if (savingMinimumGlobal) return;
    setSavingMinimumGlobal(true);
    setStatus(null);
    setError(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/minimum-rental-days", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          scope: "GLOBAL",
          minimumDays: minimumGlobalDays,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save global minimum rental days.");
      }
      await reloadMinimumRentalDaysConfiguration();
      setStatus("Global minimum rental days saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save global minimum rental days.",
      );
    } finally {
      setSavingMinimumGlobal(false);
    }
  }

  async function saveVehicleSecurityDeposit(vehicleId: string) {
    if (savingSecurityDepositVehicleId) return;
    setSavingSecurityDepositVehicleId(vehicleId);
    setStatus(null);
    setError(null);
    try {
      const draft = securityDepositDrafts[vehicleId] ?? "";
      const normalizedDeposit =
        draft.trim() === "" ? null : Math.max(0, Math.round(Number(draft) || 0));
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/security-deposits", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          vehicleId,
          securityDepositJmd: normalizedDeposit,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save vehicle security deposit.");
      }
      await reloadSecurityDepositsConfiguration();
      setStatus("Vehicle security deposit saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save vehicle security deposit.",
      );
    } finally {
      setSavingSecurityDepositVehicleId(null);
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

      <div className="mt-5 space-y-6">
        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Full Coverage Insurance
          </h3>

          <div className="mt-3 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Global Default
            </p>
            <div className="mt-2 grid gap-3 md:grid-cols-[auto_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] md:items-end">
              <label className="flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                <input
                  type="checkbox"
                  checked={globalEnabled}
                  onChange={(event) => setGlobalEnabled(event.target.checked)}
                  className="h-4 w-4 rounded border-[var(--ccr-border)] accent-[var(--ccr-accent)]"
                />
                Enabled
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Daily fee (JMD)
                <input
                  type="number"
                  min={0}
                  value={globalPricePerDay}
                  onChange={(event) => setGlobalPricePerDay(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Coverage (JMD)
                <input
                  type="number"
                  min={0}
                  value={globalCoverage}
                  onChange={(event) => setGlobalCoverage(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
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
                coverageCents: globalCoverage,
              };
              return (
                <div
                  key={vehicle.id}
                  className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3"
                >
                  <p className="text-sm font-semibold text-[var(--ccr-text)]">{vehicleLabel(vehicle)}</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-[auto_minmax(9rem,1fr)_minmax(9rem,1fr)_auto] md:items-end">
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
                    <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Daily fee (JMD)
                      <input
                        type="number"
                        min={0}
                        value={draft.pricePerDayCents}
                        onChange={(event) =>
                          setVehicleDrafts((current) => {
                            const nextValue = event.target.value;
                            return {
                              ...current,
                              [vehicle.id]: {
                                ...draft,
                                pricePerDayCents: nextValue,
                              },
                            };
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Coverage (JMD)
                      <input
                        type="number"
                        min={0}
                        value={draft.coverageCents}
                        onChange={(event) =>
                          setVehicleDrafts((current) => ({
                            ...current,
                            [vehicle.id]: {
                              ...draft,
                              coverageCents: event.target.value,
                            },
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                      />
                    </label>
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

        {error ? <p className="text-sm font-semibold text-red-500">{error}</p> : null}
        {status ? <p className="text-sm font-semibold text-[var(--ccr-text)]">{status}</p> : null}

        <BookingLocationBuilder />

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Refundable Security Deposits
          </h3>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Informational amount shown during booking. It is collected at pickup and is not added to
            online payment totals.
          </p>

          <div className="mt-3 space-y-2">
            {vehicles.map((vehicle) => {
              const draft = securityDepositDrafts[vehicle.id] ?? "";
              return (
                <div
                  key={vehicle.id}
                  className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3"
                >
                  <p className="text-sm font-semibold text-[var(--ccr-text)]">{vehicleLabel(vehicle)}</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-[minmax(10rem,1fr)_auto] md:items-end">
                    <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Refundable deposit (JMD)
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={draft}
                        placeholder="Leave blank for no message"
                        onChange={(event) =>
                          setSecurityDepositDrafts((current) => ({
                            ...current,
                            [vehicle.id]: event.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void saveVehicleSecurityDeposit(vehicle.id)}
                      disabled={savingSecurityDepositVehicleId === vehicle.id}
                      className={buttonStyles({ variant: "secondary", size: "xs" })}
                    >
                      {savingSecurityDepositVehicleId === vehicle.id ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              );
            })}
            {vehicles.length === 0 ? (
              <p className="text-xs text-[var(--ccr-muted)]">No vehicles found.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Minimum Rental Days
          </h3>

          <div className="mt-3 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Global Default
            </p>
            <div className="mt-2 grid gap-3 md:grid-cols-[minmax(10rem,1fr)_auto] md:items-end">
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Minimum days
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={minimumGlobalDays}
                  onChange={(event) => setMinimumGlobalDays(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <button
                type="button"
                onClick={saveGlobalMinimumRentalDays}
                disabled={savingMinimumGlobal}
                className={buttonStyles({ variant: "primary", size: "sm" })}
              >
                {savingMinimumGlobal ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
