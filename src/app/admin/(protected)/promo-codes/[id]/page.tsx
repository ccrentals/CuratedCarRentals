"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { formatJmd } from "@/lib/money";

type PromoDetails = {
  id: string;
  code: string;
  is_active: boolean;
  discount_type: "PERCENT" | "FIXED";
  discount_value: number;
  min_subtotal_cents: number | null;
  max_redemptions: number | null;
  max_redemptions_per_customer: number | null;
  start_at: string | null;
  end_at: string | null;
  allowed_vehicle_ids_json: string[];
  excluded_vehicle_ids_json: string[];
  blackout_dates_json: string[];
  created_at: string;
  updated_at: string;
};

type RedemptionRow = {
  id: string;
  booking_id: string;
  customer_email: string | null;
  discount_amount_cents: number;
  created_at: string;
};

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  year: number;
};

type PromoRuntimeStatus = "ACTIVE" | "INACTIVE" | "EXPIRED";

function isVehicleRow(row: unknown): row is VehicleRow {
  if (!row || typeof row !== "object") return false;
  const value = row as Record<string, unknown>;
  return (
    typeof value.id === "string" &&
    typeof value.make === "string" &&
    typeof value.model === "string" &&
    typeof value.year === "number"
  );
}

function toDateTimeParts(value: string | null) {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const pad = (item: number) => String(item).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function toDateTimeLocalValue(date: string, time: string) {
  if (!date) return null;
  return `${date}T${time || "00:00"}`;
}

function fromCommaSeparated(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getPromoRuntimeStatus(promo: PromoDetails, now = new Date()): PromoRuntimeStatus {
  if (promo.end_at) {
    const end = new Date(promo.end_at);
    if (!Number.isNaN(end.getTime()) && end < now) {
      return "EXPIRED";
    }
  }
  if (!promo.is_active) return "INACTIVE";
  return "ACTIVE";
}

function promoStatusLabel(status: PromoRuntimeStatus) {
  if (status === "ACTIVE") return "Active";
  if (status === "INACTIVE") return "Inactive";
  return "Expired";
}

export default function AdminPromoCodeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const promoId = params?.id ?? "";
  const [promo, setPromo] = useState<PromoDetails | null>(null);
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [discountType, setDiscountType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [discountValue, setDiscountValue] = useState("");
  const [minSubtotal, setMinSubtotal] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [maxPerCustomer, setMaxPerCustomer] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allowedVehicleIds, setAllowedVehicleIds] = useState<string[]>([]);
  const [excludedVehicleIds, setExcludedVehicleIds] = useState<string[]>([]);
  const [blackoutDates, setBlackoutDates] = useState("");

  const selectedAllowedSet = useMemo(() => new Set(allowedVehicleIds), [allowedVehicleIds]);
  const selectedExcludedSet = useMemo(() => new Set(excludedVehicleIds), [excludedVehicleIds]);

  async function loadPromo() {
    if (!promoId) return;
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/admin/promo-codes/${promoId}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Unable to load promo code.");
      return;
    }

    const promoData = data.promo as PromoDetails;
    setPromo(promoData);
    setRedemptions(Array.isArray(data.redemptions) ? (data.redemptions as RedemptionRow[]) : []);
    setCode(promoData.code);
    setIsActive(promoData.is_active);
    setDiscountType(promoData.discount_type);
    setDiscountValue(String(promoData.discount_value));
    setMinSubtotal(promoData.min_subtotal_cents === null ? "" : String(promoData.min_subtotal_cents));
    setMaxRedemptions(promoData.max_redemptions === null ? "" : String(promoData.max_redemptions));
    setMaxPerCustomer(
      promoData.max_redemptions_per_customer === null
        ? ""
        : String(promoData.max_redemptions_per_customer),
    );
    const start = toDateTimeParts(promoData.start_at);
    const end = toDateTimeParts(promoData.end_at);
    setStartDate(start.date);
    setStartTime(start.time);
    setEndDate(end.date);
    setEndTime(end.time);
    setAllowedVehicleIds(promoData.allowed_vehicle_ids_json ?? []);
    setExcludedVehicleIds(promoData.excluded_vehicle_ids_json ?? []);
    setBlackoutDates((promoData.blackout_dates_json ?? []).join(", "));
  }

  useEffect(() => {
    if (!promoId) return;
    let isCurrent = true;

    async function bootstrap() {
      const [promoResponse, vehiclesResponse] = await Promise.all([
        fetch(`/api/admin/promo-codes/${promoId}`, { cache: "no-store" }),
        fetch("/api/admin/vehicles", { cache: "no-store" }),
      ]);
      const promoData = await promoResponse.json().catch(() => ({}));
      const vehiclesData = await vehiclesResponse.json().catch(() => ({}));

      if (!isCurrent) return;

      if (!promoResponse.ok) {
        setError(promoData.error ?? "Unable to load promo code.");
      } else {
        const nextPromo = promoData.promo as PromoDetails;
        setPromo(nextPromo);
        setRedemptions(Array.isArray(promoData.redemptions) ? (promoData.redemptions as RedemptionRow[]) : []);
        setCode(nextPromo.code);
        setIsActive(nextPromo.is_active);
        setDiscountType(nextPromo.discount_type);
        setDiscountValue(String(nextPromo.discount_value));
        setMinSubtotal(nextPromo.min_subtotal_cents === null ? "" : String(nextPromo.min_subtotal_cents));
        setMaxRedemptions(nextPromo.max_redemptions === null ? "" : String(nextPromo.max_redemptions));
        setMaxPerCustomer(
          nextPromo.max_redemptions_per_customer === null ? "" : String(nextPromo.max_redemptions_per_customer),
        );
        const start = toDateTimeParts(nextPromo.start_at);
        const end = toDateTimeParts(nextPromo.end_at);
        setStartDate(start.date);
        setStartTime(start.time);
        setEndDate(end.date);
        setEndTime(end.time);
        setAllowedVehicleIds(nextPromo.allowed_vehicle_ids_json ?? []);
        setExcludedVehicleIds(nextPromo.excluded_vehicle_ids_json ?? []);
        setBlackoutDates((nextPromo.blackout_dates_json ?? []).join(", "));
      }

      if (vehiclesResponse.ok) {
        const list = Array.isArray(vehiclesData?.vehicles) ? vehiclesData.vehicles : [];
        const mapped = list
          .filter(isVehicleRow)
          .map((row: VehicleRow) => ({ id: row.id, make: row.make, model: row.model, year: row.year }));
        setVehicles(mapped);
      } else {
        setVehicles([]);
      }

      setLoading(false);
    }

    void bootstrap();

    return () => {
      isCurrent = false;
    };
  }, [promoId]);

  async function savePromo() {
    if (!promoId || saving) return;
    setSaving(true);
    setMessage(null);
    setError(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/promo-codes/${promoId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        code,
        isActive,
        discountType,
        discountValue: Number(discountValue),
        minSubtotalCents: minSubtotal.trim() ? Number(minSubtotal) : null,
        maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null,
        maxRedemptionsPerCustomer: maxPerCustomer.trim() ? Number(maxPerCustomer) : null,
        startAt: toDateTimeLocalValue(startDate, startTime),
        endAt: toDateTimeLocalValue(endDate, endTime),
        allowedVehicleIds,
        excludedVehicleIds,
        blackoutDates: fromCommaSeparated(blackoutDates),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(data.error ?? "Unable to save promo code.");
      return;
    }
    setMessage("Promo code updated.");
    await loadPromo();
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      {promo ? (
        <div className="mb-3">
          <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]">
            {promoStatusLabel(getPromoRuntimeStatus(promo))}
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Promo</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">
            {promo ? promo.code : "Promo Code"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/promo-codes"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Back to promo codes
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm text-[var(--ccr-muted)]">
          Loading promo code…
        </div>
      ) : promo ? (
        <>
          <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Configuration</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-xs text-[var(--ccr-muted)]">
                Code
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  className="h-4 w-4"
                />
                Active
              </label>

              <label className="text-xs text-[var(--ccr-muted)]">
                Discount Type
                <select
                  value={discountType}
                  onChange={(event) => setDiscountType(event.target.value as "PERCENT" | "FIXED")}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                >
                  <option value="PERCENT">Percent</option>
                  <option value="FIXED">Fixed (JMD)</option>
                </select>
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Discount Value
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountValue}
                  onChange={(event) => setDiscountValue(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs text-[var(--ccr-muted)]">
                Min Subtotal (JMD)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={minSubtotal}
                  onChange={(event) => setMinSubtotal(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Max Redemptions
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={maxRedemptions}
                  onChange={(event) => setMaxRedemptions(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Max Per Customer
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={maxPerCustomer}
                  onChange={(event) => setMaxPerCustomer(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Start At
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="promo-date-time-input w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                  <input
                    type="time"
                    step={60}
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    className="promo-date-time-input w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </div>
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                End At
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  <input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="promo-date-time-input w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                  <input
                    type="time"
                    step={60}
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    className="promo-date-time-input w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </div>
              </label>
              <label className="text-xs text-[var(--ccr-muted)] md:col-span-2">
                Blackout dates (comma-separated YYYY-MM-DD)
                <input
                  value={blackoutDates}
                  onChange={(event) => setBlackoutDates(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <div className="md:col-span-2 grid gap-3 md:grid-cols-2">
                <fieldset className="rounded-lg border border-[var(--ccr-border)] p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Allowed Vehicles
                  </legend>
                  <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
                    {vehicles.map((vehicle) => (
                      <label key={vehicle.id} className="flex items-center gap-2 text-xs text-[var(--ccr-text)]">
                        <input
                          type="checkbox"
                          checked={selectedAllowedSet.has(vehicle.id)}
                          onChange={(event) => {
                            setAllowedVehicleIds((current) =>
                              event.target.checked
                                ? [...current, vehicle.id]
                                : current.filter((entry) => entry !== vehicle.id),
                            );
                          }}
                          className="h-4 w-4"
                        />
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="rounded-lg border border-[var(--ccr-border)] p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Excluded Vehicles
                  </legend>
                  <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
                    {vehicles.map((vehicle) => (
                      <label key={vehicle.id} className="flex items-center gap-2 text-xs text-[var(--ccr-text)]">
                        <input
                          type="checkbox"
                          checked={selectedExcludedSet.has(vehicle.id)}
                          onChange={(event) => {
                            setExcludedVehicleIds((current) =>
                              event.target.checked
                                ? [...current, vehicle.id]
                                : current.filter((entry) => entry !== vehicle.id),
                            );
                          }}
                          className="h-4 w-4"
                        />
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              <div className="md:col-span-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={savePromo}
                  disabled={saving}
                  className="rounded-lg bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                {message ? <p className="text-xs font-semibold text-[var(--ccr-text)]">{message}</p> : null}
                {error ? <p className="text-xs text-red-400">{error}</p> : null}
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--ccr-text)]">Redemption History</h2>
              <p className="text-xs text-[var(--ccr-muted)]">
                Total discount granted:{" "}
                <span className="font-semibold text-[var(--ccr-text)]">
                  {formatJmd(redemptions.reduce((sum, row) => sum + Number(row.discount_amount_cents || 0), 0))}
                </span>
              </p>
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--ccr-border)]">
              {redemptions.length === 0 ? (
                <div className="px-4 py-8 text-sm text-[var(--ccr-muted)]">No redemptions yet.</div>
              ) : (
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                    <tr>
                      <th className="px-3 py-2">Booking</th>
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2">Discount</th>
                      <th className="px-3 py-2">Redeemed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redemptions.map((row) => (
                      <tr key={row.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                        <td className="px-3 py-2">
                          <Link href={`/admin/bookings/${row.booking_id}`} className="font-mono text-xs text-[var(--ccr-text)]">
                            {row.booking_id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-[var(--ccr-text)]">{row.customer_email ?? "Unknown"}</td>
                        <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(row.discount_amount_cents)}</td>
                        <td className="px-3 py-2 text-[var(--ccr-muted)]">{new Date(row.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      ) : (
        <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm text-red-400">
          {error ?? "Promo code not found."}
        </div>
      )}
    </div>
  );
}
