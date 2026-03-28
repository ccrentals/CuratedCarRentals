import { NextResponse } from "next/server";

import { loadAdminSettings } from "@/lib/adminSettings";
import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import {
  isMaintenanceCompleted,
  removeMaintenanceBlockoutByRecordId,
  syncMaintenanceBlockout,
  upsertMaintenanceBlockout,
} from "@/lib/vehicles/maintenanceBlockouts";
import {
  computeMaintenanceRecordTotal,
  getMaintenanceDueState,
  MAINTENANCE_RECORD_STATUSES,
  type MaintenanceRecordStatus,
} from "@/lib/vehicles/maintenance";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  params: Promise<{ id: string; recordId: string }>;
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

type MaintenanceStatusHistoryRow = {
  id: string;
  previous_status: string | null;
  next_status: string;
  note: string | null;
  changed_by_user_id: string | null;
  changed_by_email: string | null;
  changed_at: string;
};

type UpdateRecordInput = {
  status?: MaintenanceRecordStatus;
  category?: string;
  title?: string;
  description?: string | null;
  vendorName?: string | null;
  vendorContact?: string | null;
  referenceNumber?: string | null;
  serviceDate?: string | null;
  scheduledDate?: string | null;
  completedDate?: string | null;
  odometerKm?: number | null;
  nextDueDate?: string | null;
  nextDueOdometerKm?: number | null;
  reminderLeadDays?: number | null;
  laborCostCents?: number | null;
  partsCostCents?: number | null;
  taxCostCents?: number | null;
  estimatedCostCents?: number | null;
  actualCostCents?: number | null;
  linkedExpenseId?: string | null;
  linkedRepairOrderId?: string | null;
  priority?: string;
  archivedAt?: string | null;
};

type MaintenanceSettingsMeta = {
  categories: string[];
  priorities: string[];
};

export type VehicleMaintenanceRecordRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  resolveActorUserId?: (userId: string | null) => Promise<string | null>;
  getDueConfig?: () => Promise<{ dueSoonDays: number; dueSoonKm: number }>;
  getSettingsMeta?: () => Promise<MaintenanceSettingsMeta>;
  getRecord: (vehicleId: string, recordId: string) => Promise<MaintenanceRecordRow | null>;
  getStatusHistory?: (
    vehicleId: string,
    recordId: string,
  ) => Promise<MaintenanceStatusHistoryRow[]>;
  updateRecord: (
    vehicleId: string,
    recordId: string,
    patch: UpdateRecordInput,
    actorUserId: string | null,
  ) => Promise<MaintenanceRecordRow | null>;
  archiveRecord: (vehicleId: string, recordId: string) => Promise<boolean>;
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

function normalizeNonNegativeInt(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 ? rounded : null;
}

function hasNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed < 0;
}

function normalizeStatus(value: unknown): MaintenanceRecordStatus {
  const normalized = normalizeText(value, 40).toUpperCase();
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

function mapRow(
  row: MaintenanceRecordRow,
  dueConfig?: { dueSoonDays: number; dueSoonKm: number },
) {
  const computedTotal = computeMaintenanceRecordTotal(row);
  const persistedTotal = normalizeNonNegativeInt(row.total_cost_cents);
  const totalCostCents = persistedTotal ?? computedTotal;

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
    dueState: getMaintenanceDueState(row, new Date(), row.current_odometer_km, dueConfig),
  };
}

function mapStatusHistoryRow(row: MaintenanceStatusHistoryRow) {
  return {
    id: row.id,
    previousStatus: row.previous_status ? normalizeStatus(row.previous_status) : null,
    status: normalizeStatus(row.next_status),
    note: row.note,
    changedByUserId: row.changed_by_user_id,
    changedBy: row.changed_by_email ?? "system",
    createdAt: row.changed_at,
  };
}

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

