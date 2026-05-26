import { NextResponse } from "next/server";

import { loadAdminSettings } from "@/lib/adminSettings";
import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { consumeRouteRateLimit, withRateLimitHeaders } from "@/lib/security/rate-limit";
import {
  removeMaintenanceBlockoutByRecordId,
  syncMaintenanceBlockout,
  upsertMaintenanceBlockout,
} from "@/lib/vehicles/maintenanceBlockouts";
import {
  computeMaintenanceRecordTotal,
  getMaintenanceDueState,
  MAINTENANCE_RECORD_STATUSES,
  summarizeVehicleMaintenance,
  type MaintenanceDueState,
  type MaintenanceRecordStatus,
} from "@/lib/vehicles/maintenance";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

export const dynamic = "force-dynamic";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;
const ADMIN_MAINTENANCE_MUTATION_LIMIT = 20;
const ADMIN_MAINTENANCE_MUTATION_WINDOW_SECONDS = 10 * 60;

const DEFAULT_MAINTENANCE_CATEGORIES = [
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

const DEFAULT_MAINTENANCE_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type MaintenanceRecordRow = {
  id: string;
  public_id: string | null;
  vehicle_id: string;
  status: string;
  category: string;
  title: string;
  description: string | null;
  vendor_name: string | null;
  vendor_contact: string | null;
  reference_number: string | null;
  service_date: string | null;
  scheduled_date: string | null;
  completed_date: string | null;
  odometer_km: number | null;
  next_due_date: string | null;
  next_due_odometer_km: number | null;
  reminder_lead_days: number | null;
  labor_cost_cents: number | null;
  parts_cost_cents: number | null;
  tax_cost_cents: number | null;
  estimated_cost_cents: number | null;
  actual_cost_cents: number | null;
  total_cost_cents: number | null;
  linked_expense_id: string | null;
  linked_repair_order_id: string | null;
  currency: string;
  priority: string;
  created_by_user_id: string | null;
  completed_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  current_odometer_km: number | null;
  linked_blockout_id: string | null;
  linked_blockout_start_at: string | null;
  linked_blockout_end_at: string | null;
  linked_blockout_reason: string | null;
  linked_blockout_source: string | null;
};

type CreateMaintenanceRecordInput = {
  status: MaintenanceRecordStatus;
  category: string;
  title: string;
  description: string | null;
  vendorName: string | null;
  vendorContact: string | null;
  referenceNumber: string | null;
  serviceDate: string | null;
  scheduledDate: string | null;
  completedDate: string | null;
  odometerKm: number | null;
  nextDueDate: string | null;
  nextDueOdometerKm: number | null;
  reminderLeadDays: number | null;
  laborCostCents: number | null;
  partsCostCents: number | null;
  taxCostCents: number | null;
  estimatedCostCents: number | null;
  actualCostCents: number | null;
  totalCostCents: number;
  linkedExpenseId: string | null;
  linkedRepairOrderId: string | null;
  priority: string;
  completedByUserId: string | null;
};

type ListMaintenanceFilters = {
  view: "all" | "overdue" | "dueSoon" | "upcoming" | "completed";
  query: string | null;
  sort: "dueDate" | "createdAt" | "cost" | "title" | "status" | "category";
  dir: "asc" | "desc";
  limit: number;
  offset: number;
  dueSoonDays: number;
  dueSoonKm: number;
  status: MaintenanceRecordStatus[];
  category: string[];
  fromDate: string | null;
  toDate: string | null;
  includeArchived: boolean;
};

type MaintenanceSettingsMeta = {
  categories: string[];
  priorities: string[];
  defaultReminderLeadDays: number;
};

export type VehicleMaintenanceRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  consumeRateLimitCheck?: typeof consumeRouteRateLimit;
  resolveActorUserId?: (userId: string | null) => Promise<string | null>;
  getDueConfig?: () => Promise<{ dueSoonDays: number; dueSoonKm: number }>;
  getSettingsMeta?: () => Promise<MaintenanceSettingsMeta>;
  listRecords: (
    vehicleId: string,
    filters: ListMaintenanceFilters,
  ) => Promise<MaintenanceRecordRow[] | { rows: MaintenanceRecordRow[]; total: number }>;
  getRecord?: (vehicleId: string, recordId: string) => Promise<MaintenanceRecordRow | null>;
  createRecord: (
    vehicleId: string,
    input: CreateMaintenanceRecordInput,
    userId: string | null,
  ) => Promise<MaintenanceRecordRow | null>;
  createOrUpdateLinkedBlockout?: (input: {
    vehicleId: string;
    maintenanceRecordId: string;
    title: string;
    scheduledDate: string | null;
    serviceDate: string | null;
    startAt: string | null;
    endAt: string | null;
    reason: string | null;
    notes: string | null;
    userId: string | null;
  }) => Promise<void>;
  removeLinkedBlockout?: (maintenanceRecordId: string, vehicleId?: string) => Promise<void>;
  syncLinkedBlockout?: (input: {
    vehicleId: string;
    maintenanceRecordId: string;
    title: string;
    scheduledDate: string | null;
    serviceDate: string | null;
    status: string;
    completedDate: string | null;
    startAt: string | null;
    endAt: string | null;
    reason: string | null;
    notes: string | null;
    userId: string | null;
    ensureWhenOpen: boolean;
  }) => Promise<void>;
  appendStatusHistory?: (input: {
    maintenanceRecordId: string;
    vehicleId: string;
    previousStatus: string | null;
    nextStatus: string;
    changedByUserId: string | null;
    note?: string | null;
  }) => Promise<void>;
  summarize: (vehicleId: string) => Promise<{
    totalMaintenanceCostCents: number;
    lastServiceDate: string | null;
    nextDueDate: string | null;
    overdueCount: number;
    openScheduledCount: number;
  }>;
};

