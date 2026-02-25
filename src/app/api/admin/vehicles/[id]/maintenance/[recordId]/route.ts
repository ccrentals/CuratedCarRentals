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
  type MaintenanceRecordCategory,
  type MaintenanceRecordStatus,
} from "@/lib/vehicles/maintenance";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string; recordId: string }>;
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

type UpdateRecordInput = {
  status?: MaintenanceRecordStatus;
  category?: MaintenanceRecordCategory;
  title?: string;
  description?: string | null;
  vendorName?: string | null;
  vendorContact?: string | null;
  referenceNumber?: string | null;
  serviceDate?: string | null;
  scheduledDate?: string | null;
  odometerKm?: number | null;
  nextDueDate?: string | null;
  nextDueOdometerKm?: number | null;
  laborCostCents?: number | null;
  partsCostCents?: number | null;
  taxCostCents?: number | null;
  priority?: string;
  archivedAt?: string | null;
};

export type VehicleMaintenanceRecordRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getDueConfig?: () => Promise<{ dueSoonDays: number; dueSoonKm: number }>;
  getRecord: (vehicleId: string, recordId: string) => Promise<MaintenanceRecordRow | null>;
  updateRecord: (
    vehicleId: string,
    recordId: string,
    patch: UpdateRecordInput,
    actorUserId: string,
  ) => Promise<MaintenanceRecordRow | null>;
  archiveRecord: (vehicleId: string, recordId: string) => Promise<boolean>;
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

