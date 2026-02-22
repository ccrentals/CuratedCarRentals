"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import {
  formatTagsInput,
  parseTagsInput,
  toDateInputValue,
  toDateTimeLocalValue,
  toIsoFromDateInput,
  toIsoFromDateTimeLocal,
} from "@/lib/quotes/quoteUi";
import { formatJmd } from "@/lib/money";

type LocationOption = {
  id: string;
  label: string;
  allow_pickup: boolean;
  allow_dropoff: boolean;
  is_active: boolean;
};

type AvailableVehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  category?: string;
};

type InsurancePlanOption = {
  id: string;
  vehicle_id: string | null;
  is_enabled: boolean;
  price_per_day_cents: number;
  is_global_default: boolean;
};

type PricingPreview = {
  days: number;
  baseTotal: number;
  insuranceTotal: number;
  discountTotal: number;
  subtotal: number;
  total: number;
  depositRequired: number;
  amountDue: number;
};

type QuoteCreateModalProps = {
  onCreated: (id: string) => void;
};

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function nowRoundedToMinutes() {
  const now = new Date();
  now.setSeconds(0, 0);
  return now;
}

function isLocationOption(value: unknown): value is LocationOption {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.label === "string";
}

function isVehicleOption(value: unknown): value is AvailableVehicle {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.make === "string" &&
    typeof row.model === "string" &&
    typeof row.year === "number"
  );
}

function isInsurancePlanOption(value: unknown): value is InsurancePlanOption {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.is_enabled === "boolean" &&
    typeof row.price_per_day_cents === "number"
  );
}

