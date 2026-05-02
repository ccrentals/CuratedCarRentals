"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PaginationSummaryNav } from "@/components/admin/PaginationSummaryNav";
import { SlideDownPanel } from "@/components/admin/SlideDownPanel";
import { StackedDateTimeRange } from "@/components/shared/StackedDateTimeRange";
import { fmtAdminDateTimeNoSeconds } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import { STANDARD_PAGE_SIZE_OPTIONS, normalizePageSize } from "@/lib/pagination/sharedPagination";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type PromoAdminState = "ACTIVE" | "INACTIVE" | "SCHEDULED" | "EXPIRED" | "LIMIT_REACHED";

type PromoRow = {
  id: string;
  public_id: string;
  code: string;
  is_active: boolean;
  discount_type: "PERCENT" | "FIXED";
  apply_scope: "OVERALL_TOTAL" | "DAYS_TOTAL";
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
  current_redemption_count: number;
  remaining_redemptions: number | null;
  admin_state: PromoAdminState;
};

type PromoPageResponse = {
  promos: PromoRow[];
  totalCount: number;
  page: number;
  totalPages: number;
  rowsPerPage: number;
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
};

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  year: number;
};

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

function promoStatusLabel(status: PromoAdminState) {
  if (status === "ACTIVE") return "Active";
  if (status === "INACTIVE") return "Inactive";
  if (status === "SCHEDULED") return "Scheduled";
  if (status === "LIMIT_REACHED") return "Limit reached";
  return "Expired";
}

function promoApplyScopeLabel(scope: PromoRow["apply_scope"]) {
  return scope === "DAYS_TOTAL" ? "Rental days total" : "Overall subtotal";
}

function promoMinThresholdLabel(scope: PromoRow["apply_scope"] | "OVERALL_TOTAL" | "DAYS_TOTAL") {
  return scope === "DAYS_TOTAL" ? "Min rental-days total" : "Min overall subtotal (JMD)";
}

function promoDiscountInputLabel(type: "PERCENT" | "FIXED") {
  return type === "PERCENT" ? "Discount percentage" : "Discount amount";
}

function formatWindowLabel(value: string | null, fallback: string) {
  if (!value) return fallback;
  return `${fmtAdminDateTimeNoSeconds(value)} Jamaica time`;
}

function buildConstraintBadges(promo: PromoRow) {
  const badges: string[] = [];
  if (promo.min_subtotal_cents !== null) {
    badges.push(`Min ${formatJmd(promo.min_subtotal_cents)}`);
  }
  if (promo.max_redemptions_per_customer !== null) {
    badges.push(`Per customer ${promo.max_redemptions_per_customer}`);
  }
  if (promo.allowed_vehicle_ids_json.length > 0) {
    badges.push(`Allowed vehicles ${promo.allowed_vehicle_ids_json.length}`);
  }
  if (promo.excluded_vehicle_ids_json.length > 0) {
    badges.push(`Excluded vehicles ${promo.excluded_vehicle_ids_json.length}`);
  }
  if (promo.blackout_dates_json.length > 0) {
    badges.push(`Blackout dates ${promo.blackout_dates_json.length}`);
  }
  return badges;
}

const EMPTY_PROMO_PAGE: PromoPageResponse = {
  promos: [],
  totalCount: 0,
  page: 1,
  totalPages: 1,
  rowsPerPage: STANDARD_PAGE_SIZE_OPTIONS[0],
  from: 0,
  to: 0,
  hasPrev: false,
  hasNext: false,
};

