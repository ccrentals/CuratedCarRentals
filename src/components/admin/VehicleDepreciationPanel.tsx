"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { PaginationSummary } from "@/components/admin/PaginationSummaryNav";
import { SortableTh } from "@/components/admin/SortableTh";
import type { SortState } from "@/components/admin/tableSort";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { formatJmdDecimalFromCents, formatJmdFromCents } from "@/lib/money";

type FinanceResponse = {
  ok: boolean;
  error?: string;
  defaults?: {
    depreciationMethod: "STRAIGHT_LINE";
    usefulLifeMonths: number;
    residualPercent: number;
  };
  finance?: {
    purchaseDate: string | null;
    purchaseCostCents: number | null;
    residualValueCents: number | null;
    odometerAtPurchase: number | null;
    usefulLifeMonths: number | null;
    depreciationMethod: string | null;
    isActive: boolean;
    notes: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  asOfMonth?: string;
  metrics?: {
    monthlyDepreciationCents: number;
    depreciationForMonthCents: number;
    depreciatedAmountCents: number;
    accumulatedDepreciationCents: number;
    bookValueCents: number;
    monthsElapsed: number;
    monthsRemaining: number;
  } | null;
  incompleteReason?: string | null;
  snapshots?: Array<{
    asOfMonth: string;
    bookValueCents: number;
    accumulatedDepreciationCents: number;
    depreciationForMonthCents: number;
  }>;
};

type VehicleDepreciationPanelProps = {
  vehicleId: string;
};

const SNAPSHOT_PAGE_SIZE = 10;

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function monthFromDate(value: string | null) {
  if (!value) return currentMonthValue();
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return currentMonthValue();
  return parsed.toISOString().slice(0, 7);
}

function parseAmountToCents(input: string) {
  if (!input.trim()) return null;
  const parsed = Number(input.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function toAmountInput(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "";
  return formatJmdDecimalFromCents(value);
}

function formatSnapshotMonth(value: string) {
  const raw = String(value || "").trim();
  const monthMatch = raw.match(/^(\d{4}-\d{2})/);
  if (monthMatch) return monthMatch[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw || "—";
  return parsed.toISOString().slice(0, 7);
}

function snapshotMonthTimestamp(value: string) {
  const normalized = formatSnapshotMonth(value);
  return new Date(`${normalized}-01T00:00:00.000Z`).getTime();
}

export function VehicleDepreciationPanel({ vehicleId }: VehicleDepreciationPanelProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [residualValue, setResidualValue] = useState("");
  const [odometerAtPurchase, setOdometerAtPurchase] = useState("");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("");
  const [depreciationMethod, setDepreciationMethod] = useState("STRAIGHT_LINE");
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState("");

  const [asOfMonth, setAsOfMonth] = useState(monthFromDate(null));
  const [monthlyDepreciationCents, setMonthlyDepreciationCents] = useState<number | null>(null);
  const [bookValueCents, setBookValueCents] = useState<number | null>(null);
  const [accumulatedCents, setAccumulatedCents] = useState<number | null>(null);
  const [monthsElapsed, setMonthsElapsed] = useState<number | null>(null);
  const [monthsRemaining, setMonthsRemaining] = useState<number | null>(null);
  const [incompleteReason, setIncompleteReason] = useState<string | null>(null);

  const [defaultResidualPercent, setDefaultResidualPercent] = useState(20);
  const [generateStartMonth, setGenerateStartMonth] = useState(currentMonthValue());
  const [generateEndMonth, setGenerateEndMonth] = useState(currentMonthValue());
  const [snapshotHistory, setSnapshotHistory] = useState<
    Array<{
      asOfMonth: string;
      bookValueCents: number;
      accumulatedDepreciationCents: number;
      depreciationForMonthCents: number;
    }>
  >([]);
  const [snapshotSort, setSnapshotSort] = useState<SortState>({
    sortBy: "month",
    sortDir: "desc",
  });
  const [snapshotPage, setSnapshotPage] = useState(1);

  const applyPayload = useCallback((payload: FinanceResponse) => {
    const defaults = payload.defaults;
    const finance = payload.finance;

    if (defaults) {
      setDepreciationMethod((current) => current || defaults.depreciationMethod);
      setUsefulLifeMonths((current) => current || String(defaults.usefulLifeMonths));
      setDefaultResidualPercent(defaults.residualPercent);
    }

    if (finance) {
      setPurchaseDate(finance.purchaseDate ?? "");
      setPurchaseCost(toAmountInput(finance.purchaseCostCents));
      setResidualValue(toAmountInput(finance.residualValueCents));
      setOdometerAtPurchase(
        finance.odometerAtPurchase === null || finance.odometerAtPurchase === undefined
          ? ""
          : String(finance.odometerAtPurchase),
      );
      setUsefulLifeMonths(
        finance.usefulLifeMonths === null || finance.usefulLifeMonths === undefined
          ? defaults
            ? String(defaults.usefulLifeMonths)
            : ""
          : String(finance.usefulLifeMonths),
      );
      setDepreciationMethod(finance.depreciationMethod ?? defaults?.depreciationMethod ?? "STRAIGHT_LINE");
      setIsActive(finance.isActive !== false);
      setNotes(finance.notes ?? "");

      const startMonth = monthFromDate(finance.purchaseDate);
      setGenerateStartMonth(startMonth);
      setGenerateEndMonth(currentMonthValue());

      if (finance.purchaseCostCents !== null && finance.residualValueCents === null && defaults) {
        const fallbackResidual = Math.round(
          finance.purchaseCostCents * (defaults.residualPercent / 100),
        );
        setResidualValue(toAmountInput(fallbackResidual));
      }
    }

    setAsOfMonth(monthFromDate(payload.asOfMonth ?? null));
    setMonthlyDepreciationCents(payload.metrics?.monthlyDepreciationCents ?? null);
    setBookValueCents(payload.metrics?.bookValueCents ?? null);
    setAccumulatedCents(
      payload.metrics?.depreciatedAmountCents ?? payload.metrics?.accumulatedDepreciationCents ?? null,
    );
    setMonthsElapsed(
      typeof payload.metrics?.monthsElapsed === "number" ? payload.metrics.monthsElapsed : null,
    );
    setMonthsRemaining(
      typeof payload.metrics?.monthsRemaining === "number" ? payload.metrics.monthsRemaining : null,
    );
    setIncompleteReason(payload.incompleteReason ?? null);
    setSnapshotHistory(Array.isArray(payload.snapshots) ? payload.snapshots : []);
  }, []);

  const loadFinance = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/finance`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as FinanceResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to load depreciation data.");
      }
      applyPayload(payload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load depreciation data.",
      );
    } finally {
      setLoading(false);
    }
  }, [applyPayload, vehicleId]);

  useEffect(() => {
    void loadFinance();
  }, [loadFinance]);

  async function saveFinance() {
    if (saving) return;

    const purchaseCostCents = parseAmountToCents(purchaseCost);
    const residualValueCents = parseAmountToCents(residualValue);
    const odometerAtPurchaseValue = odometerAtPurchase.trim() ? Number(odometerAtPurchase) : null;
    const usefulLifeValue = usefulLifeMonths.trim() ? Number(usefulLifeMonths) : null;

    if (purchaseCost.trim() && purchaseCostCents === null) {
      setError("Purchase cost must be a valid non-negative amount.");
      return;
    }
    if (residualValue.trim() && residualValueCents === null) {
      setError("Residual value must be a valid non-negative amount.");
      return;
    }
    if (
      usefulLifeMonths.trim() &&
      (usefulLifeValue === null ||
        !Number.isFinite(usefulLifeValue) ||
        Math.round(usefulLifeValue) < 1)
    ) {
      setError("Useful life months must be at least 1.");
      return;
    }
    if (
      odometerAtPurchase.trim() &&
      (odometerAtPurchaseValue === null ||
        !Number.isFinite(odometerAtPurchaseValue) ||
        Math.round(odometerAtPurchaseValue) < 0)
    ) {
      setError("Odometer at purchase must be a valid non-negative value.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/finance`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          purchaseDate: purchaseDate || null,
          purchaseCostCents,
          residualValueCents,
          odometerAtPurchase:
            odometerAtPurchaseValue === null ? null : Math.round(odometerAtPurchaseValue),
          usefulLifeMonths: usefulLifeValue === null ? null : Math.round(usefulLifeValue),
          depreciationMethod,
          isActive,
          notes: notes || null,
          csrfToken,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as FinanceResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to save finance settings.");
      }

      applyPayload(payload);
      setMessage("Depreciation finance details saved.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to save finance settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function generateDepreciationSnapshots() {
    if (generating) return;

    if (!generateStartMonth || !generateEndMonth) {
      setError("Start and end month are required.");
      return;
    }

    setGenerating(true);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(
        `/api/admin/vehicles/${vehicleId}/depreciation/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken ?? "",
          },
          body: JSON.stringify({
            startMonth: generateStartMonth,
            endMonth: generateEndMonth,
            csrfToken,
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        generatedCount?: number;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to generate depreciation snapshots.");
      }

      setMessage(`Generated ${payload.generatedCount ?? 0} depreciation snapshot(s).`);
      await loadFinance();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to generate depreciation snapshots.",
      );
    } finally {
      setGenerating(false);
    }
  }

  const isIncomplete = useMemo(() => Boolean(incompleteReason), [incompleteReason]);
  const sortedSnapshots = useMemo(() => {
    const direction = snapshotSort.sortDir === "asc" ? 1 : -1;
    return [...snapshotHistory].sort((left, right) => {
      switch (snapshotSort.sortBy) {
        case "bookValue":
          return (left.bookValueCents - right.bookValueCents) * direction;
        case "accumulated":
          return (
            (left.accumulatedDepreciationCents - right.accumulatedDepreciationCents) * direction
          );
        case "monthlyDepreciation":
          return (left.depreciationForMonthCents - right.depreciationForMonthCents) * direction;
        case "month":
        default:
          return (snapshotMonthTimestamp(left.asOfMonth) - snapshotMonthTimestamp(right.asOfMonth)) * direction;
      }
    });
  }, [snapshotHistory, snapshotSort]);

  const snapshotTotalPages = Math.max(1, Math.ceil(sortedSnapshots.length / SNAPSHOT_PAGE_SIZE));

  useEffect(() => {
    setSnapshotPage((current) => Math.min(current, snapshotTotalPages));
  }, [snapshotTotalPages]);

  const visibleSnapshots = useMemo(() => {
    const startIndex = (snapshotPage - 1) * SNAPSHOT_PAGE_SIZE;
    return sortedSnapshots.slice(startIndex, startIndex + SNAPSHOT_PAGE_SIZE);
  }, [snapshotPage, sortedSnapshots]);

  const snapshotFrom = sortedSnapshots.length === 0 ? 0 : (snapshotPage - 1) * SNAPSHOT_PAGE_SIZE + 1;
  const snapshotTo = sortedSnapshots.length === 0 ? 0 : snapshotFrom + visibleSnapshots.length - 1;
  const snapshotHasPrev = snapshotPage > 1;
  const snapshotHasNext = snapshotPage < snapshotTotalPages;

  return (
    <section
      data-testid="vehicle-depreciation-panel"
      className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Depreciation</h2>
          <p className="text-xs text-[var(--ccr-muted)]">
            Manage vehicle finance inputs and generate month-by-month book value snapshots.
          </p>
        </div>
      </div>

      {loading ? <p className="mt-3 text-sm text-[var(--ccr-muted)]">Loading depreciation data...</p> : null}
      {error ? <p className="mt-3 text-xs font-semibold text-red-300">{error}</p> : null}
      {message ? <p className="mt-3 text-xs font-semibold text-emerald-200">{message}</p> : null}

      <div className="mt-4 grid gap-6 xl:grid-cols-2">
        <div
          data-testid="depreciation-form"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4"
        >
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-text)]">
            Finance Inputs
          </h3>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Purchase Date
              <input
                type="date"
                value={purchaseDate}
                onChange={(event) => setPurchaseDate(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Useful Life (Months)
              <input
                type="number"
                min={1}
                value={usefulLifeMonths}
                onChange={(event) => setUsefulLifeMonths(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Purchase Cost (JMD)
              <input
                type="number"
                min={0}
                step="0.01"
                value={purchaseCost}
                onChange={(event) => setPurchaseCost(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                placeholder="2500000.00"
              />
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Residual Value (JMD)
              <input
                type="number"
                min={0}
                step="0.01"
                value={residualValue}
                onChange={(event) => setResidualValue(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                placeholder={`Default ${defaultResidualPercent}%`}
              />
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Odometer At Purchase (km)
              <input
                type="number"
                min={0}
                value={odometerAtPurchase}
                onChange={(event) => setOdometerAtPurchase(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                placeholder="42000"
              />
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] md:col-span-2">
              Method
              <select
                value={depreciationMethod}
                onChange={(event) => setDepreciationMethod(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              >
                <option value="STRAIGHT_LINE">Straight-line</option>
              </select>
            </label>

            <label className="flex min-h-11 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] md:col-span-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
              />
              Depreciation profile active
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] md:col-span-2">
              Notes
              <textarea
                data-testid="depreciation-notes"
                value={notes}
                rows={3}
                onChange={(event) => setNotes(event.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={() => void saveFinance()}
              disabled={saving}
              data-testid="depreciation-save"
              className="min-h-11 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save finance"}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-text)]">
                Computed as of {asOfMonth}
              </h3>
            </div>

            {isIncomplete ? (
              <p className="mt-3 text-xs font-semibold text-amber-100">
                Incomplete finance info: {incompleteReason}
              </p>
            ) : null}

            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
                <dt className="text-[11px] uppercase tracking-wide text-[var(--ccr-muted)]">
                  Monthly Depreciation
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ccr-text)]">
                  {monthlyDepreciationCents === null
                    ? "—"
                    : formatJmdFromCents(monthlyDepreciationCents)}
                </dd>
              </div>

              <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
                <dt className="text-[11px] uppercase tracking-wide text-[var(--ccr-muted)]">
                  Current Book Value
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ccr-text)]">
                  {bookValueCents === null ? "—" : formatJmdFromCents(bookValueCents)}
                </dd>
              </div>

              <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
                <dt className="text-[11px] uppercase tracking-wide text-[var(--ccr-muted)]">
                  Depreciated Amount
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ccr-text)]">
                  {accumulatedCents === null ? "—" : formatJmdFromCents(accumulatedCents)}
                </dd>
              </div>

              <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
                <dt className="text-[11px] uppercase tracking-wide text-[var(--ccr-muted)]">
                  Months Elapsed / Remaining
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ccr-text)]">
                  {monthsElapsed === null || monthsRemaining === null
                    ? "—"
                    : `${monthsElapsed} / ${monthsRemaining}`}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-text)]">
              Snapshot Generation
            </h3>
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">
              Generate or refresh month-level depreciation snapshots for reporting.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Start Month
                <input
                  type="month"
                  value={generateStartMonth}
                  onChange={(event) => setGenerateStartMonth(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                End Month
                <input
                  type="month"
                  value={generateEndMonth}
                  onChange={(event) => setGenerateEndMonth(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={() => void generateDepreciationSnapshots()}
                disabled={generating}
                data-testid="depreciation-generate-snapshot"
                className="min-h-11 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
              >
                {generating ? "Generating..." : "Generate snapshots"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-text)]">
          Snapshot History
        </h3>
        <p className="mt-1 text-xs text-[var(--ccr-muted)]">
          Month-by-month depreciation snapshots saved for this vehicle.
        </p>

        {snapshotHistory.length < 1 ? (
          <p className="mt-3 text-xs text-[var(--ccr-muted)]">
            No snapshots saved yet. Generate snapshots to populate this history.
          </p>
        ) : (
          <div className="mt-3">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                  <tr>
                    <SortableTh
                      label="Month"
                      columnKey="month"
                      sort={snapshotSort}
                      onChange={(next) => {
                        setSnapshotSort(next);
                        setSnapshotPage(1);
                      }}
                      className="px-3 py-2"
                      defaultDirection="desc"
                    />
                    <SortableTh
                      label="Book Value"
                      columnKey="bookValue"
                      sort={snapshotSort}
                      onChange={(next) => {
                        setSnapshotSort(next);
                        setSnapshotPage(1);
                      }}
                      className="px-3 py-2"
                      defaultDirection="desc"
                    />
                    <SortableTh
                      label="Accumulated"
                      columnKey="accumulated"
                      sort={snapshotSort}
                      onChange={(next) => {
                        setSnapshotSort(next);
                        setSnapshotPage(1);
                      }}
                      className="px-3 py-2"
                      defaultDirection="desc"
                    />
                    <SortableTh
                      label="Monthly Depreciation"
                      columnKey="monthlyDepreciation"
                      sort={snapshotSort}
                      onChange={(next) => {
                        setSnapshotSort(next);
                        setSnapshotPage(1);
                      }}
                      className="px-3 py-2"
                      defaultDirection="desc"
                    />
                  </tr>
                </thead>
                <tbody>
                  {visibleSnapshots.map((snapshot) => (
                    <tr
                      key={snapshot.asOfMonth}
                      className="border-b border-[var(--ccr-border)] last:border-b-0"
                      data-testid="vehicle-depreciation-snapshot-row"
                      data-snapshot-month={formatSnapshotMonth(snapshot.asOfMonth)}
                    >
                      <td className="px-3 py-2 text-[var(--ccr-text)]">
                        {formatSnapshotMonth(snapshot.asOfMonth)}
                      </td>
                      <td className="px-3 py-2 text-[var(--ccr-text)]">
                        {formatJmdFromCents(snapshot.bookValueCents)}
                      </td>
                      <td className="px-3 py-2 text-[var(--ccr-text)]">
                        {formatJmdFromCents(snapshot.accumulatedDepreciationCents)}
                      </td>
                      <td className="px-3 py-2 text-[var(--ccr-text)]">
                        {formatJmdFromCents(snapshot.depreciationForMonthCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[var(--ccr-border)] pt-3">
              <PaginationSummary
                from={snapshotFrom}
                to={snapshotTo}
                totalCount={sortedSnapshots.length}
                page={snapshotPage}
                totalPages={snapshotTotalPages}
                rightContent={
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSnapshotPage((current) => Math.max(1, current - 1))}
                      disabled={!snapshotHasPrev}
                      className={`rounded-lg border px-2 py-1 font-semibold ${
                        snapshotHasPrev
                          ? "border-[var(--ccr-border)] text-[var(--ccr-text)]"
                          : "cursor-not-allowed border-[var(--ccr-border)]/40 text-[var(--ccr-muted)]/60"
                      }`}
                    >
                      Prev
                    </button>
                    <span className="font-semibold text-[var(--ccr-text)]">
                      Page {snapshotPage} of {snapshotTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSnapshotPage((current) => Math.min(snapshotTotalPages, current + 1))
                      }
                      disabled={!snapshotHasNext}
                      className={`rounded-lg border px-2 py-1 font-semibold ${
                        snapshotHasNext
                          ? "border-[var(--ccr-border)] text-[var(--ccr-text)]"
                          : "cursor-not-allowed border-[var(--ccr-border)]/40 text-[var(--ccr-muted)]/60"
                      }`}
                    >
                      Next
                    </button>
                  </div>
                }
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