const DEFAULT_DEPS: VehicleMaintenanceRecordRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
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
    };
  },
  getRecord: async (vehicleId, recordId) => {
    const result = await dbQuery<MaintenanceRecordRow>(
      `${BASE_SELECT} where r.vehicle_id = $1::uuid and r.id = $2::uuid limit 1`,
      [vehicleId, recordId],
    );
    return result.rows[0] ?? null;
  },
  getStatusHistory: async (vehicleId, recordId) => {
    try {
      const result = await dbQuery<MaintenanceStatusHistoryRow>(
        `select
           h.id,
           h.previous_status,
           h.next_status,
           h.note,
           h.changed_by_user_id,
           u.email as changed_by_email,
           h.changed_at
         from vehicle_maintenance_status_history h
         left join users u on u.id = h.changed_by_user_id
         where h.vehicle_id = $1::uuid and h.maintenance_record_id = $2::uuid
         order by h.changed_at desc, h.id desc`,
        [vehicleId, recordId],
      );
      return result.rows;
    } catch (error) {
      if (isVehicleExtensionsMissingTableError(error)) {
        return [];
      }
      throw error;
    }
  },
  updateRecord: async (vehicleId, recordId, patch, actorUserId) => {
    const currentResult = await dbQuery<MaintenanceRecordRow>(
      `${BASE_SELECT} where r.vehicle_id = $1::uuid and r.id = $2::uuid limit 1`,
      [vehicleId, recordId],
    );
    const current = currentResult.rows[0];
    if (!current) return null;

    const nextStatus = patch.status ?? normalizeStatus(current.status);
    const nextCategory = patch.category ?? normalizeText(current.category, 40).toUpperCase();
    const nextTitle = patch.title ?? current.title;
    const nextDescription = patch.description === undefined ? current.description : patch.description;
    const nextVendorName = patch.vendorName === undefined ? current.vendor_name : patch.vendorName;
    const nextVendorContact =
      patch.vendorContact === undefined ? current.vendor_contact : patch.vendorContact;
    const nextReferenceNumber =
      patch.referenceNumber === undefined ? current.reference_number : patch.referenceNumber;
    const nextServiceDate = patch.serviceDate === undefined ? current.service_date : patch.serviceDate;
    const nextScheduledDate =
      patch.scheduledDate === undefined ? current.scheduled_date : patch.scheduledDate;
    const nextCompletedDate =
      patch.completedDate === undefined
        ? current.completed_date
        : patch.completedDate ??
          (nextStatus === "COMPLETED"
            ? nextServiceDate ?? nextScheduledDate ?? new Date().toISOString().slice(0, 10)
            : null);
    const nextOdometerKm = patch.odometerKm === undefined ? current.odometer_km : patch.odometerKm;
    const nextDueDate = patch.nextDueDate === undefined ? current.next_due_date : patch.nextDueDate;
    const nextDueOdometerKm =
      patch.nextDueOdometerKm === undefined
        ? current.next_due_odometer_km
        : patch.nextDueOdometerKm;
    const nextReminderLeadDays =
      patch.reminderLeadDays === undefined ? current.reminder_lead_days : patch.reminderLeadDays;
    const nextLabor = patch.laborCostCents === undefined ? current.labor_cost_cents : patch.laborCostCents;
    const nextParts = patch.partsCostCents === undefined ? current.parts_cost_cents : patch.partsCostCents;
    const nextTax = patch.taxCostCents === undefined ? current.tax_cost_cents : patch.taxCostCents;
    const nextEstimated =
      patch.estimatedCostCents === undefined
        ? current.estimated_cost_cents
        : patch.estimatedCostCents;
    const nextActual =
      patch.actualCostCents === undefined ? current.actual_cost_cents : patch.actualCostCents;
    const nextPriority = patch.priority ?? normalizeText(current.priority, 20).toUpperCase();
    const nextLinkedExpenseId =
      patch.linkedExpenseId === undefined ? current.linked_expense_id : patch.linkedExpenseId;
    const nextLinkedRepairOrderId =
      patch.linkedRepairOrderId === undefined
        ? current.linked_repair_order_id
        : patch.linkedRepairOrderId;

    const totalCostCents = computeMaintenanceRecordTotal({
      laborCostCents: nextLabor,
      partsCostCents: nextParts,
      taxCostCents: nextTax,
    });

    const completedByUserId = nextStatus === "COMPLETED" ? actorUserId : null;

    await dbQuery(
      `update vehicle_maintenance_records
       set status = $3,
           category = $4,
           title = $5,
           description = $6,
           vendor_name = $7,
           vendor_contact = $8,
           reference_number = $9,
           service_date = $10::date,
           scheduled_date = $11::date,
           completed_date = $12::date,
           odometer_km = $13,
           next_due_date = $14::date,
           next_due_odometer_km = $15,
           reminder_lead_days = $16,
           labor_cost_cents = $17,
           parts_cost_cents = $18,
           tax_cost_cents = $19,
           estimated_cost_cents = $20,
           actual_cost_cents = $21,
           total_cost_cents = $22,
           linked_expense_id = $23::uuid,
           linked_repair_order_id = $24::uuid,
           priority = $25,
           completed_by_user_id = $26::uuid,
           archived_at = coalesce($27::timestamptz, archived_at),
           updated_at = now()
       where vehicle_id = $1::uuid and id = $2::uuid`,
      [
        vehicleId,
        recordId,
        nextStatus,
        nextCategory,
        nextTitle,
        nextDescription,
        nextVendorName,
        nextVendorContact,
        nextReferenceNumber,
        nextServiceDate,
        nextScheduledDate,
        nextCompletedDate,
        nextOdometerKm,
        nextDueDate,
        nextDueOdometerKm,
        nextReminderLeadDays,
        nextLabor,
        nextParts,
        nextTax,
        nextEstimated,
        nextActual,
        totalCostCents,
        nextLinkedExpenseId,
        nextLinkedRepairOrderId,
        nextPriority,
        completedByUserId,
        patch.archivedAt ?? null,
      ],
    );

    const nextResult = await dbQuery<MaintenanceRecordRow>(
      `${BASE_SELECT} where r.vehicle_id = $1::uuid and r.id = $2::uuid limit 1`,
      [vehicleId, recordId],
    );
    return nextResult.rows[0] ?? null;
  },
  archiveRecord: async (vehicleId, recordId) => {
    const result = await dbQuery<{ id: string }>(
      "update vehicle_maintenance_records set archived_at = now(), updated_at = now() where vehicle_id = $1::uuid and id = $2::uuid and archived_at is null returning id",
      [vehicleId, recordId],
    );
    return result.rowCount > 0;
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
};

