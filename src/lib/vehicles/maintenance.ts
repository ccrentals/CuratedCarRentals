import { dbQuery } from "@/lib/db";
import { loadAdminSettings } from "@/lib/adminSettings";

export const MAINTENANCE_RECORD_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export const MAINTENANCE_RECORD_CATEGORIES = [
  "SERVICE",
  "REPAIR",
  "INSPECTION",
  "REGISTRATION",
  "INSURANCE",
  "TIRE",
  "BRAKE",
  "BATTERY",
  "OTHER",
] as const;

export type MaintenanceRecordStatus = (typeof MAINTENANCE_RECORD_STATUSES)[number];
export type MaintenanceRecordCategory = (typeof MAINTENANCE_RECORD_CATEGORIES)[number];

export type MaintenanceDueState =
  | "OVERDUE"
  | "DUE_SOON"
  | "UPCOMING"
  | "COMPLETED"
  | "CANCELLED";

export type MaintenanceDueConfig = {
  dueSoonDays: number;
  dueSoonKm: number;
};

export type MaintenanceRecordLike = {
  status?: unknown;
  scheduledDate?: unknown;
  scheduled_date?: unknown;
  serviceDate?: unknown;
  service_date?: unknown;
  nextDueDate?: unknown;
  next_due_date?: unknown;
  nextDueOdometerKm?: unknown;
  next_due_odometer_km?: unknown;
};

export type MaintenanceMoneyInput = {
  laborCostCents?: unknown;
  labor_cost_cents?: unknown;
  partsCostCents?: unknown;
  parts_cost_cents?: unknown;
  taxCostCents?: unknown;
  tax_cost_cents?: unknown;
};

export type VehicleMaintenanceSummary = {
  totalMaintenanceCostCents: number;
  lastServiceDate: string | null;
  nextDueDate: string | null;
  overdueCount: number;
  openScheduledCount: number;
};

export type UpcomingMaintenanceItem = {
  id: string;
  vehicleId: string;
  vehicleLabel: string;
  status: MaintenanceRecordStatus;
  category: MaintenanceRecordCategory;
  title: string;
  scheduledDate: string | null;
  serviceDate: string | null;
  nextDueDate: string | null;
  dueState: MaintenanceDueState;
  totalCostCents: number;
  priority: string;
  currentOdometerKm: number | null;
};

export type ListUpcomingMaintenanceOptions = {
  vehicleId?: string | null;
  status?: MaintenanceRecordStatus[];
  category?: MaintenanceRecordCategory[];
  dueState?: MaintenanceDueState[];
  dateFrom?: string | null;
  dateTo?: string | null;
  onlyActive?: boolean;
  now?: Date;
  dueSoonDays?: number;
  dueSoonKm?: number;
  limit?: number;
};

const RECORD_STATUS_SET = new Set(MAINTENANCE_RECORD_STATUSES);
const RECORD_CATEGORY_SET = new Set(MAINTENANCE_RECORD_CATEGORIES);

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function asDateOnly(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : raw;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseDateOnly(value: unknown): Date | null {
  const normalized = asDateOnly(value);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : 0;
}

function asOptionalNonNegativeInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 ? rounded : null;
}

function normalizeStatus(value: unknown): MaintenanceRecordStatus {
  const normalized = normalizeText(value).toUpperCase();
  if (RECORD_STATUS_SET.has(normalized as MaintenanceRecordStatus)) {
    return normalized as MaintenanceRecordStatus;
  }
  return "SCHEDULED";
}

function normalizeCategory(value: unknown): MaintenanceRecordCategory {
  const normalized = normalizeText(value).toUpperCase();
  if (RECORD_CATEGORY_SET.has(normalized as MaintenanceRecordCategory)) {
    return normalized as MaintenanceRecordCategory;
  }
  return "OTHER";
}

