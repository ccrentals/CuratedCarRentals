"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

type LocationRow = {
  id: string;
  label: string;
  allow_pickup: boolean;
  allow_dropoff: boolean;
  sort_order: number;
};

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

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [locationPage, setLocationPage] = useState(1);
  const [locationLabel, setLocationLabel] = useState("");
  const [locationAllowPickup, setLocationAllowPickup] = useState(true);
  const [locationAllowDropoff, setLocationAllowDropoff] = useState(true);
  const [locationSortOrder, setLocationSortOrder] = useState("0");
  const [savingLocation, setSavingLocation] = useState(false);

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

  const sortedLocations = useMemo(
    () =>
      [...locations].sort((a, b) =>
        a.sort_order === b.sort_order ? a.label.localeCompare(b.label) : a.sort_order - b.sort_order,
      ),
    [locations],
  );
  const locationPageCount = Math.max(1, Math.ceil(sortedLocations.length / PAGE_SIZE));
  const effectiveLocationPage = Math.min(locationPage, locationPageCount);
  const pagedLocations = useMemo(() => {
    const offset = (effectiveLocationPage - 1) * PAGE_SIZE;
    return sortedLocations.slice(offset, offset + PAGE_SIZE);
  }, [effectiveLocationPage, sortedLocations]);
  const locationStartIndex = sortedLocations.length === 0 ? 0 : (effectiveLocationPage - 1) * PAGE_SIZE + 1;
  const locationEndIndex =
    sortedLocations.length === 0 ? 0 : Math.min(sortedLocations.length, effectiveLocationPage * PAGE_SIZE);

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
    setLocationPage((current) => Math.min(current, locationPageCount));
  }, [locationPageCount]);

  useEffect(() => {
    setInsurancePage((current) => Math.min(current, insurancePageCount));
  }, [insurancePageCount]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [locationsResponse, insuranceResponse] = await Promise.all([
          fetch("/api/admin/booking-locations", { cache: "no-store" }),
          fetch("/api/admin/insurance-plans", { cache: "no-store" }),
        ]);

        const locationsPayload = (await locationsResponse
          .json()
          .catch(() => ({}))) as { locations?: LocationRow[]; error?: string };
        const insurancePayload = (await insuranceResponse
          .json()
          .catch(() => ({}))) as InsurancePayload;

        if (!locationsResponse.ok) {
          throw new Error(locationsPayload.error ?? "Failed to load locations.");
        }
        if (!insuranceResponse.ok) {
          throw new Error(insurancePayload.error ?? "Failed to load insurance plans.");
        }
        if (!active) return;

        const nextLocations = Array.isArray(locationsPayload.locations)
          ? locationsPayload.locations
          : [];
        setLocations(nextLocations);
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

  async function addLocation() {
    if (savingLocation) return;
    setSavingLocation(true);
    setStatus(null);
    setError(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/booking-locations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          label: locationLabel,
          allowPickup: locationAllowPickup,
          allowDropoff: locationAllowDropoff,
          sortOrder: Number(locationSortOrder),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save location.");
      }

      const reload = await fetch("/api/admin/booking-locations", { cache: "no-store" });
      const payload = (await reload.json().catch(() => ({}))) as {
        locations?: LocationRow[];
        error?: string;
      };
      if (!reload.ok) {
        throw new Error(payload.error ?? "Failed to refresh locations.");
      }

      setLocations(Array.isArray(payload.locations) ? payload.locations : []);
      setLocationLabel("");
      setLocationSortOrder("0");
      setLocationAllowPickup(true);
      setLocationAllowDropoff(true);
      setStatus("Location saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save location.");
    } finally {
      setSavingLocation(false);
    }
  }

  async function deleteLocation(id: string) {
    setStatus(null);
    setError(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/booking-locations", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ id }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to delete location.");
      }
      setLocations((current) => current.filter((location) => location.id !== id));
      setStatus("Location deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete location.");
    }
  }

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
        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Locations
          </h3>
          <div className="mt-3 grid gap-2">
            <input
              value={locationLabel}
              onChange={(event) => setLocationLabel(event.target.value)}
              placeholder="Location label"
              className="w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <label className="flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                <input
                  type="checkbox"
                  checked={locationAllowPickup}
                  onChange={(event) => setLocationAllowPickup(event.target.checked)}
                  className="h-4 w-4 rounded border-[var(--ccr-border)] accent-[var(--ccr-accent)]"
                />
                Pickup
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                <input
                  type="checkbox"
                  checked={locationAllowDropoff}
                  onChange={(event) => setLocationAllowDropoff(event.target.checked)}
                  className="h-4 w-4 rounded border-[var(--ccr-border)] accent-[var(--ccr-accent)]"
                />
                Dropoff
              </label>
            </div>
            <input
              value={locationSortOrder}
              onChange={(event) => setLocationSortOrder(event.target.value)}
              type="number"
              min={0}
              placeholder="Sort order"
              className="w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
            <button
              type="button"
              onClick={addLocation}
              disabled={savingLocation}
              className="rounded-lg bg-[var(--ccr-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {savingLocation ? "Saving..." : "Add / Update Location"}
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {pagedLocations.map((location) => (
              <div
                key={location.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--ccr-text)]">{location.label}</p>
                  <p className="text-xs text-[var(--ccr-muted)]">
                    {location.allow_pickup ? "Pickup" : ""}
                    {location.allow_pickup && location.allow_dropoff ? " + " : ""}
                    {location.allow_dropoff ? "Dropoff" : ""}
                    {` · order ${location.sort_order}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteLocation(location.id)}
                  className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
                >
                  Delete
                </button>
              </div>
            ))}
            {pagedLocations.length === 0 ? (
              <p className="text-xs text-[var(--ccr-muted)]">No booking locations configured.</p>
            ) : null}
            {sortedLocations.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-[var(--ccr-muted)]">
                <span>
                  Showing {locationStartIndex}-{locationEndIndex} of {sortedLocations.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setLocationPage((current) => Math.max(1, current - 1))}
                    disabled={effectiveLocationPage <= 1}
                    className="rounded-md border border-[var(--ccr-border)] px-2 py-1 font-semibold text-[var(--ccr-text)] disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <span>
                    Page {effectiveLocationPage} of {locationPageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setLocationPage((current) => Math.min(locationPageCount, current + 1))
                    }
                    disabled={effectiveLocationPage >= locationPageCount}
                    className="rounded-md border border-[var(--ccr-border)] px-2 py-1 font-semibold text-[var(--ccr-text)] disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

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
                className="rounded-lg bg-[var(--ccr-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
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
                      className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
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
                    className="rounded-md border border-[var(--ccr-border)] px-2 py-1 font-semibold text-[var(--ccr-text)] disabled:opacity-50"
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
                    className="rounded-md border border-[var(--ccr-border)] px-2 py-1 font-semibold text-[var(--ccr-text)] disabled:opacity-50"
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
