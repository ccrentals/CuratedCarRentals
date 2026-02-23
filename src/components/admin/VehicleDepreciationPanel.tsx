"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
    usefulLifeMonths: number | null;
    depreciationMethod: string | null;
    notes: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  asOfMonth?: string;
  metrics?: {
    monthlyDepreciationCents: number;
    depreciationForMonthCents: number;
    accumulatedDepreciationCents: number;
    bookValueCents: number;
  } | null;
  incompleteReason?: string | null;
};

type VehicleDepreciationPanelProps = {
  vehicleId: string;
};

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

export function VehicleDepreciationPanel({ vehicleId }: VehicleDepreciationPanelProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [residualValue, setResidualValue] = useState("");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("");
  const [depreciationMethod, setDepreciationMethod] = useState("STRAIGHT_LINE");
  const [notes, setNotes] = useState("");

  const [asOfMonth, setAsOfMonth] = useState(monthFromDate(null));
  const [monthlyDepreciationCents, setMonthlyDepreciationCents] = useState<number | null>(null);
  const [bookValueCents, setBookValueCents] = useState<number | null>(null);
  const [accumulatedCents, setAccumulatedCents] = useState<number | null>(null);
  const [incompleteReason, setIncompleteReason] = useState<string | null>(null);

  const [defaultResidualPercent, setDefaultResidualPercent] = useState(20);
  const [generateStartMonth, setGenerateStartMonth] = useState(currentMonthValue());
  const [generateEndMonth, setGenerateEndMonth] = useState(currentMonthValue());

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
      setUsefulLifeMonths(
        finance.usefulLifeMonths === null || finance.usefulLifeMonths === undefined
          ? defaults
            ? String(defaults.usefulLifeMonths)
            : ""
          : String(finance.usefulLifeMonths),
      );
      setDepreciationMethod(finance.depreciationMethod ?? defaults?.depreciationMethod ?? "STRAIGHT_LINE");
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
    setAccumulatedCents(payload.metrics?.accumulatedDepreciationCents ?? null);
    setIncompleteReason(payload.incompleteReason ?? null);
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
          usefulLifeMonths: usefulLifeValue === null ? null : Math.round(usefulLifeValue),
          depreciationMethod,
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
        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
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

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] md:col-span-2">
              Notes
              <textarea
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

            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                  Accumulated Depreciation
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ccr-text)]">
                  {accumulatedCents === null ? "—" : formatJmdFromCents(accumulatedCents)}
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
                className="min-h-11 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
              >
                {generating ? "Generating..." : "Generate snapshots"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
