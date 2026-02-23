import { dbQuery } from "@/lib/db";
import {
  computeBookValueAtMonth,
  monthStartIso,
  type VehicleFinanceInput,
} from "@/lib/vehicles/depreciation";

export const DEPRECIATION_REPORT_SORT_COLUMNS = [
  "vehicle",
  "purchaseCost",
  "bookValue",
  "accumulated",
  "monthly",
] as const;

export type DepreciationReportSortBy =
  (typeof DEPRECIATION_REPORT_SORT_COLUMNS)[number];
export type DepreciationReportSortDir = "asc" | "desc";

export type DepreciationReportItem = {
  vehicleId: string;
  make: string;
  model: string;
  year: number;
  vehicleType: string | null;
  vehicleClass: string | null;
  purchaseDate: string | null;
  purchaseCostCents: number | null;
  residualValueCents: number | null;
  usefulLifeMonths: number | null;
  depreciationMethod: string | null;
  notes: string | null;
  asOfMonth: string;
  monthlyDepreciationCents: number | null;
  bookValueCents: number | null;
  accumulatedDepreciationCents: number | null;
  incompleteReason: string | null;
};

type DepreciationReportSourceRow = {
  vehicle_id: string;
  make: string;
  model: string;
  year: number;
  vehicle_type: string | null;
  vehicle_class: string | null;
  purchase_date: string | null;
  purchase_cost_cents: number | null;
  residual_value_cents: number | null;
  useful_life_months: number | null;
  depreciation_method: string | null;
  notes: string | null;
};

export type DepreciationReportOptions = {
  asOfMonth?: string | Date | null;
  vehicleClass?: string | null;
  vehicleType?: string | null;
  sortBy?: DepreciationReportSortBy;
  sortDir?: DepreciationReportSortDir;
};

export type DepreciationFilterOptions = {
  vehicleClasses: string[];
  vehicleTypes: string[];
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeOptionalFilter(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, 80) : null;
}

function normalizeAsOfMonth(value: string | Date | null | undefined) {
  return monthStartIso(value ?? new Date()) ?? monthStartIso(new Date())!;
}