function dateOnlyNow(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function resolveDueDate(record: MaintenanceRecordLike) {
  return (
    asDateOnly(record.nextDueDate ?? record.next_due_date) ??
    asDateOnly(record.scheduledDate ?? record.scheduled_date) ??
    null
  );
}

export function normalizeMaintenanceDueConfig(value: {
  dueSoonDays?: unknown;
  dueSoonKm?: unknown;
}): MaintenanceDueConfig {
  const parsedDays = Number(value.dueSoonDays);
  const parsedKm = Number(value.dueSoonKm);

  return {
    dueSoonDays: Number.isFinite(parsedDays)
      ? Math.min(180, Math.max(1, Math.floor(parsedDays)))
      : 14,
    dueSoonKm: Number.isFinite(parsedKm) ? Math.min(25_000, Math.max(0, Math.floor(parsedKm))) : 500,
  };
}

export function computeMaintenanceRecordTotal(input: MaintenanceMoneyInput) {
  const labor = asNonNegativeInt(input.laborCostCents ?? input.labor_cost_cents);
  const parts = asNonNegativeInt(input.partsCostCents ?? input.parts_cost_cents);
  const tax = asNonNegativeInt(input.taxCostCents ?? input.tax_cost_cents);
  return labor + parts + tax;
}

/**
 * Unified due-state logic for maintenance records.
 *
 * Rules:
 * - `CANCELLED` and `COMPLETED` are terminal and always win.
 * - Date due uses `next_due_date`, falling back to `scheduled_date`.
 * - Odometer due uses `next_due_odometer_km` when current odometer is known.
 * - If both date and odometer are present, a breach on either marks `OVERDUE`.
 * - `DUE_SOON` applies when within configured day/km thresholds and not overdue.
 */
export function getMaintenanceDueState(
  record: MaintenanceRecordLike,
  nowDate = new Date(),
  currentOdometer: number | null = null,
  config: Partial<MaintenanceDueConfig> = {},
): MaintenanceDueState {
  const status = normalizeStatus(record.status);
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "COMPLETED") return "COMPLETED";

  const dueConfig = normalizeMaintenanceDueConfig(config);
  const today = dateOnlyNow(nowDate);
  const soonCutoff = addDays(today, dueConfig.dueSoonDays);

  const dueDate = parseDateOnly(resolveDueDate(record));
  const dueOdometer = asOptionalNonNegativeInt(
    record.nextDueOdometerKm ?? record.next_due_odometer_km,
  );

  const isDateOverdue = Boolean(dueDate && dueDate.getTime() < today.getTime());
  const isOdometerOverdue =
    dueOdometer !== null && currentOdometer !== null && currentOdometer >= dueOdometer;

  if (isDateOverdue || isOdometerOverdue) {
    return "OVERDUE";
  }

  const isDateDueSoon = Boolean(
    dueDate && dueDate.getTime() >= today.getTime() && dueDate.getTime() <= soonCutoff.getTime(),
  );

  const isOdometerDueSoon =
    dueOdometer !== null &&
    currentOdometer !== null &&
    currentOdometer < dueOdometer &&
    dueOdometer - currentOdometer <= dueConfig.dueSoonKm;

  if (isDateDueSoon || isOdometerDueSoon) {
    return "DUE_SOON";
  }

  return "UPCOMING";
}

export type MaintenanceSummaryRow = {
  status: string;
  service_date: string | null;
  scheduled_date: string | null;
  next_due_date: string | null;
  next_due_odometer_km: number | null;
  labor_cost_cents: number | null;
  parts_cost_cents: number | null;
  tax_cost_cents: number | null;
  total_cost_cents: number | null;
  current_odometer_km: number | null;
};

export function summarizeMaintenanceRows(
  rows: MaintenanceSummaryRow[],
  options: { now?: Date; dueSoonDays?: number; dueSoonKm?: number } = {},
): VehicleMaintenanceSummary {
  const now = options.now ?? new Date();
  const dueConfig = normalizeMaintenanceDueConfig({
    dueSoonDays: options.dueSoonDays,
    dueSoonKm: options.dueSoonKm,
  });
  let totalMaintenanceCostCents = 0;
  let overdueCount = 0;
  let openScheduledCount = 0;
  let lastServiceDate: string | null = null;
  let nextDueDate: string | null = null;

  for (const row of rows) {
    const status = normalizeStatus(row.status);
    const canonicalTotal = computeMaintenanceRecordTotal(row);
    const persistedTotal = asOptionalNonNegativeInt(row.total_cost_cents);
    const total = persistedTotal ?? canonicalTotal;

    if (status === "COMPLETED" || status === "IN_PROGRESS") {
      totalMaintenanceCostCents += total;
    }

    if (status === "SCHEDULED" || status === "IN_PROGRESS") {
      openScheduledCount += 1;
    }

    const dueState = getMaintenanceDueState(row, now, row.current_odometer_km, {
      dueSoonDays: dueConfig.dueSoonDays,
      dueSoonKm: dueConfig.dueSoonKm,
    });
    if (dueState === "OVERDUE") {
      overdueCount += 1;
    }

    const serviceDate = asDateOnly(row.service_date);
    if (serviceDate && (!lastServiceDate || serviceDate > lastServiceDate)) {
      lastServiceDate = serviceDate;
    }

    const recordDueDate = resolveDueDate(row);
    if (
      recordDueDate &&
      (status === "SCHEDULED" || status === "IN_PROGRESS") &&
      (!nextDueDate || recordDueDate < nextDueDate)
    ) {
      nextDueDate = recordDueDate;
    }
  }

  return {
    totalMaintenanceCostCents,
    lastServiceDate,
    nextDueDate,
    overdueCount,
    openScheduledCount,
  };
}

export async function summarizeVehicleMaintenance(
  vehicleId: string,
  now = new Date(),
): Promise<VehicleMaintenanceSummary> {
  const { settings } = await loadAdminSettings();

  const result = await dbQuery<MaintenanceSummaryRow>(
    `select
      r.status,
      r.service_date,
      r.scheduled_date,
      r.next_due_date,
      r.next_due_odometer_km,
      r.labor_cost_cents,
      r.parts_cost_cents,
      r.tax_cost_cents,
      r.total_cost_cents,
      p.odometer_value as current_odometer_km
    from vehicle_maintenance_records r
    left join vehicle_profiles p on p.vehicle_id = r.vehicle_id
    where r.vehicle_id = $1::uuid
      and r.archived_at is null
    order by coalesce(r.next_due_date, r.scheduled_date, r.service_date) asc nulls last, r.created_at asc`,
    [vehicleId],
  );

  return summarizeMaintenanceRows(result.rows, {
    now,
    dueSoonDays: settings.maintenanceDueSoonDays,
    dueSoonKm: settings.maintenanceDueSoonKm,
  });
}