function normalizeText(value: unknown, max = 255) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function normalizeNullableText(value: unknown, max = 255) {
  const normalized = normalizeText(value, max);
  return normalized ? normalized : null;
}

function normalizeDate(value: unknown) {
  const text = normalizeText(value, 30);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeInt(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

function normalizeNonNegativeInt(value: unknown) {
  const parsed = normalizeInt(value);
  if (parsed === null) return null;
  return parsed >= 0 ? parsed : null;
}

function hasNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed < 0;
}

function normalizeStatus(value: unknown): MaintenanceRecordStatus {
  const normalized = normalizeText(value, 30).toUpperCase();
  if (MAINTENANCE_RECORD_STATUSES.includes(normalized as MaintenanceRecordStatus)) {
    return normalized as MaintenanceRecordStatus;
  }
  return "SCHEDULED";
}

function normalizeConfiguredCategory(value: unknown, allowedCategories: string[]) {
  const normalized = normalizeText(value, 40).toUpperCase();
  if (!normalized) return allowedCategories[0] ?? "OTHER";
  if (allowedCategories.includes(normalized)) return normalized;
  return allowedCategories.includes("OTHER") ? "OTHER" : allowedCategories[0] ?? "OTHER";
}

function normalizeConfiguredPriority(value: unknown, allowedPriorities: string[]) {
  const normalized = normalizeText(value, 20).toUpperCase();
  if (!normalized) return allowedPriorities[0] ?? "NORMAL";
  if (allowedPriorities.includes(normalized)) return normalized;
  return allowedPriorities.includes("NORMAL") ? "NORMAL" : allowedPriorities[0] ?? "NORMAL";
}

function parseOptionalUuidField(
  body: Record<string, unknown> | null,
  camelKey: string,
  snakeKey: string,
) {
  if (!body || (!(camelKey in body) && !(snakeKey in body))) {
    return { provided: false, value: null as string | null, invalid: false };
  }
  const normalized = normalizeText(body[camelKey] ?? body[snakeKey], 80);
  if (!normalized) {
    return { provided: true, value: null as string | null, invalid: false };
  }
  if (!UUID_REGEX.test(normalized)) {
    return { provided: true, value: null as string | null, invalid: true };
  }
  return { provided: true, value: normalized, invalid: false };
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

function parseCsvList(input: string | null) {
  if (!input) return [];
  return input
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeDueState(value: string): MaintenanceDueState | null {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "OVERDUE" ||
    normalized === "DUE_SOON" ||
    normalized === "UPCOMING" ||
    normalized === "COMPLETED" ||
    normalized === "CANCELLED"
  ) {
    return normalized;
  }
  return null;
}

function normalizeView(value: string | null) {
  const normalized = normalizeText(value, 30).toLowerCase();
  if (
    normalized === "all" ||
    normalized === "overdue" ||
    normalized === "duesoon" ||
    normalized === "upcoming" ||
    normalized === "completed"
  ) {
    return normalized === "duesoon" ? "dueSoon" : (normalized as ListMaintenanceFilters["view"]);
  }
  return "all";
}

function dueStateToView(value: MaintenanceDueState | null): ListMaintenanceFilters["view"] {
  if (value === "OVERDUE") return "overdue";
  if (value === "DUE_SOON") return "dueSoon";
  if (value === "UPCOMING") return "upcoming";
  if (value === "COMPLETED") return "completed";
  return "all";
}

function normalizeQuery(value: string | null) {
  const normalized = normalizeText(value, 120);
  return normalized ? normalized : null;
}

function normalizeSort(value: string | null): ListMaintenanceFilters["sort"] {
  const normalized = normalizeText(value, 30).toLowerCase();
  if (normalized === "createdat") return "createdAt";
  if (normalized === "cost") return "cost";
  if (normalized === "title") return "title";
  if (normalized === "status") return "status";
  if (normalized === "category") return "category";
  return "dueDate";
}

function normalizeDir(value: string | null): ListMaintenanceFilters["dir"] {
  return normalizeText(value, 10).toLowerCase() === "desc" ? "desc" : "asc";
}

function normalizeLimit(value: string | null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

function normalizeOffset(value: string | null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function dedupeUpperList(value: unknown, fallback: readonly string[]) {
  const base = Array.isArray(value)
    ? value.map((entry) => String(entry ?? "").trim())
    : [];
  const normalized = base
    .map((entry) => entry.toUpperCase())
    .filter(Boolean)
    .slice(0, 40);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const entry of normalized) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    deduped.push(entry);
  }

  if (deduped.length > 0) return deduped;
  return [...fallback];
}

function parseFiltersFromSearchParams(
  searchParams: URLSearchParams,
  dueConfig: { dueSoonDays: number; dueSoonKm: number },
): ListMaintenanceFilters {
  const status = parseCsvList(searchParams.get("status"))
    .map((value) => normalizeStatus(value))
    .filter((value, index, arr) => arr.indexOf(value) === index);

  const category = parseCsvList(searchParams.get("category"))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);

  const dueStates = parseCsvList(searchParams.get("dueState"))
    .map((value) => normalizeDueState(value))
    .filter((value): value is MaintenanceDueState => Boolean(value))
    .filter((value, index, arr) => arr.indexOf(value) === index);

  const explicitView = searchParams.get("view");
  const view = explicitView ? normalizeView(explicitView) : dueStateToView(dueStates[0] ?? null);

  return {
    view,
    query: normalizeQuery(searchParams.get("q")),
    sort: normalizeSort(searchParams.get("sort")),
    dir: normalizeDir(searchParams.get("dir")),
    limit: normalizeLimit(searchParams.get("limit")),
    offset: normalizeOffset(searchParams.get("offset")),
    dueSoonDays: dueConfig.dueSoonDays,
    dueSoonKm: dueConfig.dueSoonKm,
    status,
    category,
    fromDate: normalizeDate(searchParams.get("from")),
    toDate: normalizeDate(searchParams.get("to")),
    includeArchived: searchParams.get("includeArchived") === "1",
  };
}

function mapRow(
  row: MaintenanceRecordRow,
  dueConfig?: { dueSoonDays: number; dueSoonKm: number },
) {
  const computedTotal = computeMaintenanceRecordTotal(row);
  const persistedTotal = normalizeNonNegativeInt(row.total_cost_cents);
  const totalCostCents = persistedTotal ?? computedTotal;
  const dueState = getMaintenanceDueState(row, new Date(), row.current_odometer_km, dueConfig);

  return {
    id: row.id,
    publicId: normalizeText(row.public_id, 32) || row.id,
    vehicleId: row.vehicle_id,
    status: normalizeStatus(row.status),
    category: normalizeText(row.category, 40).toUpperCase() || "OTHER",
    title: row.title,
    description: row.description,
    vendorName: row.vendor_name,
    vendorContact: row.vendor_contact,
    referenceNumber: row.reference_number,
    serviceDate: row.service_date,
    scheduledDate: row.scheduled_date,
    completedDate: row.completed_date,
    odometerKm: row.odometer_km,
    nextDueDate: row.next_due_date,
    nextDueOdometerKm: row.next_due_odometer_km,
    reminderLeadDays: row.reminder_lead_days,
    laborCostCents: row.labor_cost_cents,
    partsCostCents: row.parts_cost_cents,
    taxCostCents: row.tax_cost_cents,
    estimatedCostCents: row.estimated_cost_cents,
    actualCostCents: row.actual_cost_cents,
    totalCostCents,
    linkedExpenseId: row.linked_expense_id,
    linkedRepairOrderId: row.linked_repair_order_id,
    currency: row.currency,
    priority: normalizeText(row.priority, 20).toUpperCase() || "NORMAL",
    createdByUserId: row.created_by_user_id,
    completedByUserId: row.completed_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    linkedBlockout: row.linked_blockout_id
      ? {
          id: row.linked_blockout_id,
          startAt: row.linked_blockout_start_at,
          endAt: row.linked_blockout_end_at,
          reason: row.linked_blockout_reason,
          source: row.linked_blockout_source,
        }
      : null,
    dueState,
  };
}

function matchesView(
  view: ListMaintenanceFilters["view"],
  item: ReturnType<typeof mapRow>,
) {
  if (view === "all") return true;
  if (view === "completed") return item.dueState === "COMPLETED" || item.status === "COMPLETED";
  if (view === "overdue") return item.dueState === "OVERDUE";
  if (view === "dueSoon") return item.dueState === "DUE_SOON";
  if (view === "upcoming") return item.dueState === "UPCOMING";
  return true;
}

const DUE_DATE_SQL = "coalesce(r.next_due_date, r.scheduled_date, r.service_date)";
const TOTAL_COST_SQL =
  "coalesce(r.total_cost_cents, coalesce(r.labor_cost_cents, 0) + coalesce(r.parts_cost_cents, 0) + coalesce(r.tax_cost_cents, 0))";

const BASE_SELECT = `
  select
    r.id,
    r.public_id,
    r.vehicle_id,
    r.status,
    r.category,
    r.title,
    r.description,
    r.vendor_name,
    r.vendor_contact,
    r.reference_number,
    r.service_date,
    r.scheduled_date,
    r.completed_date,
    r.odometer_km,
    r.next_due_date,
    r.next_due_odometer_km,
    r.reminder_lead_days,
    r.labor_cost_cents,
    r.parts_cost_cents,
    r.tax_cost_cents,
    r.estimated_cost_cents,
    r.actual_cost_cents,
    r.total_cost_cents,
    r.linked_expense_id,
    r.linked_repair_order_id,
    r.currency,
    r.priority,
    r.created_by_user_id,
    r.completed_by_user_id,
    r.created_at,
    r.updated_at,
    r.archived_at,
    p.odometer_value as current_odometer_km,
    b.id as linked_blockout_id,
    b.start_at as linked_blockout_start_at,
    b.end_at as linked_blockout_end_at,
    b.reason as linked_blockout_reason,
    b.source as linked_blockout_source
  from vehicle_maintenance_records r
  left join vehicle_profiles p on p.vehicle_id = r.vehicle_id
  left join blockouts b on b.linked_maintenance_id = r.id
`;

const DEFAULT_DEPS: VehicleMaintenanceRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  consumeRateLimitCheck: consumeRouteRateLimit,
  resolveActorUserId: async (userId) => {
    if (!userId || !UUID_REGEX.test(userId)) return null;
    const result = await dbQuery<{ id: string }>(
      "select id from users where id = $1::uuid limit 1",
      [userId],
    );
    return result.rows[0]?.id ?? null;
  },
  getDueConfig: async () => {
    const { settings } = await loadAdminSettings();
    return {
      dueSoonDays: settings.maintenanceDueSoonDays,
      dueSoonKm: settings.maintenanceDueSoonKm,
    };
  },
  getSettingsMeta: async () => {
    const { settings } = await loadAdminSettings();
    return {
      categories: dedupeUpperList(settings.maintenanceCategories, DEFAULT_MAINTENANCE_CATEGORIES),
      priorities: dedupeUpperList(settings.maintenancePriorities, DEFAULT_MAINTENANCE_PRIORITIES),
      defaultReminderLeadDays: settings.maintenanceReminderLeadDays,
    };
  },
  listRecords: async (vehicleId, filters) => {
    const values: Array<string | string[] | number> = [vehicleId];
    const where: string[] = ["r.vehicle_id = $1::uuid"];
    const openStatusCondition = "upper(r.status) not in ('COMPLETED', 'CANCELLED')";
    const overdueCondition = `(${DUE_DATE_SQL} is not null and ${DUE_DATE_SQL} < current_date) or (r.next_due_odometer_km is not null and p.odometer_value is not null and p.odometer_value >= r.next_due_odometer_km)`;

    if (!filters.includeArchived) {
      where.push("r.archived_at is null");
    }

    if (filters.status.length > 0) {
      values.push(filters.status);
      where.push(`upper(r.status) = any($${values.length}::text[])`);
    }

    if (filters.category.length > 0) {
      values.push(filters.category);
      where.push(`upper(r.category) = any($${values.length}::text[])`);
    }

    if (filters.fromDate) {
      values.push(filters.fromDate);
      where.push(`coalesce(r.scheduled_date, r.service_date, r.next_due_date) >= $${values.length}::date`);
    }

    if (filters.toDate) {
      values.push(filters.toDate);
      where.push(`${DUE_DATE_SQL} <= $${values.length}::date`);
    }

    if (filters.query) {
      values.push(`%${filters.query}%`);
      where.push(
        `(r.title ilike $${values.length} or r.category ilike $${values.length} or r.status ilike $${values.length} or r.public_id ilike $${values.length})`,
      );
    }

    let dueSoonCondition: string | null = null;
    const getDueSoonCondition = () => {
      if (dueSoonCondition) return dueSoonCondition;
      values.push(filters.dueSoonDays);
      const daysIndex = values.length;
      values.push(filters.dueSoonKm);
      const kmIndex = values.length;
      dueSoonCondition = `(${DUE_DATE_SQL} is not null and ${DUE_DATE_SQL} >= current_date and ${DUE_DATE_SQL} <= (current_date + $${daysIndex}::int)) or (r.next_due_odometer_km is not null and p.odometer_value is not null and p.odometer_value < r.next_due_odometer_km and (r.next_due_odometer_km - p.odometer_value) <= $${kmIndex}::int)`;
      return dueSoonCondition;
    };

    if (filters.view === "completed") {
      where.push("(upper(r.status) = 'COMPLETED' or r.completed_date is not null)");
    } else if (filters.view === "overdue") {
      where.push(`(${openStatusCondition}) and (${overdueCondition})`);
    } else if (filters.view === "dueSoon") {
      where.push(`(${openStatusCondition}) and not (${overdueCondition}) and (${getDueSoonCondition()})`);
    } else if (filters.view === "upcoming") {
      where.push(
        `(${openStatusCondition}) and not (${overdueCondition}) and not (${getDueSoonCondition()})`,
      );
    }

    const orderDirection = filters.dir === "asc" ? "asc" : "desc";
    const sortColumn =
      filters.sort === "createdAt"
        ? "r.created_at"
        : filters.sort === "cost"
          ? TOTAL_COST_SQL
          : filters.sort === "title"
            ? "lower(r.title)"
            : filters.sort === "status"
              ? "upper(r.status)"
              : filters.sort === "category"
                ? "upper(r.category)"
          : DUE_DATE_SQL;

    const rowsResult = await dbQuery<MaintenanceRecordRow>(
      `${BASE_SELECT}
       where ${where.join(" and ")}
       order by ${sortColumn} ${orderDirection} nulls last, r.created_at desc
       limit $${values.length + 1}
       offset $${values.length + 2}`,
      [...values, filters.limit, filters.offset],
    );

    const countResult = await dbQuery<{ total: number }>(
      `select count(*)::int as total
       from vehicle_maintenance_records r
       left join vehicle_profiles p on p.vehicle_id = r.vehicle_id
       where ${where.join(" and ")}`,
      values,
    );

    return {
      rows: rowsResult.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
    };
  },
  getRecord: async (vehicleId, recordId) => {
    const result = await dbQuery<MaintenanceRecordRow>(
      `${BASE_SELECT} where r.vehicle_id = $1::uuid and r.id = $2::uuid limit 1`,
      [vehicleId, recordId],
    );
    return result.rows[0] ?? null;
  },
  createRecord: async (vehicleId, input, userId) => {
    const vehicle = await dbQuery<{ id: string }>(
      "select id from vehicles where id = $1::uuid limit 1",
      [vehicleId],
    );
    if (vehicle.rowCount < 1) return null;

    const created = await dbQuery<{ id: string }>(
      `insert into vehicle_maintenance_records (
        vehicle_id,
        status,
        category,
        title,
        description,
        vendor_name,
        vendor_contact,
        reference_number,
        service_date,
        scheduled_date,
        completed_date,
        odometer_km,
        next_due_date,
        next_due_odometer_km,
        reminder_lead_days,
        labor_cost_cents,
        parts_cost_cents,
        tax_cost_cents,
        estimated_cost_cents,
        actual_cost_cents,
        total_cost_cents,
        linked_expense_id,
        linked_repair_order_id,
        currency,
        priority,
        created_by_user_id,
        completed_by_user_id
      )
      values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9::date,
        $10::date,
        $11::date,
        $12,
        $13::date,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        $21,
        $22::uuid,
        $23::uuid,
        'JMD',
        $24,
        $25::uuid,
        $26::uuid
      )
      returning id`,
      [
        vehicleId,
        input.status,
        input.category,
        input.title,
        input.description,
        input.vendorName,
        input.vendorContact,
        input.referenceNumber,
        input.serviceDate,
        input.scheduledDate,
        input.completedDate,
        input.odometerKm,
        input.nextDueDate,
        input.nextDueOdometerKm,
        input.reminderLeadDays,
        input.laborCostCents,
        input.partsCostCents,
        input.taxCostCents,
        input.estimatedCostCents,
        input.actualCostCents,
        input.totalCostCents,
        input.linkedExpenseId,
        input.linkedRepairOrderId,
        input.priority,
        userId,
        input.completedByUserId,
      ],
    );

    const next = await dbQuery<MaintenanceRecordRow>(
      `${BASE_SELECT} where r.id = $1::uuid limit 1`,
      [created.rows[0]?.id],
    );
    return next.rows[0] ?? null;
  },
  createOrUpdateLinkedBlockout: async (input) => {
    await upsertMaintenanceBlockout({
      vehicleId: input.vehicleId,
      maintenanceRecordId: input.maintenanceRecordId,
      title: input.title,
      scheduledDate: input.scheduledDate,
      serviceDate: input.serviceDate,
      startAt: input.startAt,
      endAt: input.endAt,
      reason: input.reason,
      notes: input.notes,
      createdByUserId: input.userId,
    });
  },
  removeLinkedBlockout: async (maintenanceRecordId, vehicleId) => {
    await removeMaintenanceBlockoutByRecordId(maintenanceRecordId, { vehicleId });
  },
  syncLinkedBlockout: async (input) => {
    await syncMaintenanceBlockout({
      vehicleId: input.vehicleId,
      maintenanceRecordId: input.maintenanceRecordId,
      title: input.title,
      scheduledDate: input.scheduledDate,
      serviceDate: input.serviceDate,
      status: input.status,
      completedDate: input.completedDate,
      startAt: input.startAt,
      endAt: input.endAt,
      reason: input.reason,
      notes: input.notes,
      createdByUserId: input.userId,
      ensureWhenOpen: input.ensureWhenOpen,
    });
  },
  appendStatusHistory: async (input) => {
    await dbQuery(
      `insert into vehicle_maintenance_status_history (
        maintenance_record_id,
        vehicle_id,
        previous_status,
        next_status,
        note,
        changed_by_user_id
      ) values ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)`,
      [
        input.maintenanceRecordId,
        input.vehicleId,
        input.previousStatus,
        input.nextStatus,
        input.note ?? null,
        input.changedByUserId,
      ],
    );
  },
  summarize: async (vehicleId) => summarizeVehicleMaintenance(vehicleId),
};