export default function AdminPromoCodesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const queryParam = searchParams.get("q") ?? "";
  const pageParam = searchParams.get("page") ?? "";
  const rowsPerPage = normalizePageSize(searchParams.get("rows") ?? undefined);

  const [promoPage, setPromoPage] = useState<PromoPageResponse>(EMPTY_PROMO_PAGE);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [search, setSearch] = useState(queryParam);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [discountType, setDiscountType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [applyScope, setApplyScope] = useState<"OVERALL_TOTAL" | "DAYS_TOTAL">("DAYS_TOTAL");
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(queryParam);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [queryParam]);

  const updateParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (!value) {
          params.delete(key);
          return;
        }
        params.set(key, value);
      });

      const next = params.toString();
      const nextUrl = next ? `${pathname}?${next}` : pathname;
      const current = searchParams.toString();
      const currentUrl = current ? `${pathname}?${current}` : pathname;
      if (nextUrl !== currentUrl) {
        router.replace(nextUrl, { scroll: false });
      }
    },
    [pathname, router, searchParams],
  );

  const loadPromos = useCallback(
    async (input: { q?: string; page?: string; rows?: number } = {}) => {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      const nextQuery = (input.q ?? queryParam).trim();
      const nextPage = input.page ?? pageParam;
      const nextRows = input.rows ?? rowsPerPage;

      if (nextQuery) params.set("q", nextQuery);
      if (nextPage) params.set("page", nextPage);
      if (nextRows !== STANDARD_PAGE_SIZE_OPTIONS[0]) {
        params.set("rows", String(nextRows));
      }

      const response = await fetch(`/api/admin/promo-codes${params.toString() ? `?${params}` : ""}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as Partial<PromoPageResponse> & {
        error?: string;
      };
      setLoading(false);

      if (!response.ok) {
        setError(data.error ?? "Unable to load promo codes.");
        setPromoPage((current) => ({ ...current, promos: [] }));
        return;
      }

      setPromoPage({
        promos: Array.isArray(data.promos) ? (data.promos as PromoRow[]) : [],
        totalCount: Number(data.totalCount ?? 0),
        page: Number(data.page ?? 1),
        totalPages: Number(data.totalPages ?? 1),
        rowsPerPage: Number(data.rowsPerPage ?? rowsPerPage),
        from: Number(data.from ?? 0),
        to: Number(data.to ?? 0),
        hasPrev: Boolean(data.hasPrev),
        hasNext: Boolean(data.hasNext),
      });
    },
    [pageParam, queryParam, rowsPerPage],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPromos();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPromos]);

  useEffect(() => {
    let isCurrent = true;

    async function loadVehicles() {
      const response = await fetch("/api/admin/vehicles", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!isCurrent) return;
      if (!response.ok) {
        setVehicles([]);
        return;
      }

      const list = Array.isArray(data?.vehicles) ? data.vehicles : [];
      setVehicles(
        list
          .filter(isVehicleRow)
          .map((row: VehicleRow) => ({ id: row.id, make: row.make, model: row.model, year: row.year })),
      );
    }

    void loadVehicles();

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = search.trim();
      if (trimmed === queryParam) return;
      updateParams({
        q: trimmed ? trimmed : null,
        page: null,
      });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [queryParam, search, updateParams]);

  const selectedAllowedSet = useMemo(() => new Set(allowedVehicleIds), [allowedVehicleIds]);
  const selectedExcludedSet = useMemo(() => new Set(excludedVehicleIds), [excludedVehicleIds]);

  function buildPromoHref(updates: Record<string, string | null | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) {
        params.delete(key);
        return;
      }
      params.set(key, value);
    });
    const next = params.toString();
    return next ? `${pathname}?${next}` : pathname;
  }

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
        isActive,
        discountType,
        applyScope,
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
    setIsActive(true);
    setDiscountType("PERCENT");
    setApplyScope("DAYS_TOTAL");
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
    if (pageParam) {
      updateParams({ page: null });
      return;
    }
    await loadPromos({ page: "" });
  }

  async function toggleActive(promo: PromoRow) {
    setError(null);
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
    await loadPromos();
  }

  const emptyStateMessage = queryParam.trim()
    ? "No promo codes match this search."
    : "No promo codes created yet.";

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10">
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
          description="Set activation windows, paid-use limits, and optional vehicle/date constraints."
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
            <label className="flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                className="h-4 w-4"
              />
              Active on creation
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
              Apply To
              <select
                value={applyScope}
                onChange={(event) => setApplyScope(event.target.value as "OVERALL_TOTAL" | "DAYS_TOTAL")}
                className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
              >
                <option value="DAYS_TOTAL">Rental days total</option>
                <option value="OVERALL_TOTAL">Overall subtotal</option>
              </select>
            </label>
            <label className="text-xs text-[var(--ccr-muted)]">
              {promoDiscountInputLabel(discountType)}
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
              {promoMinThresholdLabel(applyScope)}
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
                  className="promo-date-time-input date-icon-edge w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
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
                  className="promo-date-time-input date-icon-edge w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
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

            <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
              <fieldset className="rounded-lg border border-[var(--ccr-border)] p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Allowed Vehicles
                </legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAllowedVehicleIds(vehicles.map((vehicle) => vehicle.id))}
                    className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-text)]"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllowedVehicleIds([])}
                    className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-text)]"
                  >
                    Deselect all
                  </button>
                </div>
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
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setExcludedVehicleIds(vehicles.map((vehicle) => vehicle.id))}
                    className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-text)]"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setExcludedVehicleIds([])}
                    className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-text)]"
                  >
                    Deselect all
                  </button>
                </div>
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
                <p className="mt-3 text-[11px] text-[var(--ccr-muted)]">
                  Excluded vehicles override allowed vehicles when the same vehicle appears in both lists.
                </p>
              </fieldset>
            </div>

            <div className="flex items-center gap-2 md:col-span-2">
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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          updateParams({ q: search.trim() ? search.trim() : null, page: null });
        }}
        className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4"
      >
        {rowsPerPage !== STANDARD_PAGE_SIZE_OPTIONS[0] ? (
          <input type="hidden" name="rows" value={String(rowsPerPage)} />
        ) : null}
        <div className="grid gap-3 md:grid-cols-[2fr_auto]">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Search code or promo ID
            <input
              name="q"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="SUMMER, PR000123, etc."
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <div className="grid grid-cols-2 gap-2 md:flex md:items-end">
            <button
              type="submit"
              className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white"
            >
              Apply
            </button>
            <Link
              href={buildPromoHref({ q: null, page: null })}
              className="inline-flex items-center justify-center rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Reset
            </Link>
          </div>
        </div>
      </form>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {loading ? (
          <div className="px-6 py-10 text-sm text-[var(--ccr-muted)]">Loading promo codes…</div>
        ) : promoPage.promos.length === 0 ? (
          <div className="px-6 py-10 text-sm text-[var(--ccr-muted)]">{emptyStateMessage}</div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Applies To</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Valid Window</th>
                <th className="px-4 py-3">Counted / Remaining</th>
                <th className="px-4 py-3">Constraints</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {promoPage.promos.map((promo) => {
                const constraintBadges = buildConstraintBadges(promo);
                return (
                  <tr key={promo.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[var(--ccr-text)]">{promo.code}</p>
                      <p className="mt-1 font-mono text-[10px] text-[var(--ccr-muted)]">{promo.public_id}</p>
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">
                      {promo.discount_type === "PERCENT"
                        ? `${promo.discount_value}%`
                        : formatJmd(promo.discount_value)}
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-muted)]">{promoApplyScopeLabel(promo.apply_scope)}</td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">{promoStatusLabel(promo.admin_state)}</td>
                    <td className="px-4 py-3 text-[var(--ccr-muted)]">
                      <StackedDateTimeRange
                        startLabel={formatWindowLabel(promo.start_at, "Any time")}
                        endLabel={formatWindowLabel(promo.end_at, "No end")}
                      />
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">
                      <p>{promo.current_redemption_count}</p>
                      <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                        {promo.remaining_redemptions === null ? "Unlimited remaining" : `${promo.remaining_redemptions} remaining`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {constraintBadges.length === 0 ? (
                        <span className="text-xs text-[var(--ccr-muted)]">No extra constraints</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {constraintBadges.map((badge) => (
                            <span
                              key={`${promo.id}-${badge}`}
                              className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-text)]"
                            >
                              {badge}
                            </span>
                          ))}
                        </div>
                      )}
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
        {promoPage.totalCount > 0 ? (
          <div className="flex flex-col gap-3 border-t border-[var(--ccr-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Rows per page
              <select
                value={String(rowsPerPage)}
                onChange={(event) => {
                  const nextRows = Number(event.target.value);
                  updateParams({
                    rows: nextRows === STANDARD_PAGE_SIZE_OPTIONS[0] ? null : String(nextRows),
                    page: null,
                  });
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

            <PaginationSummaryNav
              from={promoPage.from}
              to={promoPage.to}
              totalCount={promoPage.totalCount}
              page={promoPage.page}
              totalPages={promoPage.totalPages}
              hasPrev={promoPage.hasPrev}
              hasNext={promoPage.hasNext}
              prevHref={buildPromoHref({
                page: promoPage.hasPrev ? String(promoPage.page - 1) : String(promoPage.page),
              })}
              nextHref={buildPromoHref({
                page: promoPage.hasNext ? String(promoPage.page + 1) : String(promoPage.page),
              })}
              className="mt-0"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
