"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";

import { PaginationSummaryNav } from "@/components/admin/PaginationSummaryNav";
import { StackedDateTimeRange } from "@/components/shared/StackedDateTimeRange";
import { fmtAdminDateTimeNoSeconds } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type PromoAdminState = "ACTIVE" | "INACTIVE" | "SCHEDULED" | "EXPIRED" | "LIMIT_REACHED";

type PromoDetails = {
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

type PromoSummary = {
  currentCount: number;
  remaining: number | null;
  status: PromoAdminState;
  redeemedEvents: number;
  reversedEvents: number;
  netCounted: number;
  totalDiscountRedeemed: number;
  totalDiscountReversed: number;
};

type PromoActivityRow = {
  id: string;
  booking_id: string;
  booking_public_id: string | null;
  customer_email: string | null;
  discount_amount_cents: number;
  event_type: "REDEEMED" | "REVERSED";
  event_at: string;
  created_at: string;
  is_reconstructed: boolean;
  timestamp_source: string | null;
};

type PromoActivityPage = {
  rows: PromoActivityRow[];
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
};

type PromoResponse = {
  promo: PromoDetails;
  summary: PromoSummary;
  historyCoverage: "COMPLETE_RECONSTRUCTED_HISTORY";
  historyCoverageStartedAt: string | null;
  hasReconstructedHistory: boolean;
  activity: PromoActivityPage;
};

type PromoHistoryInfo = {
  historyCoverage: "COMPLETE_RECONSTRUCTED_HISTORY";
  historyCoverageStartedAt: string | null;
  hasReconstructedHistory: boolean;
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

function promoStatusLabel(status: PromoAdminState) {
  if (status === "ACTIVE") return "Active";
  if (status === "INACTIVE") return "Inactive";
  if (status === "SCHEDULED") return "Scheduled";
  if (status === "LIMIT_REACHED") return "Limit reached";
  return "Expired";
}

function promoMinThresholdLabel(scope: PromoDetails["apply_scope"] | "OVERALL_TOTAL" | "DAYS_TOTAL") {
  return scope === "DAYS_TOTAL" ? "Min rental-days total (JMD)" : "Min overall subtotal (JMD)";
}

function formatWindowLabel(value: string | null, fallback: string) {
  if (!value) return fallback;
  return `${fmtAdminDateTimeNoSeconds(value)} Jamaica time`;
}

function formatActivityType(value: PromoActivityRow["event_type"]) {
  return value === "REVERSED" ? "Reversed" : "Redeemed";
}

function formatHistoryCoverageNote(history: PromoHistoryInfo) {
  if (history.historyCoverageStartedAt) {
    return `Historical ledger coverage begins ${fmtAdminDateTimeNoSeconds(history.historyCoverageStartedAt)} Jamaica time and is reconstructed from booking, payment, and cancellation records.`;
  }
  return "Historical ledger is complete. No promo redemption activity has been recorded for this code yet.";
}

function formatTimestampSource(value: string | null) {
  if (value === "refund_payment") return "Refund payment";
  if (value === "cancel_audit") return "Cancellation audit";
  if (value === "booking_updated") return "Booking update";
  if (value === "payment") return "Payment";
  return "Derived";
}

const EMPTY_ACTIVITY: PromoActivityPage = {
  rows: [],
  page: 1,
  totalPages: 1,
  totalCount: 0,
  pageSize: 25,
  from: 0,
  to: 0,
  hasPrev: false,
  hasNext: false,
};

const DEFAULT_HISTORY_INFO: PromoHistoryInfo = {
  historyCoverage: "COMPLETE_RECONSTRUCTED_HISTORY",
  historyCoverageStartedAt: null,
  hasReconstructedHistory: false,
};

export default function AdminPromoCodeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const promoId = params?.id ?? "";
  const activityPageParam = searchParams.get("activityPage") ?? "";

  const [promo, setPromo] = useState<PromoDetails | null>(null);
  const [summary, setSummary] = useState<PromoSummary | null>(null);
  const [historyInfo, setHistoryInfo] = useState<PromoHistoryInfo>(DEFAULT_HISTORY_INFO);
  const [activity, setActivity] = useState<PromoActivityPage>(EMPTY_ACTIVITY);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [discountType, setDiscountType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [applyScope, setApplyScope] = useState<"OVERALL_TOTAL" | "DAYS_TOTAL">("OVERALL_TOTAL");
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

  function applyPromoState(nextPromo: PromoDetails) {
    setPromo(nextPromo);
    setCode(nextPromo.code);
    setIsActive(nextPromo.is_active);
    setDiscountType(nextPromo.discount_type);
    setApplyScope(nextPromo.apply_scope === "DAYS_TOTAL" ? "DAYS_TOTAL" : "OVERALL_TOTAL");
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

  const loadPromo = useCallback(async (input: { activityPage?: string } = {}) => {
    if (!promoId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    const nextActivityPage = input.activityPage ?? activityPageParam;
    if (nextActivityPage) {
      params.set("activityPage", nextActivityPage);
    }

    const response = await fetch(
      `/api/admin/promo-codes/${promoId}${params.toString() ? `?${params}` : ""}`,
      { cache: "no-store" },
    );
    const data = (await response.json().catch(() => ({}))) as Partial<PromoResponse> & { error?: string };
    setLoading(false);

    if (!response.ok || !data.promo || !data.summary || !data.activity) {
      setHistoryInfo(DEFAULT_HISTORY_INFO);
      setError(data.error ?? "Unable to load promo code.");
      return;
    }

    applyPromoState(data.promo as PromoDetails);
    setSummary(data.summary as PromoSummary);
    setHistoryInfo({
      historyCoverage:
        data.historyCoverage === "COMPLETE_RECONSTRUCTED_HISTORY"
          ? data.historyCoverage
          : DEFAULT_HISTORY_INFO.historyCoverage,
      historyCoverageStartedAt:
        typeof data.historyCoverageStartedAt === "string" && data.historyCoverageStartedAt.trim()
          ? data.historyCoverageStartedAt
          : null,
      hasReconstructedHistory: data.hasReconstructedHistory === true,
    });
    setActivity(data.activity as PromoActivityPage);
  }, [activityPageParam, promoId]);

  useEffect(() => {
    if (!promoId) return;
    const timer = window.setTimeout(() => {
      void loadPromo();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPromo, promoId]);

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

  function buildActivityHref(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (page <= 1) {
      params.delete("activityPage");
    } else {
      params.set("activityPage", String(page));
    }
    const next = params.toString();
    return next ? `${pathname}?${next}` : pathname;
  }

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
      setError(data.error ?? "Unable to save promo code.");
      return;
    }
    setMessage("Promo code updated.");
    await loadPromo();
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10">
      {promo ? (
        <div className="mb-3">
          <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]">
            {promoStatusLabel(promo.admin_state)}
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Promo</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">{promo ? promo.code : "Promo Code"}</h1>
          {promo ? <p className="mt-1 font-mono text-xs text-[var(--ccr-muted)]">{promo.public_id}</p> : null}
        </div>
        <Link
          href="/admin/promo-codes"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Back to promo codes
        </Link>
      </div>

      {loading ? (
        <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm text-[var(--ccr-muted)]">
          Loading promo code…
        </div>
      ) : promo && summary ? (
        <>
          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Current Counted</p>
              <p className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">{summary.currentCount}</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                {summary.remaining === null ? "Unlimited remaining" : `${summary.remaining} remaining`}
              </p>
            </article>
            <article className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Activity Totals</p>
              <p className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">{summary.redeemedEvents}</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">{summary.reversedEvents} reversed events</p>
            </article>
            <article className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Discount Redeemed</p>
              <p className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">{formatJmd(summary.totalDiscountRedeemed)}</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">Net counted {summary.netCounted}</p>
            </article>
            <article className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Discount Reversed</p>
              <p className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">{formatJmd(summary.totalDiscountReversed)}</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">Status {promoStatusLabel(summary.status)}</p>
            </article>
          </section>

          <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-[var(--ccr-text)]">Configuration</h2>
                <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                  The valid window is shown in Jamaica time and the current status comes from live redemption state.
                </p>
              </div>
              <div className="text-sm text-[var(--ccr-muted)]">
                <StackedDateTimeRange
                  startLabel={formatWindowLabel(promo.start_at, "Any time")}
                  endLabel={formatWindowLabel(promo.end_at, "No end")}
                />
              </div>
            </div>

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
                Apply To
                <select
                  value={applyScope}
                  onChange={(event) => setApplyScope(event.target.value as "OVERALL_TOTAL" | "DAYS_TOTAL")}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                >
                  <option value="OVERALL_TOTAL">Overall subtotal</option>
                  <option value="DAYS_TOTAL">Rental days total</option>
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

              <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
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
                  <p className="mt-3 text-[11px] text-[var(--ccr-muted)]">
                    Excluded vehicles override allowed vehicles when the same vehicle appears in both lists.
                  </p>
                </fieldset>
              </div>

              <div className="flex items-center gap-2 md:col-span-2">
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--ccr-text)]">Redemption Activity</h2>
                <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                  Current counted remains authoritative for enforcement. {formatHistoryCoverageNote(historyInfo)}
                </p>
                {historyInfo.hasReconstructedHistory ? (
                  <p className="mt-2 text-xs text-[var(--ccr-muted)]">
                    Rows marked <span className="font-semibold text-[var(--ccr-text)]">Reconstructed</span>{" "}
                    were rebuilt from legacy booking, payment, and cancellation records.
                  </p>
                ) : null}
              </div>
              <div className="text-right text-xs text-[var(--ccr-muted)]">
                <p>
                  Redeemed total{" "}
                  <span className="font-semibold text-[var(--ccr-text)]">
                    {formatJmd(summary.totalDiscountRedeemed)}
                  </span>
                </p>
                <p>
                  Reversed total{" "}
                  <span className="font-semibold text-[var(--ccr-text)]">
                    {formatJmd(summary.totalDiscountReversed)}
                  </span>
                </p>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--ccr-border)]">
              {activity.rows.length === 0 ? (
                <div className="px-4 py-8 text-sm text-[var(--ccr-muted)]">No redemption activity yet.</div>
              ) : (
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                    <tr>
                      <th className="px-3 py-2">Event</th>
                      <th className="px-3 py-2">Booking</th>
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2">Discount</th>
                      <th className="px-3 py-2">Occurred</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.rows.map((row) => (
                      <tr key={row.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                        <td className="px-3 py-2 text-[var(--ccr-text)]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{formatActivityType(row.event_type)}</span>
                            {row.is_reconstructed ? (
                              <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                                Reconstructed
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Link href={`/admin/bookings/${row.booking_id}`} className="font-mono text-xs text-[var(--ccr-text)]">
                            {row.booking_public_id ?? row.booking_id}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-[var(--ccr-text)]">{row.customer_email ?? "Unknown"}</td>
                        <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(row.discount_amount_cents)}</td>
                        <td className="px-3 py-2 text-[var(--ccr-muted)]">
                          <div>{fmtAdminDateTimeNoSeconds(row.event_at)} Jamaica time</div>
                          {row.timestamp_source ? (
                            <div className="text-[11px]">{formatTimestampSource(row.timestamp_source)}</div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {activity.totalCount > 0 ? (
              <PaginationSummaryNav
                from={activity.from}
                to={activity.to}
                totalCount={activity.totalCount}
                page={activity.page}
                totalPages={activity.totalPages}
                hasPrev={activity.hasPrev}
                hasNext={activity.hasNext}
                prevHref={buildActivityHref(activity.hasPrev ? activity.page - 1 : activity.page)}
                nextHref={buildActivityHref(activity.hasNext ? activity.page + 1 : activity.page)}
                className="mt-4"
              />
            ) : null}
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