type UpcomingMaintenanceRow = {
  id: string;
  vehicle_id: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  status: string;
  category: string;
  title: string;
  scheduled_date: string | null;
  service_date: string | null;
  next_due_date: string | null;
  next_due_odometer_km: number | null;
  labor_cost_cents: number | null;
  parts_cost_cents: number | null;
  tax_cost_cents: number | null;
  total_cost_cents: number | null;
  priority: string;
  current_odometer_km: number | null;
};

function asDateRangeBounds(dateFrom?: string | null, dateTo?: string | null) {
  const from = asDateOnly(dateFrom ?? null);
  const to = asDateOnly(dateTo ?? null);
  return { from, to };
}

export async function listUpcomingMaintenance(
  options: ListUpcomingMaintenanceOptions = {},
): Promise<UpcomingMaintenanceItem[]> {
  const { settings } = await loadAdminSettings();
  const now = options.now ?? new Date();

  const dueSoonDays =
    options.dueSoonDays ?? settings.maintenanceDueSoonDays ?? 14;
  const dueSoonKm =
    options.dueSoonKm ?? settings.maintenanceDueSoonKm ?? 500;

  const values: Array<string | number | boolean | string[]> = [];
  const where: string[] = [];

  const onlyActive = options.onlyActive !== false;
  if (onlyActive) {
    where.push("r.archived_at is null");
  }

  if (options.vehicleId) {
    values.push(options.vehicleId);
    where.push(`r.vehicle_id = $${values.length}::uuid`);
  }

  if (Array.isArray(options.status) && options.status.length > 0) {
    values.push(options.status);
    where.push(`upper(r.status) = any($${values.length}::text[])`);
  }

  if (Array.isArray(options.category) && options.category.length > 0) {
    values.push(options.category);
    where.push(`upper(r.category) = any($${values.length}::text[])`);
  }

  const dateBounds = asDateRangeBounds(options.dateFrom, options.dateTo);
  if (dateBounds.from) {
    values.push(dateBounds.from);
    where.push(`coalesce(r.scheduled_date, r.service_date, r.next_due_date) >= $${values.length}::date`);
  }
  if (dateBounds.to) {
    values.push(dateBounds.to);
    where.push(`coalesce(r.scheduled_date, r.service_date, r.next_due_date) <= $${values.length}::date`);
  }

  const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000);
  values.push(limit);

  const whereSql = where.length > 0 ? `where ${where.join(" and ")}` : "";

  const result = await dbQuery<UpcomingMaintenanceRow>(
    `select
      r.id,
      r.vehicle_id,
      v.make as vehicle_make,
      v.model as vehicle_model,
      v.year as vehicle_year,
      r.status,
      r.category,
      r.title,
      r.scheduled_date,
      r.service_date,
      r.next_due_date,
      r.next_due_odometer_km,
      r.labor_cost_cents,
      r.parts_cost_cents,
      r.tax_cost_cents,
      r.total_cost_cents,
      r.priority,
      p.odometer_value as current_odometer_km
    from vehicle_maintenance_records r
    join vehicles v on v.id = r.vehicle_id
    left join vehicle_profiles p on p.vehicle_id = r.vehicle_id
    ${whereSql}
    order by coalesce(r.next_due_date, r.scheduled_date, r.service_date) asc nulls last, r.created_at desc
    limit $${values.length}::int`,
    values,
  );

  const rows: UpcomingMaintenanceItem[] = result.rows.map((row: UpcomingMaintenanceRow) => {
    const dueState = getMaintenanceDueState(row, now, row.current_odometer_km, {
      dueSoonDays,
      dueSoonKm,
    });
    const canonicalTotal = computeMaintenanceRecordTotal(row);
    const persistedTotal = asOptionalNonNegativeInt(row.total_cost_cents);

    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      vehicleLabel: `${row.vehicle_year} ${row.vehicle_make} ${row.vehicle_model}`,
      status: normalizeStatus(row.status),
      category: normalizeCategory(row.category),
      title: row.title,
      scheduledDate: asDateOnly(row.scheduled_date),
      serviceDate: asDateOnly(row.service_date),
      nextDueDate: asDateOnly(row.next_due_date),
      dueState,
      totalCostCents: persistedTotal ?? canonicalTotal,
      priority: normalizeText(row.priority).toUpperCase() || "NORMAL",
      currentOdometerKm: asOptionalNonNegativeInt(row.current_odometer_km),
    };
  });

  const filterDueState = Array.isArray(options.dueState) ? options.dueState : [];
  if (filterDueState.length > 0) {
    const dueSet = new Set(filterDueState);
    return rows.filter((row: UpcomingMaintenanceItem) => dueSet.has(row.dueState));
  }

  return rows;
}