function compareNullableNumber(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function sortReportItems(
  rows: DepreciationReportItem[],
  sortBy: DepreciationReportSortBy,
  sortDir: DepreciationReportSortDir,
) {
  const direction = sortDir === "desc" ? -1 : 1;

  return [...rows].sort((left, right) => {
    let base = 0;

    if (sortBy === "purchaseCost") {
      base = compareNullableNumber(left.purchaseCostCents, right.purchaseCostCents);
    } else if (sortBy === "bookValue") {
      base = compareNullableNumber(left.bookValueCents, right.bookValueCents);
    } else if (sortBy === "accumulated") {
      base = compareNullableNumber(
        left.accumulatedDepreciationCents,
        right.accumulatedDepreciationCents,
      );
    } else if (sortBy === "monthly") {
      base = compareNullableNumber(
        left.monthlyDepreciationCents,
        right.monthlyDepreciationCents,
      );
    } else {
      base =
        left.year - right.year ||
        compareText(left.make, right.make) ||
        compareText(left.model, right.model);
    }

    if (base !== 0) return base * direction;
    return left.vehicleId.localeCompare(right.vehicleId) * direction;
  });
}

function toFinanceInput(row: DepreciationReportSourceRow): VehicleFinanceInput {
  return {
    purchaseDate: row.purchase_date,
    purchaseCostCents: row.purchase_cost_cents,
    residualValueCents: row.residual_value_cents,
    usefulLifeMonths: row.useful_life_months,
    depreciationMethod: row.depreciation_method,
  };
}

export async function listDepreciationFilterOptions(): Promise<DepreciationFilterOptions> {
  const result = await dbQuery<{ vehicle_class: string | null; vehicle_type: string | null }>(
    "select distinct vp.vehicle_class, vp.vehicle_type from vehicle_finance vf left join vehicle_profiles vp on vp.vehicle_id = vf.vehicle_id order by vp.vehicle_class asc nulls last, vp.vehicle_type asc nulls last",
  );

  const vehicleClasses = new Set<string>();
  const vehicleTypes = new Set<string>();

  for (const row of result.rows) {
    const vehicleClass = normalizeText(row.vehicle_class);
    const vehicleType = normalizeText(row.vehicle_type);
    if (vehicleClass) vehicleClasses.add(vehicleClass);
    if (vehicleType) vehicleTypes.add(vehicleType);
  }

  return {
    vehicleClasses: Array.from(vehicleClasses),
    vehicleTypes: Array.from(vehicleTypes),
  };
}

export async function listDepreciationReport(options: DepreciationReportOptions = {}): Promise<{
  asOfMonth: string;
  items: DepreciationReportItem[];
}> {
  const asOfMonth = normalizeAsOfMonth(options.asOfMonth);
  const vehicleClass = normalizeOptionalFilter(options.vehicleClass);
  const vehicleType = normalizeOptionalFilter(options.vehicleType);
  const sortBy = DEPRECIATION_REPORT_SORT_COLUMNS.includes(
    options.sortBy as DepreciationReportSortBy,
  )
    ? (options.sortBy as DepreciationReportSortBy)
    : "vehicle";
  const sortDir = options.sortDir === "desc" ? "desc" : "asc";

  const values: string[] = [];
  const whereParts: string[] = [];

  if (vehicleClass) {
    values.push(vehicleClass);
    whereParts.push(`lower(vp.vehicle_class) = lower($${values.length})`);
  }
  if (vehicleType) {
    values.push(vehicleType);
    whereParts.push(`lower(vp.vehicle_type) = lower($${values.length})`);
  }

  const whereSql = whereParts.length > 0 ? `where ${whereParts.join(" and ")}` : "";

  const source = await dbQuery<DepreciationReportSourceRow>(
    `select
      v.id as vehicle_id,
      v.make,
      v.model,
      v.year,
      vp.vehicle_type,
      vp.vehicle_class,
      vf.purchase_date,
      vf.purchase_cost_cents,
      vf.residual_value_cents,
      vf.useful_life_months,
      vf.depreciation_method,
      vf.notes
    from vehicle_finance vf
    join vehicles v on v.id = vf.vehicle_id
    left join vehicle_profiles vp on vp.vehicle_id = v.id
    ${whereSql}`,
    values,
  );

  const items: DepreciationReportItem[] = source.rows.map(
    (row: DepreciationReportSourceRow) => {
      const computed = computeBookValueAtMonth(toFinanceInput(row), asOfMonth);

      if ("incompleteReason" in computed) {
        return {
        vehicleId: row.vehicle_id,
        make: row.make,
        model: row.model,
        year: row.year,
        vehicleType: row.vehicle_type,
        vehicleClass: row.vehicle_class,
        purchaseDate: row.purchase_date,
        purchaseCostCents: row.purchase_cost_cents,
        residualValueCents: row.residual_value_cents,
        usefulLifeMonths: row.useful_life_months,
        depreciationMethod: row.depreciation_method,
        notes: row.notes,
        asOfMonth,
        monthlyDepreciationCents: null,
        bookValueCents: null,
        accumulatedDepreciationCents: null,
        incompleteReason: computed.incompleteReason,
      };
    }

      return {
        vehicleId: row.vehicle_id,
        make: row.make,
      model: row.model,
      year: row.year,
      vehicleType: row.vehicle_type,
      vehicleClass: row.vehicle_class,
      purchaseDate: row.purchase_date,
      purchaseCostCents: row.purchase_cost_cents,
      residualValueCents: row.residual_value_cents,
      usefulLifeMonths: row.useful_life_months,
      depreciationMethod: row.depreciation_method,
      notes: row.notes,
      asOfMonth,
      monthlyDepreciationCents: computed.monthlyDepreciationCents,
      bookValueCents: computed.bookValueCents,
        accumulatedDepreciationCents: computed.accumulatedDepreciationCents,
        incompleteReason: null,
      };
    },
  );

  return {
    asOfMonth,
    items: sortReportItems(items, sortBy, sortDir),
  };
}
