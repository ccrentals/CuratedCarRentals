import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { loadAdminSettings } from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import {
  computeMaintenanceRecordTotal,
  getMaintenanceDueState,
  MAINTENANCE_RECORD_CATEGORIES,
  MAINTENANCE_RECORD_STATUSES,
  summarizeVehicleMaintenance,
  type MaintenanceDueState,
  type MaintenanceRecordCategory,
  type MaintenanceRecordStatus,
} from "@/lib/vehicles/maintenance";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type MaintenanceRecordRow = {
  id: string;
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
  odometer_km: number | null;
  next_due_date: string | null;
  next_due_odometer_km: number | null;
  labor_cost_cents: number | null;
  parts_cost_cents: number | null;
  tax_cost_cents: number | null;
  total_cost_cents: number | null;
  currency: string;
  priority: string;
  created_by_user_id: string | null;
  completed_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  current_odometer_km: number | null;
};

type CreateMaintenanceRecordInput = {
  status: MaintenanceRecordStatus;
  category: MaintenanceRecordCategory;
  title: string;
  description: string | null;
  vendorName: string | null;
  vendorContact: string | null;
  referenceNumber: string | null;
  serviceDate: string | null;
  scheduledDate: string | null;
  odometerKm: number | null;
  nextDueDate: string | null;
  nextDueOdometerKm: number | null;
  laborCostCents: number | null;
  partsCostCents: number | null;
  taxCostCents: number | null;
  totalCostCents: number;
  priority: string;
  completedByUserId: string | null;
};

type ListMaintenanceFilters = {
  status: MaintenanceRecordStatus[];
  category: MaintenanceRecordCategory[];
  dueState: MaintenanceDueState[];
  fromDate: string | null;
  toDate: string | null;
  includeArchived: boolean;
};

export type VehicleMaintenanceRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getDueConfig?: () => Promise<{ dueSoonDays: number; dueSoonKm: number }>;
  listRecords: (vehicleId: string, filters: ListMaintenanceFilters) => Promise<MaintenanceRecordRow[]>;
  createRecord: (
    vehicleId: string,
    input: CreateMaintenanceRecordInput,
    userId: string,
  ) => Promise<MaintenanceRecordRow | null>;
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
  const text = normalizeText(value, 20);
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

function normalizeCategory(value: unknown): MaintenanceRecordCategory {
  const normalized = normalizeText(value, 40).toUpperCase();
  if (MAINTENANCE_RECORD_CATEGORIES.includes(normalized as MaintenanceRecordCategory)) {
    return normalized as MaintenanceRecordCategory;
  }
  return "OTHER";
}

function normalizePriority(value: unknown) {
  const normalized = normalizeText(value, 20).toUpperCase();
  if (normalized === "LOW" || normalized === "NORMAL" || normalized === "HIGH" || normalized === "URGENT") {
    return normalized;
  }
  return "NORMAL";
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

function parseFiltersFromSearchParams(searchParams: URLSearchParams): ListMaintenanceFilters {
  const status = parseCsvList(searchParams.get("status"))
    .map((value) => normalizeStatus(value))
    .filter((value, index, arr) => arr.indexOf(value) === index);

  const category = parseCsvList(searchParams.get("category"))
    .map((value) => normalizeCategory(value))
    .filter((value, index, arr) => arr.indexOf(value) === index);

  const dueState = parseCsvList(searchParams.get("dueState"))
    .map((value) => normalizeDueState(value))
    .filter((value): value is MaintenanceDueState => Boolean(value))
    .filter((value, index, arr) => arr.indexOf(value) === index);

  return {
    status,
    category,
    dueState,
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
    vehicleId: row.vehicle_id,
    status: normalizeStatus(row.status),
    category: normalizeCategory(row.category),
    title: row.title,
    description: row.description,
    vendorName: row.vendor_name,
    vendorContact: row.vendor_contact,
    referenceNumber: row.reference_number,
    serviceDate: row.service_date,
    scheduledDate: row.scheduled_date,
    odometerKm: row.odometer_km,
    nextDueDate: row.next_due_date,
    nextDueOdometerKm: row.next_due_odometer_km,
    laborCostCents: row.labor_cost_cents,
    partsCostCents: row.parts_cost_cents,
    taxCostCents: row.tax_cost_cents,
    totalCostCents,
    currency: row.currency,
    priority: normalizePriority(row.priority),
    createdByUserId: row.created_by_user_id,
    completedByUserId: row.completed_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    dueState,
  };
}

const BASE_SELECT = `
  select
    r.id,
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
    r.odometer_km,
    r.next_due_date,
    r.next_due_odometer_km,
    r.labor_cost_cents,
    r.parts_cost_cents,
    r.tax_cost_cents,
    r.total_cost_cents,
    r.currency,
    r.priority,
    r.created_by_user_id,
    r.completed_by_user_id,
    r.created_at,
    r.updated_at,
    r.archived_at,
    p.odometer_value as current_odometer_km
  from vehicle_maintenance_records r
  left join vehicle_profiles p on p.vehicle_id = r.vehicle_id
`;

const DEFAULT_DEPS: VehicleMaintenanceRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getDueConfig: async () => {
    const { settings } = await loadAdminSettings();
    return {
      dueSoonDays: settings.maintenanceDueSoonDays,
      dueSoonKm: settings.maintenanceDueSoonKm,
    };
  },
  listRecords: async (vehicleId, filters) => {
    const values: Array<string | string[]> = [vehicleId];
    const where: string[] = ["r.vehicle_id = $1::uuid"];

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
      where.push(`coalesce(r.scheduled_date, r.service_date, r.next_due_date) <= $${values.length}::date`);
    }

    const result = await dbQuery<MaintenanceRecordRow>(
      `${BASE_SELECT}
       where ${where.join(" and ")}
       order by coalesce(r.next_due_date, r.scheduled_date, r.service_date) asc nulls last, r.created_at desc`,
      values,
    );
    return result.rows;
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
        odometer_km,
        next_due_date,
        next_due_odometer_km,
        labor_cost_cents,
        parts_cost_cents,
        tax_cost_cents,
        total_cost_cents,
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
        $11,
        $12::date,
        $13,
        $14,
        $15,
        $16,
        $17,
        'JMD',
        $18,
        $19::uuid,
        $20::uuid
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
        input.odometerKm,
        input.nextDueDate,
        input.nextDueOdometerKm,
        input.laborCostCents,
        input.partsCostCents,
        input.taxCostCents,
        input.totalCostCents,
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
  summarize: async (vehicleId) => summarizeVehicleMaintenance(vehicleId),
};

