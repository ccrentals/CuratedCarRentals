export const DEPRECIATION_METHODS = ["STRAIGHT_LINE"] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export type VehicleFinanceInput = {
  purchaseDate: string | Date | null;
  purchaseCostCents: number | null;
  residualValueCents: number | null;
  usefulLifeMonths: number | null;
  depreciationMethod: string | null;
};

export type DepreciationMetrics = {
  asOfMonth: string;
  monthlyDepreciationCents: number;
  depreciationForMonthCents: number;
  accumulatedDepreciationCents: number;
  bookValueCents: number;
};

export type DepreciationSnapshotRow = {
  vehicleId: string;
  asOfMonth: string;
  bookValueCents: number;
  accumulatedDepreciationCents: number;
  depreciationForMonthCents: number;
};

export type GeneratedDepreciationSnapshots = {
  snapshots: DepreciationSnapshotRow[];
  incompleteReason: string | null;
};

function toMonthStartDate(value: string | Date | null) {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
}

export function monthStartIso(value: string | Date | null) {
  const parsed = toMonthStartDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

function toNonNegativeInt(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 ? rounded : null;
}

function toPositiveInt(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 1 ? rounded : null;
}

function normalizeMethod(value: string | null): DepreciationMethod | null {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "STRAIGHT_LINE") return "STRAIGHT_LINE";
  return null;
}

function monthsBetween(startMonth: Date, endMonth: Date) {
  return (
    (endMonth.getUTCFullYear() - startMonth.getUTCFullYear()) * 12 +
    (endMonth.getUTCMonth() - startMonth.getUTCMonth())
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getFinanceIncompleteReason(input: VehicleFinanceInput): string | null {
  const purchaseMonth = toMonthStartDate(input.purchaseDate);
  if (!purchaseMonth) return "Purchase date is required.";

  const purchaseCostCents = toNonNegativeInt(input.purchaseCostCents);
  if (purchaseCostCents === null) return "Purchase cost is required.";

  const residualValueCents = toNonNegativeInt(input.residualValueCents);
  if (residualValueCents === null) return "Residual value is required.";

  const usefulLifeMonths = toPositiveInt(input.usefulLifeMonths);
  if (usefulLifeMonths === null) return "Useful life (months) is required.";

  const method = normalizeMethod(input.depreciationMethod);
  if (!method) return "Unsupported depreciation method.";

  if (residualValueCents > purchaseCostCents) {
    return "Residual value cannot exceed purchase cost.";
  }

  return null;
}

export function computeStraightLineMonthly(
  purchaseCostCents: number,
  residualValueCents: number,
  usefulLifeMonths: number,
) {
  const purchase = toNonNegativeInt(purchaseCostCents);
  const residual = toNonNegativeInt(residualValueCents);
  const months = toPositiveInt(usefulLifeMonths);
  if (purchase === null || residual === null || months === null) {
    return 0;
  }
  const depreciable = Math.max(0, purchase - residual);
  return Math.floor(depreciable / months);
}

export function computeBookValueAtMonth(
  input: VehicleFinanceInput,
  asOfMonth: string | Date | null,
): DepreciationMetrics | { incompleteReason: string } {
  const incomplete = getFinanceIncompleteReason(input);
  if (incomplete) {
    return { incompleteReason: incomplete };
  }

  const purchaseMonth = toMonthStartDate(input.purchaseDate)!;
  const purchaseCostCents = toNonNegativeInt(input.purchaseCostCents)!;
  const residualValueCents = toNonNegativeInt(input.residualValueCents)!;
  const usefulLifeMonths = toPositiveInt(input.usefulLifeMonths)!;
  const normalizedAsOf = toMonthStartDate(asOfMonth) ?? toMonthStartDate(new Date())!;

  const depreciable = Math.max(0, purchaseCostCents - residualValueCents);
  const baseMonthlyDepreciation = computeStraightLineMonthly(
    purchaseCostCents,
    residualValueCents,
    usefulLifeMonths,
  );

  const monthOffset = monthsBetween(purchaseMonth, normalizedAsOf);
  if (monthOffset < 0) {
    return {
      asOfMonth: normalizedAsOf.toISOString().slice(0, 10),
      monthlyDepreciationCents: baseMonthlyDepreciation,
      depreciationForMonthCents: 0,
      accumulatedDepreciationCents: 0,
      bookValueCents: purchaseCostCents,
    };
  }

  const elapsedMonths = clamp(monthOffset + 1, 0, usefulLifeMonths);
  const previousElapsedMonths = clamp(elapsedMonths - 1, 0, usefulLifeMonths);

  const accumulatedDepreciationCents = Math.floor(
    (depreciable * elapsedMonths) / usefulLifeMonths,
  );
  const previousAccumulatedDepreciationCents = Math.floor(
    (depreciable * previousElapsedMonths) / usefulLifeMonths,
  );
  const depreciationForMonthCents =
    accumulatedDepreciationCents - previousAccumulatedDepreciationCents;

  const rawBookValueCents = purchaseCostCents - accumulatedDepreciationCents;
  const bookValueCents = Math.max(rawBookValueCents, residualValueCents);

  return {
    asOfMonth: normalizedAsOf.toISOString().slice(0, 10),
    monthlyDepreciationCents: baseMonthlyDepreciation,
    depreciationForMonthCents,
    accumulatedDepreciationCents,
    bookValueCents,
  };
}

export function generateSnapshots(
  vehicleId: string,
  startMonth: string | Date,
  endMonth: string | Date,
  input: VehicleFinanceInput,
): GeneratedDepreciationSnapshots {
  const incompleteReason = getFinanceIncompleteReason(input);
  if (incompleteReason) {
    return { snapshots: [], incompleteReason };
  }

  const start = toMonthStartDate(startMonth);
  const end = toMonthStartDate(endMonth);
  if (!start || !end) {
    return { snapshots: [], incompleteReason: "Start month and end month are required." };
  }
  if (start.getTime() > end.getTime()) {
    return { snapshots: [], incompleteReason: "End month must be on/after start month." };
  }

  const snapshots: DepreciationSnapshotRow[] = [];
  for (
    let cursor = new Date(start.getTime());
    cursor.getTime() <= end.getTime();
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  ) {
    const computed = computeBookValueAtMonth(input, cursor);
    if ("incompleteReason" in computed) {
      return { snapshots: [], incompleteReason: computed.incompleteReason };
    }

    snapshots.push({
      vehicleId,
      asOfMonth: computed.asOfMonth,
      bookValueCents: computed.bookValueCents,
      accumulatedDepreciationCents: computed.accumulatedDepreciationCents,
      depreciationForMonthCents: computed.depreciationForMonthCents,
    });
  }

  return { snapshots, incompleteReason: null };
}

