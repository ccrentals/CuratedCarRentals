"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PaginationSummary } from "@/components/admin/PaginationSummaryNav";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { SlideDownPanel } from "@/components/admin/SlideDownPanel";
import { formatJmd } from "@/lib/money";
import { buildLoadedPaginationProgress, STANDARD_PAGE_SIZE_OPTIONS } from "@/lib/pagination/sharedPagination";

type PromoRow = {
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
  redemption_count: number;
  remaining_redemptions: number | null;
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

function fromCommaSeparated(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toDateTimeLocalValue(date: string, time: string) {
  if (!date) return null;
  return `${date}T${time || "00:00"}`;
}

function generatePromoCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "CCR-";
  for (let index = 0; index < 8; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    code += alphabet[randomIndex];
  }
  return code;
}

function getPromoRuntimeStatus(promo: PromoRow, now = new Date()): PromoRuntimeStatus {
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

export default function AdminPromoCodesPage() {
  const [promos, setPromos] = useState<PromoRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [search, setSearch] = useState("");
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rowsPerPage, setRowsPerPage] = useState<number>(STANDARD_PAGE_SIZE_OPTIONS[0]);
  const [visibleCount, setVisibleCount] = useState<number>(STANDARD_PAGE_SIZE_OPTIONS[0]);

  const [code, setCode] = useState("");
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

  async function loadPromos(nextSearch = "") {
    setLoading(true);
    setError(null);
    const query = nextSearch.trim() ? `?q=${encodeURIComponent(nextSearch.trim())}` : "";
    const response = await fetch(`/api/admin/promo-codes${query}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(data.error ?? "Unable to load promo codes.");
      return;
    }
    setPromos(Array.isArray(data.promos) ? (data.promos as PromoRow[]) : []);
  }

  useEffect(() => {
    let isCurrent = true;

    async function bootstrap() {
      const [promosResponse, vehiclesResponse] = await Promise.all([
        fetch("/api/admin/promo-codes", { cache: "no-store" }),
        fetch("/api/admin/vehicles", { cache: "no-store" }),
      ]);
      const promosData = await promosResponse.json().catch(() => ({}));
      const vehiclesData = await vehiclesResponse.json().catch(() => ({}));

      if (!isCurrent) return;

      if (!promosResponse.ok) {
        setError(promosData.error ?? "Unable to load promo codes.");
        setPromos([]);
      } else {
        setPromos(Array.isArray(promosData.promos) ? (promosData.promos as PromoRow[]) : []);
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
      setIsBootstrapped(true);
    }

    void bootstrap();

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    if (!isBootstrapped) return;

    const timer = window.setTimeout(() => {
      const trimmed = search.trim();
      if (trimmed.length > 0 && trimmed.length < 3) return;
      void loadPromos(trimmed);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [isBootstrapped, search]);

  const selectedAllowedSet = useMemo(() => new Set(allowedVehicleIds), [allowedVehicleIds]);
  const selectedExcludedSet = useMemo(() => new Set(excludedVehicleIds), [excludedVehicleIds]);
  const visiblePromos = useMemo(
    () => promos.slice(0, Math.max(rowsPerPage, visibleCount)),
    [promos, rowsPerPage, visibleCount],
  );
  const pagination = useMemo(
    () => buildLoadedPaginationProgress(visiblePromos.length, promos.length, rowsPerPage),
    [visiblePromos.length, promos.length, rowsPerPage],
  );
  const hasMorePromos = visiblePromos.length < promos.length;

  async function submitCreatePromo() {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    setError(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch("/api/admin/promo-codes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        code,
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
      setError(data.error ?? "Unable to create promo code.");
      return;
    }

    setCode("");
    setDiscountType("PERCENT");
    setDiscountValue("");
    setMinSubtotal("");
    setMaxRedemptions("");
    setMaxPerCustomer("");
    setStartDate("");
    setStartTime("");
    setEndDate("");
    setEndTime("");
    setAllowedVehicleIds([]);
    setExcludedVehicleIds([]);
    setBlackoutDates("");
    setMessage("Promo code created.");
    await loadPromos(search);
  }

  async function toggleActive(promo: PromoRow) {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/promo-codes/${promo.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        action: "set_active",
        isActive: !promo.is_active,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "Unable to update promo code.");
      return;
    }
    await loadPromos(search);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Promo Codes</h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Create and manage promotional discounts used during booking checkout.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <SlideDownPanel
          title="Create promo code"
          description="Set validity windows, limits, and optional vehicle/date constraints."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-[var(--ccr-muted)]">
              Code
              <div className="mt-1 flex gap-2">
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  placeholder="SUMMER15"
                />
                <button
                  type="button"
                  onClick={() => setCode(generatePromoCode())}
                  className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                >
                  Generate
                </button>
              </div>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
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
            </div>

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
            <div className="grid gap-3 sm:grid-cols-2">
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
            </div>

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
                placeholder="2026-12-24, 2026-12-25"
              />
            </label>

            <div className="md:col-span-2 grid gap-3 md:grid-cols-2">
              <fieldset className="rounded-lg border border-[var(--ccr-border)] p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Allowed Vehicles
                </legend>
                <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                  {vehicles.map((vehicle) => (
                    <label key={vehicle.id} className="flex items-center gap-2 text-xs text-[var(--ccr-text)]">
                      <input
                        type="checkbox"
                        checked={selectedAllowedSet.has(vehicle.id)}
                        onChange={(event) => {
                          setAllowedVehicleIds((current) =>
                            event.target.checked
                              ? [...current, vehicle.id]
                              : current.filter((item) => item !== vehicle.id),
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
                <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                  {vehicles.map((vehicle) => (
                    <label key={vehicle.id} className="flex items-center gap-2 text-xs text-[var(--ccr-text)]">
                      <input
                        type="checkbox"
                        checked={selectedExcludedSet.has(vehicle.id)}
                        onChange={(event) => {
                          setExcludedVehicleIds((current) =>
                            event.target.checked
                              ? [...current, vehicle.id]
                              : current.filter((item) => item !== vehicle.id),
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
                onClick={submitCreatePromo}
                disabled={saving}
                className="rounded-lg bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Creating..." : "Create Promo"}
              </button>
              {message ? <p className="text-xs font-semibold text-[var(--ccr-text)]">{message}</p> : null}
              {error ? <p className="text-xs text-red-400">{error}</p> : null}
            </div>
          </div>
        </SlideDownPanel>
      </div>

      <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[260px] flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Search code
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="SUMMER, VIP, etc."
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <button
            type="button"
            onClick={() => loadPromos(search)}
            className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => {
              setSearch("");
              loadPromos("");
            }}
            className="rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {loading ? (
          <div className="px-6 py-10 text-sm text-[var(--ccr-muted)]">Loading promo codes…</div>
        ) : promos.length === 0 ? (
          <div className="px-6 py-10 text-sm text-[var(--ccr-muted)]">No promo codes found.</div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Valid Window</th>
                <th className="px-4 py-3">Redeemed</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visiblePromos.map((promo) => {
                const status = getPromoRuntimeStatus(promo);
                return (
                <tr key={promo.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[var(--ccr-text)]">{promo.code}</p>
                    <p className="mt-1 font-mono text-[10px] text-[var(--ccr-muted)]">{promo.id.slice(0, 8)}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">
                    {promo.discount_type === "PERCENT"
                      ? `${promo.discount_value}%`
                      : formatJmd(promo.discount_value)}
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">
                    {promoStatusLabel(status)}
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">
                    {promo.start_at ? new Date(promo.start_at).toLocaleString() : "Any time"} →{" "}
                    {promo.end_at ? new Date(promo.end_at).toLocaleString() : "No end"}
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">
                    {promo.redemption_count}
                    {promo.remaining_redemptions !== null ? ` (${promo.remaining_redemptions} left)` : ""}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => toggleActive(promo)}
                        className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                      >
                        {promo.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <Link
                        href={`/admin/promo-codes/${promo.id}`}
                        className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                      >
                        View/Edit
                      </Link>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {promos.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-[var(--ccr-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Rows per page
              <select
                value={String(rowsPerPage)}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  setRowsPerPage(nextValue);
                  setVisibleCount(nextValue);
                }}
                className="cursor-pointer rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
              >
                {STANDARD_PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={String(size)}>
                    {size}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
              <PaginationSummary
                from={pagination.from}
                to={pagination.to}
                totalCount={promos.length}
                page={pagination.page}
                totalPages={pagination.totalPages}
                className="mt-0 shrink-0 flex-nowrap justify-end gap-3 whitespace-nowrap"
              />
              <button
                type="button"
                onClick={() => setVisibleCount((current) => current + rowsPerPage)}
                disabled={!hasMorePromos}
                className="cursor-pointer rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {hasMorePromos ? "Load more" : "No more promo codes"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