function mapRow(
  row: MaintenanceRecordRow,
  dueConfig?: { dueSoonDays: number; dueSoonKm: number },
) {
  const computedTotal = computeMaintenanceRecordTotal(row);
  const persistedTotal = normalizeNonNegativeInt(row.total_cost_cents);
  const totalCostCents = persistedTotal ?? computedTotal;

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
    dueState: getMaintenanceDueState(row, new Date(), row.current_odometer_km, dueConfig),
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

const DEFAULT_DEPS: VehicleMaintenanceRecordRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getDueConfig: async () => {
    const { settings } = await loadAdminSettings();
    return {
      dueSoonDays: settings.maintenanceDueSoonDays,
      dueSoonKm: settings.maintenanceDueSoonKm,
    };
  },
  getRecord: async (vehicleId, recordId) => {
    const result = await dbQuery<MaintenanceRecordRow>(
      `${BASE_SELECT} where r.vehicle_id = $1::uuid and r.id = $2::uuid limit 1`,
      [vehicleId, recordId],
    );
    return result.rows[0] ?? null;
  },
  updateRecord: async (vehicleId, recordId, patch, actorUserId) => {
    const currentResult = await dbQuery<MaintenanceRecordRow>(
      `${BASE_SELECT} where r.vehicle_id = $1::uuid and r.id = $2::uuid limit 1`,
      [vehicleId, recordId],
    );
    const current = currentResult.rows[0];
    if (!current) return null;

    const nextStatus = patch.status ?? normalizeStatus(current.status);
    const nextCategory = patch.category ?? normalizeCategory(current.category);
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
    const nextOdometerKm = patch.odometerKm === undefined ? current.odometer_km : patch.odometerKm;
    const nextDueDate = patch.nextDueDate === undefined ? current.next_due_date : patch.nextDueDate;
    const nextDueOdometerKm =
      patch.nextDueOdometerKm === undefined
        ? current.next_due_odometer_km
        : patch.nextDueOdometerKm;
    const nextLabor = patch.laborCostCents === undefined ? current.labor_cost_cents : patch.laborCostCents;
    const nextParts = patch.partsCostCents === undefined ? current.parts_cost_cents : patch.partsCostCents;
    const nextTax = patch.taxCostCents === undefined ? current.tax_cost_cents : patch.taxCostCents;
    const nextPriority = patch.priority ?? normalizePriority(current.priority);
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
           odometer_km = $12,
           next_due_date = $13::date,
           next_due_odometer_km = $14,
           labor_cost_cents = $15,
           parts_cost_cents = $16,
           tax_cost_cents = $17,
           total_cost_cents = $18,
           priority = $19,
           completed_by_user_id = $20::uuid,
           archived_at = coalesce($21::timestamptz, archived_at),
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
        nextOdometerKm,
        nextDueDate,
        nextDueOdometerKm,
        nextLabor,
        nextParts,
        nextTax,
        totalCostCents,
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
};

export async function handleVehicleMaintenanceRecordGet(
  _request: Request,
  context: RouteContext,
  deps: VehicleMaintenanceRecordRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const { id, recordId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(recordId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const dueConfig = deps.getDueConfig
      ? await deps.getDueConfig()
      : { dueSoonDays: 14, dueSoonKm: 500 };
    const row = await deps.getRecord(id, recordId);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Maintenance record not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item: mapRow(row, dueConfig) });
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

function normalizePatch(body: Record<string, unknown> | null): UpdateRecordInput {
  const next: UpdateRecordInput = {};

  if (body && "status" in body) next.status = normalizeStatus(body.status);
  if (body && "category" in body) next.category = normalizeCategory(body.category);
  if (body && "title" in body) next.title = normalizeText(body.title, 180);
  if (body && "description" in body) next.description = normalizeNullableText(body.description, 4000);
  if (body && ("vendorName" in body || "vendor_name" in body)) {
    next.vendorName = normalizeNullableText(body.vendorName ?? body.vendor_name, 180);
  }
  if (body && ("vendorContact" in body || "vendor_contact" in body)) {
    next.vendorContact = normalizeNullableText(body.vendorContact ?? body.vendor_contact, 180);
  }
  if (body && ("referenceNumber" in body || "reference_number" in body)) {
    next.referenceNumber = normalizeNullableText(body.referenceNumber ?? body.reference_number, 120);
  }
  if (body && ("serviceDate" in body || "service_date" in body)) {
    next.serviceDate = normalizeDate(body.serviceDate ?? body.service_date);
  }
  if (body && ("scheduledDate" in body || "scheduled_date" in body)) {
    next.scheduledDate = normalizeDate(body.scheduledDate ?? body.scheduled_date);
  }
  if (body && ("odometerKm" in body || "odometer_km" in body)) {
    next.odometerKm = normalizeNonNegativeInt(body.odometerKm ?? body.odometer_km);
  }
  if (body && ("nextDueDate" in body || "next_due_date" in body)) {
    next.nextDueDate = normalizeDate(body.nextDueDate ?? body.next_due_date);
  }
  if (body && ("nextDueOdometerKm" in body || "next_due_odometer_km" in body)) {
    next.nextDueOdometerKm = normalizeNonNegativeInt(
      body.nextDueOdometerKm ?? body.next_due_odometer_km,
    );
  }
  if (body && ("laborCostCents" in body || "labor_cost_cents" in body)) {
    next.laborCostCents = normalizeNonNegativeInt(body.laborCostCents ?? body.labor_cost_cents);
  }
  if (body && ("partsCostCents" in body || "parts_cost_cents" in body)) {
    next.partsCostCents = normalizeNonNegativeInt(body.partsCostCents ?? body.parts_cost_cents);
  }
  if (body && ("taxCostCents" in body || "tax_cost_cents" in body)) {
    next.taxCostCents = normalizeNonNegativeInt(body.taxCostCents ?? body.tax_cost_cents);
  }
  if (body && "priority" in body) next.priority = normalizePriority(body.priority);
  if (body && "archivedAt" in body) next.archivedAt = normalizeDate(body.archivedAt);

  return next;
}

export async function handleVehicleMaintenanceRecordPatch(
  request: Request,
  context: RouteContext,
  deps: VehicleMaintenanceRecordRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
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

  const patch = normalizePatch(body);

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

  if (patch.title !== undefined && !patch.title) {
    return NextResponse.json({ ok: false, error: "Title is required." }, { status: 400 });
  }

  if (patch.serviceDate === null && patch.scheduledDate === null) {
    return NextResponse.json(
      { ok: false, error: "Cannot clear both scheduled date and service date." },
      { status: 400 },
    );
  }

  try {
    const dueConfig = deps.getDueConfig
      ? await deps.getDueConfig()
      : { dueSoonDays: 14, dueSoonKm: 500 };
    const row = await deps.updateRecord(id, recordId, patch, session.userId);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Maintenance record not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item: mapRow(row, dueConfig) });
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
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
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

  try {
    const archived = await deps.archiveRecord(id, recordId);
    if (!archived) {
      return NextResponse.json({ ok: false, error: "Maintenance record not found." }, { status: 404 });
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