async function resolveSettingsMeta(
  deps: VehicleMaintenanceRouteDeps,
): Promise<MaintenanceSettingsMeta> {
  if (deps.getSettingsMeta) return deps.getSettingsMeta();
  return {
    categories: [...DEFAULT_MAINTENANCE_CATEGORIES],
    priorities: [...DEFAULT_MAINTENANCE_PRIORITIES],
    defaultReminderLeadDays: 7,
  };
}

export async function handleVehicleMaintenanceGet(
  request: Request,
  context: RouteContext,
  deps: VehicleMaintenanceRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }
  try {
    const dueConfig = deps.getDueConfig
      ? await deps.getDueConfig()
      : { dueSoonDays: 14, dueSoonKm: 500 };
    const filters = parseFiltersFromSearchParams(new URL(request.url).searchParams, dueConfig);

    const [settingsMeta, listed, summary] = await Promise.all([
      resolveSettingsMeta(deps),
      deps.listRecords(id, filters),
      deps.summarize(id),
    ]);

    const rowResult = Array.isArray(listed) ? listed : listed.rows;
    let items = rowResult.map((row) => mapRow(row, dueConfig));
    if (filters.view !== "all") {
      items = items.filter((item) => matchesView(filters.view, item));
    }
    const total =
      Array.isArray(listed)
        ? items.length
        : Math.max(items.length, Number(listed.total ?? items.length));

    return NextResponse.json({
      ok: true,
      items,
      rows: items,
      summary,
      paging: {
        limit: filters.limit,
        offset: filters.offset,
        total,
      },
      options: {
        categories: settingsMeta.categories,
        priorities: settingsMeta.priorities,
        defaultReminderLeadDays: settingsMeta.defaultReminderLeadDays,
      },
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to load maintenance records." }, { status: 500 });
  }
}

export async function handleVehicleMaintenancePost(
  request: Request,
  context: RouteContext,
  deps: VehicleMaintenanceRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }
  const rateLimit = await (deps.consumeRateLimitCheck ?? consumeRouteRateLimit)({
    scope: "ADMIN_MAINTENANCE_MUTATION_USER",
    route: "/api/admin/vehicles/[id]/maintenance",
    limit: ADMIN_MAINTENANCE_MUTATION_LIMIT,
    windowSeconds: ADMIN_MAINTENANCE_MUTATION_WINDOW_SECONDS,
    keyParts: [session.userId, id, "create"],
  });
  if (!rateLimit.allowed) {
    return withRateLimitHeaders(
      NextResponse.json({ ok: false, error: "Too many maintenance changes. Please try again later." }, { status: 429 }),
      rateLimit,
    );
  }

  const settingsMeta = await resolveSettingsMeta(deps);
  const actorUserId = deps.resolveActorUserId
    ? await deps.resolveActorUserId(session.userId)
    : session.userId;
  const linkedExpenseInput = parseOptionalUuidField(body, "linkedExpenseId", "linked_expense_id");
  if (linkedExpenseInput.invalid) {
    return NextResponse.json({ ok: false, error: "Linked expense ID must be a valid UUID." }, { status: 400 });
  }
  const linkedRepairOrderInput = parseOptionalUuidField(
    body,
    "linkedRepairOrderId",
    "linked_repair_order_id",
  );
  if (linkedRepairOrderInput.invalid) {
    return NextResponse.json(
      { ok: false, error: "Linked repair order ID must be a valid UUID." },
      { status: 400 },
    );
  }

  const serviceDate = normalizeDate(body?.serviceDate ?? body?.service_date);
  const scheduledDate = normalizeDate(body?.scheduledDate ?? body?.scheduled_date);

  if (!serviceDate && !scheduledDate) {
    return NextResponse.json(
      { ok: false, error: "Provide a scheduled date or service date." },
      { status: 400 },
    );
  }

  const laborCostCents = normalizeNonNegativeInt(body?.laborCostCents ?? body?.labor_cost_cents);
  const partsCostCents = normalizeNonNegativeInt(body?.partsCostCents ?? body?.parts_cost_cents);
  const taxCostCents = normalizeNonNegativeInt(body?.taxCostCents ?? body?.tax_cost_cents);
  const estimatedCostCents = normalizeNonNegativeInt(
    body?.estimatedCostCents ?? body?.estimated_cost_cents,
  );
  const actualCostCents = normalizeNonNegativeInt(body?.actualCostCents ?? body?.actual_cost_cents);
  const reminderLeadDays =
    normalizeNonNegativeInt(body?.reminderLeadDays ?? body?.reminder_lead_days) ??
    settingsMeta.defaultReminderLeadDays;

  if (
    hasNegativeNumber(body?.laborCostCents ?? body?.labor_cost_cents) ||
    hasNegativeNumber(body?.partsCostCents ?? body?.parts_cost_cents) ||
    hasNegativeNumber(body?.taxCostCents ?? body?.tax_cost_cents) ||
    hasNegativeNumber(body?.estimatedCostCents ?? body?.estimated_cost_cents) ||
    hasNegativeNumber(body?.actualCostCents ?? body?.actual_cost_cents) ||
    hasNegativeNumber(body?.odometerKm ?? body?.odometer_km) ||
    hasNegativeNumber(body?.nextDueOdometerKm ?? body?.next_due_odometer_km) ||
    hasNegativeNumber(body?.reminderLeadDays ?? body?.reminder_lead_days)
  ) {
    return NextResponse.json(
      { ok: false, error: "Negative values are not allowed." },
      { status: 400 },
    );
  }

  const status = normalizeStatus(body?.status);
  const completedDate =
    normalizeDate(body?.completedDate ?? body?.completed_date) ??
    (status === "COMPLETED"
      ? serviceDate ?? scheduledDate ?? new Date().toISOString().slice(0, 10)
      : null);

  const input: CreateMaintenanceRecordInput = {
    status,
    category: normalizeConfiguredCategory(body?.category, settingsMeta.categories),
    title: normalizeText(body?.title, 180),
    description: normalizeNullableText(body?.description, 4000),
    vendorName: normalizeNullableText(body?.vendorName ?? body?.vendor_name, 180),
    vendorContact: normalizeNullableText(body?.vendorContact ?? body?.vendor_contact, 180),
    referenceNumber: normalizeNullableText(body?.referenceNumber ?? body?.reference_number, 120),
    serviceDate,
    scheduledDate,
    completedDate,
    odometerKm: normalizeNonNegativeInt(body?.odometerKm ?? body?.odometer_km),
    nextDueDate: normalizeDate(body?.nextDueDate ?? body?.next_due_date),
    nextDueOdometerKm: normalizeNonNegativeInt(
      body?.nextDueOdometerKm ?? body?.next_due_odometer_km,
    ),
    reminderLeadDays,
    laborCostCents,
    partsCostCents,
    taxCostCents,
    estimatedCostCents,
    actualCostCents,
    totalCostCents: computeMaintenanceRecordTotal({ laborCostCents, partsCostCents, taxCostCents }),
    linkedExpenseId: linkedExpenseInput.value,
    linkedRepairOrderId: linkedRepairOrderInput.value,
    priority: normalizeConfiguredPriority(body?.priority, settingsMeta.priorities),
    completedByUserId: status === "COMPLETED" ? actorUserId : null,
  };

  if (!input.title) {
    return NextResponse.json({ ok: false, error: "Title is required." }, { status: 400 });
  }

  const createBlockout = normalizeBoolean(body?.createBlockout ?? body?.create_blockout);
  const blockoutStartAt = normalizeNullableText(body?.blockoutStartAt ?? body?.blockout_start_at, 40);
  const blockoutEndAt = normalizeNullableText(body?.blockoutEndAt ?? body?.blockout_end_at, 40);
  const blockoutReason = normalizeNullableText(body?.blockoutReason ?? body?.blockout_reason, 140);
  const blockoutNotes = normalizeNullableText(body?.blockoutNotes ?? body?.blockout_notes, 4000);

  try {
    const dueConfig = deps.getDueConfig
      ? await deps.getDueConfig()
      : { dueSoonDays: 14, dueSoonKm: 500 };
    const row = await deps.createRecord(id, input, actorUserId);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
    }

    if (deps.appendStatusHistory) {
      await deps.appendStatusHistory({
        maintenanceRecordId: row.id,
        vehicleId: id,
        previousStatus: null,
        nextStatus: status,
        changedByUserId: actorUserId,
        note: "Record created",
      });
    }

    if (deps.syncLinkedBlockout) {
      await deps.syncLinkedBlockout({
        vehicleId: id,
        maintenanceRecordId: row.id,
        title: row.title,
        scheduledDate: row.scheduled_date,
        serviceDate: row.service_date,
        status: row.status,
        completedDate: row.completed_date,
        startAt: blockoutStartAt,
        endAt: blockoutEndAt,
        reason: blockoutReason,
        notes: blockoutNotes,
        userId: actorUserId,
        ensureWhenOpen: createBlockout,
      });
    } else if (createBlockout && deps.createOrUpdateLinkedBlockout) {
      await deps.createOrUpdateLinkedBlockout({
        vehicleId: id,
        maintenanceRecordId: row.id,
        title: row.title,
        scheduledDate: row.scheduled_date,
        serviceDate: row.service_date,
        startAt: blockoutStartAt,
        endAt: blockoutEndAt,
        reason: blockoutReason,
        notes: blockoutNotes,
        userId: actorUserId,
      });
    }

    const refreshed = deps.getRecord ? await deps.getRecord(id, row.id) : row;
    return NextResponse.json({ ok: true, item: mapRow(refreshed ?? row, dueConfig) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to create maintenance record." }, { status: 500 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceGet(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return handleVehicleMaintenancePost(request, context);
}