export async function handleVehicleMaintenanceGet(
  request: Request,
  context: RouteContext,
  deps: VehicleMaintenanceRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  const filters = parseFiltersFromSearchParams(new URL(request.url).searchParams);

  try {
    const dueConfig = deps.getDueConfig
      ? await deps.getDueConfig()
      : { dueSoonDays: 14, dueSoonKm: 500 };
    let rows = await deps.listRecords(id, filters);
    let items = rows.map((row) => mapRow(row, dueConfig));

    if (filters.dueState.length > 0) {
      const dueSet = new Set(filters.dueState);
      items = items.filter((item) => dueSet.has(item.dueState));
    }

    const summary = await deps.summarize(id);
    return NextResponse.json({ ok: true, items, summary });
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
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
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

  if (
    hasNegativeNumber(body?.laborCostCents ?? body?.labor_cost_cents) ||
    hasNegativeNumber(body?.partsCostCents ?? body?.parts_cost_cents) ||
    hasNegativeNumber(body?.taxCostCents ?? body?.tax_cost_cents) ||
    hasNegativeNumber(body?.odometerKm ?? body?.odometer_km) ||
    hasNegativeNumber(body?.nextDueOdometerKm ?? body?.next_due_odometer_km)
  ) {
    return NextResponse.json(
      { ok: false, error: "Negative values are not allowed." },
      { status: 400 },
    );
  }

  const input: CreateMaintenanceRecordInput = {
    status: normalizeStatus(body?.status),
    category: normalizeCategory(body?.category),
    title: normalizeText(body?.title, 180),
    description: normalizeNullableText(body?.description, 4000),
    vendorName: normalizeNullableText(body?.vendorName ?? body?.vendor_name, 180),
    vendorContact: normalizeNullableText(body?.vendorContact ?? body?.vendor_contact, 180),
    referenceNumber: normalizeNullableText(body?.referenceNumber ?? body?.reference_number, 120),
    serviceDate,
    scheduledDate,
    odometerKm: normalizeNonNegativeInt(body?.odometerKm ?? body?.odometer_km),
    nextDueDate: normalizeDate(body?.nextDueDate ?? body?.next_due_date),
    nextDueOdometerKm: normalizeNonNegativeInt(
      body?.nextDueOdometerKm ?? body?.next_due_odometer_km,
    ),
    laborCostCents,
    partsCostCents,
    taxCostCents,
    totalCostCents: computeMaintenanceRecordTotal({ laborCostCents, partsCostCents, taxCostCents }),
    priority: normalizePriority(body?.priority),
    completedByUserId: normalizeStatus(body?.status) === "COMPLETED" ? session.userId : null,
  };

  if (!input.title) {
    return NextResponse.json({ ok: false, error: "Title is required." }, { status: 400 });
  }

  try {
    const dueConfig = deps.getDueConfig
      ? await deps.getDueConfig()
      : { dueSoonDays: 14, dueSoonKm: 500 };
    const row = await deps.createRecord(id, input, session.userId);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, item: mapRow(row, dueConfig) });
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