async function resolveSettingsMeta(
  deps: VehicleMaintenanceRecordRouteDeps,
): Promise<MaintenanceSettingsMeta> {
  if (deps.getSettingsMeta) return deps.getSettingsMeta();
  return {
    categories: [...DEFAULT_MAINTENANCE_CATEGORIES],
    priorities: [...DEFAULT_MAINTENANCE_PRIORITIES],
  };
}

export async function handleVehicleMaintenanceRecordGet(
  _request: Request,
  context: RouteContext,
  deps: VehicleMaintenanceRecordRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { id, recordId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(recordId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const dueConfig = deps.getDueConfig
      ? await deps.getDueConfig()
      : { dueSoonDays: 14, dueSoonKm: 500 };
    const [row, statusHistoryRows] = await Promise.all([
      deps.getRecord(id, recordId),
      deps.getStatusHistory ? deps.getStatusHistory(id, recordId) : Promise.resolve([]),
    ]);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Maintenance record not found." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      item: mapRow(row, dueConfig),
      statusHistory: statusHistoryRows.map(mapStatusHistoryRow),
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to load maintenance record." }, { status: 500 });
  }
}

export async function handleVehicleMaintenanceRecordPatch(
  request: Request,
  context: RouteContext,
  deps: VehicleMaintenanceRecordRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id, recordId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(recordId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const current = await deps.getRecord(id, recordId);
  if (!current) {
    return NextResponse.json({ ok: false, error: "Maintenance record not found." }, { status: 404 });
  }

  const settingsMeta = await resolveSettingsMeta(deps);

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

  const patch: UpdateRecordInput = {};

  if (body && "status" in body) patch.status = normalizeStatus(body.status);
  if (body && "category" in body) {
    patch.category = normalizeConfiguredCategory(body.category, settingsMeta.categories);
  }
  if (body && "title" in body) patch.title = normalizeText(body.title, 180);
  if (body && "description" in body) patch.description = normalizeNullableText(body.description, 4000);
  if (body && ("vendorName" in body || "vendor_name" in body)) {
    patch.vendorName = normalizeNullableText(body.vendorName ?? body.vendor_name, 180);
  }
  if (body && ("vendorContact" in body || "vendor_contact" in body)) {
    patch.vendorContact = normalizeNullableText(body.vendorContact ?? body.vendor_contact, 180);
  }
  if (body && ("referenceNumber" in body || "reference_number" in body)) {
    patch.referenceNumber = normalizeNullableText(body.referenceNumber ?? body.reference_number, 120);
  }
  if (body && ("serviceDate" in body || "service_date" in body)) {
    patch.serviceDate = normalizeDate(body.serviceDate ?? body.service_date);
  }
  if (body && ("scheduledDate" in body || "scheduled_date" in body)) {
    patch.scheduledDate = normalizeDate(body.scheduledDate ?? body.scheduled_date);
  }
  if (body && ("completedDate" in body || "completed_date" in body)) {
    patch.completedDate = normalizeDate(body.completedDate ?? body.completed_date);
  }
  if (body && ("odometerKm" in body || "odometer_km" in body)) {
    patch.odometerKm = normalizeNonNegativeInt(body.odometerKm ?? body.odometer_km);
  }
  if (body && ("nextDueDate" in body || "next_due_date" in body)) {
    patch.nextDueDate = normalizeDate(body.nextDueDate ?? body.next_due_date);
  }
  if (body && ("nextDueOdometerKm" in body || "next_due_odometer_km" in body)) {
    patch.nextDueOdometerKm = normalizeNonNegativeInt(
      body.nextDueOdometerKm ?? body.next_due_odometer_km,
    );
  }
  if (body && ("reminderLeadDays" in body || "reminder_lead_days" in body)) {
    patch.reminderLeadDays = normalizeNonNegativeInt(body.reminderLeadDays ?? body.reminder_lead_days);
  }
  if (body && ("laborCostCents" in body || "labor_cost_cents" in body)) {
    patch.laborCostCents = normalizeNonNegativeInt(body.laborCostCents ?? body.labor_cost_cents);
  }
  if (body && ("partsCostCents" in body || "parts_cost_cents" in body)) {
    patch.partsCostCents = normalizeNonNegativeInt(body.partsCostCents ?? body.parts_cost_cents);
  }
  if (body && ("taxCostCents" in body || "tax_cost_cents" in body)) {
    patch.taxCostCents = normalizeNonNegativeInt(body.taxCostCents ?? body.tax_cost_cents);
  }
  if (body && ("estimatedCostCents" in body || "estimated_cost_cents" in body)) {
    patch.estimatedCostCents = normalizeNonNegativeInt(
      body.estimatedCostCents ?? body.estimated_cost_cents,
    );
  }
  if (body && ("actualCostCents" in body || "actual_cost_cents" in body)) {
    patch.actualCostCents = normalizeNonNegativeInt(body.actualCostCents ?? body.actual_cost_cents);
  }
  if (body && ("linkedExpenseId" in body || "linked_expense_id" in body)) {
    const linkedExpenseInput = parseOptionalUuidField(body, "linkedExpenseId", "linked_expense_id");
    if (linkedExpenseInput.invalid) {
      return NextResponse.json(
        { ok: false, error: "Linked expense ID must be a valid UUID." },
        { status: 400 },
      );
    }
    patch.linkedExpenseId = linkedExpenseInput.value;
  }
  if (body && ("linkedRepairOrderId" in body || "linked_repair_order_id" in body)) {
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
    patch.linkedRepairOrderId = linkedRepairOrderInput.value;
  }
  if (body && "priority" in body) {
    patch.priority = normalizeConfiguredPriority(body.priority, settingsMeta.priorities);
  }
  if (body && "archivedAt" in body) patch.archivedAt = normalizeDate(body.archivedAt);

  if (patch.title !== undefined && !patch.title) {
    return NextResponse.json({ ok: false, error: "Title is required." }, { status: 400 });
  }

  if (patch.serviceDate === null && patch.scheduledDate === null) {
    return NextResponse.json(
      { ok: false, error: "Cannot clear both scheduled date and service date." },
      { status: 400 },
    );
  }

  const previousStatus = normalizeStatus(current.status);
  const nextStatus = patch.status ?? previousStatus;
  const previouslyCompleted = isMaintenanceCompleted({
    status: current.status,
    completed_date: current.completed_date,
  });
  if (nextStatus === "COMPLETED" && patch.completedDate === undefined) {
    patch.completedDate =
      patch.serviceDate ?? current.service_date ?? patch.scheduledDate ?? current.scheduled_date ??
      new Date().toISOString().slice(0, 10);
  }

  const createBlockout = normalizeBoolean(body?.createBlockout ?? body?.create_blockout);
  const removeBlockout = normalizeBoolean(body?.removeBlockout ?? body?.remove_blockout);
  const blockoutStartAt = normalizeNullableText(body?.blockoutStartAt ?? body?.blockout_start_at, 40);
  const blockoutEndAt = normalizeNullableText(body?.blockoutEndAt ?? body?.blockout_end_at, 40);
  const blockoutReason = normalizeNullableText(body?.blockoutReason ?? body?.blockout_reason, 140);
  const blockoutNotes = normalizeNullableText(body?.blockoutNotes ?? body?.blockout_notes, 4000);
  const actorUserId = deps.resolveActorUserId
    ? await deps.resolveActorUserId(session.userId)
    : session.userId;

  try {
    const row = await deps.updateRecord(id, recordId, patch, actorUserId);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Maintenance record not found." }, { status: 404 });
    }

    if (deps.appendStatusHistory && previousStatus !== nextStatus) {
      await deps.appendStatusHistory({
        maintenanceRecordId: recordId,
        vehicleId: id,
        previousStatus,
        nextStatus,
        changedByUserId: actorUserId,
        note: "Status updated",
      });
    }

    const completedNow = isMaintenanceCompleted({
      status: row.status,
      completed_date: row.completed_date,
    });
    const reopened = previouslyCompleted && !completedNow;
    const hasLinkedBlockout = Boolean(current.linked_blockout_id || row.linked_blockout_id);

    if ((removeBlockout || nextStatus === "CANCELLED") && deps.removeLinkedBlockout) {
      await deps.removeLinkedBlockout(recordId, id);
    } else if (deps.syncLinkedBlockout) {
      await deps.syncLinkedBlockout({
        vehicleId: id,
        maintenanceRecordId: recordId,
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
        ensureWhenOpen: createBlockout || reopened || hasLinkedBlockout,
      });
    } else if (createBlockout && deps.createOrUpdateLinkedBlockout) {
      await deps.createOrUpdateLinkedBlockout({
        vehicleId: id,
        maintenanceRecordId: recordId,
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

    const dueConfig = deps.getDueConfig
      ? await deps.getDueConfig()
      : { dueSoonDays: 14, dueSoonKm: 500 };
    const refreshed = await deps.getRecord(id, recordId);
    return NextResponse.json({ ok: true, item: mapRow(refreshed ?? row, dueConfig) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to update maintenance record." }, { status: 500 });
  }
}

export async function handleVehicleMaintenanceRecordDelete(
  request: Request,
  context: RouteContext,
  deps: VehicleMaintenanceRecordRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id, recordId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(recordId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const archived = await deps.archiveRecord(id, recordId);
    if (!archived) {
      return NextResponse.json({ ok: false, error: "Maintenance record not found." }, { status: 404 });
    }
    if (deps.removeLinkedBlockout) {
      await deps.removeLinkedBlockout(recordId, id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to archive maintenance record." }, { status: 500 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceRecordGet(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceRecordPatch(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceRecordDelete(request, context);
}