export function QuoteCreateModal({ onCreated }: QuoteCreateModalProps) {
  const [open, setOpen] = useState(false);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [vehicles, setVehicles] = useState<AvailableVehicle[]>([]);
  const [insurancePlans, setInsurancePlans] = useState<InsurancePlanOption[]>([]);

  const [customerFullName, setCustomerFullName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const [startAtLocal, setStartAtLocal] = useState(() => toDateTimeLocalValue(nowRoundedToMinutes()));
  const [endAtLocal, setEndAtLocal] = useState(() => toDateTimeLocalValue(addDays(nowRoundedToMinutes(), 2)));

  const [pickupLocationId, setPickupLocationId] = useState("");
  const [dropoffLocationId, setDropoffLocationId] = useState("");
  const [pickupLocationText, setPickupLocationText] = useState("");
  const [dropoffLocationText, setDropoffLocationText] = useState("");

  const [vehicleId, setVehicleId] = useState("");
  const [insuranceEnabled, setInsuranceEnabled] = useState(false);
  const [insurancePlanId, setInsurancePlanId] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [expiresDate, setExpiresDate] = useState(() => toDateInputValue(addDays(new Date(), 7).toISOString()));

  const [tagsInput, setTagsInput] = useState("");
  const [comments, setComments] = useState("");
  const [commissionPartnerName, setCommissionPartnerName] = useState("");
  const [clientPaysAtPartner, setClientPaysAtPartner] = useState(false);
  const [rackPriceInput, setRackPriceInput] = useState("");

  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const pickupLocations = useMemo(
    () => locations.filter((location) => location.is_active && location.allow_pickup),
    [locations],
  );
  const dropoffLocations = useMemo(
    () => locations.filter((location) => location.is_active && location.allow_dropoff),
    [locations],
  );

  const availableInsurancePlans = useMemo(() => {
    if (!insuranceEnabled) return [] as InsurancePlanOption[];
    return insurancePlans.filter(
      (plan) => plan.is_enabled && (!plan.vehicle_id || !vehicleId || plan.vehicle_id === vehicleId),
    );
  }, [insuranceEnabled, insurancePlans, vehicleId]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const loadBootstrap = useCallback(async () => {
    setLoadingBootstrap(true);
    setError(null);

    try {
      const [locationsResponse, insuranceResponse] = await Promise.all([
        fetch("/api/admin/booking-locations", { cache: "no-store" }),
        fetch("/api/admin/insurance-plans", { cache: "no-store" }),
      ]);

      const locationsData = (await locationsResponse.json().catch(() => ({}))) as {
        locations?: unknown[];
        error?: string;
      };
      const insuranceData = (await insuranceResponse.json().catch(() => ({}))) as {
        plans?: unknown[];
        error?: string;
      };

      if (!locationsResponse.ok) {
        throw new Error(locationsData.error ?? "Unable to load booking locations.");
      }
      if (!insuranceResponse.ok) {
        throw new Error(insuranceData.error ?? "Unable to load insurance plans.");
      }

      const nextLocations = Array.isArray(locationsData.locations)
        ? locationsData.locations.filter(isLocationOption)
        : [];
      const nextPlans = Array.isArray(insuranceData.plans)
        ? insuranceData.plans.filter(isInsurancePlanOption)
        : [];

      setLocations(nextLocations);
      setInsurancePlans(nextPlans);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load quote options.");
      setLocations([]);
      setInsurancePlans([]);
    } finally {
      setLoadingBootstrap(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadBootstrap();
  }, [loadBootstrap, open]);

  useEffect(() => {
    if (!open) return;

    const startIso = toIsoFromDateTimeLocal(startAtLocal);
    const endIso = toIsoFromDateTimeLocal(endAtLocal);
    if (!startIso || !endIso) {
      setVehicles([]);
      return;
    }

    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setVehicles([]);
      return;
    }

    const pickupDate = start.toISOString().slice(0, 10);
    const dropoffDate = end.toISOString().slice(0, 10);
    const pickupTime = startAtLocal.split("T")[1] ?? "00:00";
    const dropoffTime = endAtLocal.split("T")[1] ?? "23:59";

    let isCancelled = false;

    const loadVehicles = async () => {
      const params = new URLSearchParams({ pickupDate, dropoffDate, pickupTime, dropoffTime });
      const response = await fetch(`/api/public/vehicles?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { vehicles?: unknown[] };
      if (isCancelled) return;

      if (!response.ok) {
        setVehicles([]);
        return;
      }

      const nextVehicles = Array.isArray(payload.vehicles)
        ? payload.vehicles.filter(isVehicleOption)
        : [];
      setVehicles(nextVehicles);
      if (vehicleId && !nextVehicles.some((vehicle) => vehicle.id === vehicleId)) {
        setVehicleId("");
      }
    };

    void loadVehicles();

    return () => {
      isCancelled = true;
    };
  }, [endAtLocal, open, startAtLocal, vehicleId]);

  useEffect(() => {
    if (!open) return;
    if (!insuranceEnabled) {
      setInsurancePlanId("");
      return;
    }

    if (insurancePlanId && availableInsurancePlans.some((plan) => plan.id === insurancePlanId)) {
      return;
    }

    const preferred =
      availableInsurancePlans.find((plan) => plan.vehicle_id === vehicleId) ??
      availableInsurancePlans.find((plan) => plan.is_global_default) ??
      availableInsurancePlans[0];

    setInsurancePlanId(preferred?.id ?? "");
  }, [availableInsurancePlans, insuranceEnabled, insurancePlanId, open, vehicleId]);

  useEffect(() => {
    if (!open) return;
    if (!vehicleId) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    const startAt = toIsoFromDateTimeLocal(startAtLocal);
    const endAt = toIsoFromDateTimeLocal(endAtLocal);
    if (!startAt || !endAt) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let isCancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/public/pricing/quote", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            vehicleId,
            startAt,
            endAt,
            insuranceSelected: insuranceEnabled,
            promoCode: promoCode.trim() || null,
            customerEmail: customerEmail.trim() || null,
            paymentOption: "DEPOSIT",
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          summary?: PricingPreview;
        };

        if (isCancelled) return;

        if (!response.ok || !payload.ok || !payload.summary) {
          setPreview(null);
          setPreviewError(payload.error ?? "Unable to preview quote pricing.");
          return;
        }

        setPreview(payload.summary);
      } catch {
        if (isCancelled) return;
        setPreview(null);
        setPreviewError("Unable to preview quote pricing.");
      } finally {
        if (!isCancelled) {
          setPreviewLoading(false);
        }
      }
    }, 250);

    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerEmail, endAtLocal, insuranceEnabled, open, promoCode, startAtLocal, vehicleId]);

  const applyPickupLocation = useCallback(
    (nextId: string) => {
      setPickupLocationId(nextId);
      const selected = pickupLocations.find((location) => location.id === nextId);
      if (selected) {
        setPickupLocationText(selected.label);
      }
    },
    [pickupLocations],
  );

  const applyDropoffLocation = useCallback(
    (nextId: string) => {
      setDropoffLocationId(nextId);
      const selected = dropoffLocations.find((location) => location.id === nextId);
      if (selected) {
        setDropoffLocationText(selected.label);
      }
    },
    [dropoffLocations],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    const startAtIso = toIsoFromDateTimeLocal(startAtLocal);
    const endAtIso = toIsoFromDateTimeLocal(endAtLocal);
    if (!startAtIso || !endAtIso) {
      setError("Pickup and return dates are required.");
      setSubmitting(false);
      return;
    }

    const expiresAtIso = toIsoFromDateInput(expiresDate, "end");
    const csrfToken = await ensureCsrfToken();

    try {
      const response = await fetch("/api/admin/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          csrfToken,
          customer_full_name: customerFullName,
          customer_email: customerEmail,
          customer_phone: customerPhone || null,
          start_at: startAtIso,
          end_at: endAtIso,
          pickup_location_id: pickupLocationId || null,
          dropoff_location_id: dropoffLocationId || null,
          pickup_location_text: pickupLocationText,
          dropoff_location_text: dropoffLocationText,
          vehicle_id: vehicleId,
          insurance_enabled: insuranceEnabled,
          insurance_plan_id: insuranceEnabled ? insurancePlanId || null : null,
          promo_code: promoCode.trim() || null,
          expires_at: expiresAtIso,
          tags: parseTagsInput(tagsInput),
          comments: comments.trim() || null,
          commission_partner_name: commissionPartnerName.trim() || null,
          client_pays_at_partner: clientPaysAtPartner,
          rack_price_cents: rackPriceInput.trim() ? Number(rackPriceInput) : null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        item?: { id?: string };
      };

      if (!response.ok || !payload.ok || !payload.item?.id) {
        setError(payload.error ?? "Unable to create quote.");
        setSubmitting(false);
        return;
      }

      setSubmitting(false);
      setOpen(false);
      onCreated(payload.item.id);
    } catch {
      setError("Unable to create quote.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] ring-1 ring-[var(--ccr-accent)] transition hover:border-[var(--ccr-accent-strong)] hover:bg-[var(--ccr-surface-soft)]"
      >
        Create quote
      </button>

      <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          onClick={() => setOpen(false)}
        />
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Create quote"
          className={`absolute right-0 top-0 h-full w-full max-w-2xl border-l border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-2xl transition-transform duration-200 ease-out ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex h-full flex-col">
            <header className="flex items-start justify-between gap-3 border-b border-[var(--ccr-border)] px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Quotes</p>
                <h2 className="mt-1 text-lg font-bold text-[var(--ccr-text)]">Create Quote</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
              >
                Close
              </button>
            </header>

            <form id="quote-create-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-4">
                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    Customer full name
                    <input
                      required
                      value={customerFullName}
                      onChange={(event) => setCustomerFullName(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Customer email
                    <input
                      required
                      type="email"
                      value={customerEmail}
                      onChange={(event) => setCustomerEmail(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Customer phone
                    <input
                      value={customerPhone}
                      onChange={(event) => setCustomerPhone(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                </section>

                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Pickup date/time
                    <input
                      required
                      type="datetime-local"
                      value={startAtLocal}
                      onChange={(event) => setStartAtLocal(event.target.value)}
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Return date/time
                    <input
                      required
                      type="datetime-local"
                      value={endAtLocal}
                      onChange={(event) => setEndAtLocal(event.target.value)}
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Pickup location
                    <select
                      value={pickupLocationId}
                      onChange={(event) => applyPickupLocation(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    >
                      <option value="">Select pickup location</option>
                      {pickupLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Dropoff location
                    <select
                      value={dropoffLocationId}
                      onChange={(event) => applyDropoffLocation(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    >
                      <option value="">Select dropoff location</option>
                      {dropoffLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Pickup location text snapshot
                    <input
                      required
                      value={pickupLocationText}
                      onChange={(event) => setPickupLocationText(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Dropoff location text snapshot
                    <input
                      required
                      value={dropoffLocationText}
                      onChange={(event) => setDropoffLocationText(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                </section>

                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    Vehicle (available for selected window)
                    <select
                      required
                      value={vehicleId}
                      onChange={(event) => setVehicleId(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    >
                      <option value="">Select vehicle</option>
                      {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={insuranceEnabled}
                      onChange={(event) => setInsuranceEnabled(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Insurance enabled
                  </label>

                  {insuranceEnabled ? (
                    <label className="text-xs text-[var(--ccr-muted)] sm:col-span-2">
                      Insurance plan
                      <select
                        value={insurancePlanId}
                        onChange={(event) => setInsurancePlanId(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                      >
                        <option value="">Auto-select plan</option>
                        {availableInsurancePlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.vehicle_id ? "Vehicle plan" : "Global plan"} · {formatJmd(plan.price_per_day_cents)} / day
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Promo code
                    <input
                      value={promoCode}
                      onChange={(event) => setPromoCode(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                      placeholder="Optional"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Expires on
                    <input
                      type="date"
                      value={expiresDate}
                      onChange={(event) => setExpiresDate(event.target.value)}
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    Tags (comma-separated)
                    <input
                      value={tagsInput}
                      onChange={(event) => setTagsInput(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                      placeholder="vip, airport"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    Comments
                    <textarea
                      value={comments}
                      onChange={(event) => setComments(event.target.value)}
                      rows={3}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Commission partner
                    <input
                      value={commissionPartnerName}
                      onChange={(event) => setCommissionPartnerName(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Rack price (JMD)
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={rackPriceInput}
                      onChange={(event) => setRackPriceInput(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={clientPaysAtPartner}
                      onChange={(event) => setClientPaysAtPartner(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Client pays at partner
                  </label>
                </section>

                <section className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Pricing Preview</p>
                  {previewLoading ? <p className="mt-2 text-xs text-[var(--ccr-muted)]">Calculating...</p> : null}
                  {previewError ? <p className="mt-2 text-xs text-amber-200">{previewError}</p> : null}
                  {preview ? (
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--ccr-muted)] sm:grid-cols-4">
                      <div>
                        <dt>Base</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.baseTotal)}</dd>
                      </div>
                      <div>
                        <dt>Insurance</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.insuranceTotal)}</dd>
                      </div>
                      <div>
                        <dt>Discount</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">-{formatJmd(preview.discountTotal)}</dd>
                      </div>
                      <div>
                        <dt>Total</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.total)}</dd>
                      </div>
                      <div>
                        <dt>Subtotal</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.subtotal)}</dd>
                      </div>
                      <div>
                        <dt>Deposit</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.depositRequired)}</dd>
                      </div>
                      <div>
                        <dt>Amount due</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.amountDue)}</dd>
                      </div>
                      <div>
                        <dt>Days</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{preview.days}</dd>
                      </div>
                    </dl>
                  ) : null}
                </section>

                {error ? <p className="text-xs font-semibold text-red-300">{error}</p> : null}
                {loadingBootstrap ? <p className="text-xs text-[var(--ccr-muted)]">Loading options...</p> : null}
              </div>
            </form>

            <footer className="flex items-center justify-between border-t border-[var(--ccr-border)] px-5 py-4">
              <p className="text-xs text-[var(--ccr-muted)]">{formatTagsInput(parseTagsInput(tagsInput)) || "No tags"}</p>
              <button
                type="submit"
                form="quote-create-form"
                disabled={submitting}
                className="rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
              >
                {submitting ? "Saving..." : "Save quote"}
              </button>
            </footer>
          </div>
        </section>
      </div>
    </>
  );
}
