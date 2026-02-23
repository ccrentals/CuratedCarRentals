import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { computeNextDue } from "@/lib/maintenance/due";
import {
  normalizeNullableDate,
  normalizeNullableNonNegativeInt,
  normalizeNullableText,
} from "@/lib/maintenance/normalize";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type LogAttachment = {
  linkId: string;
  documentId: string;
  title: string;
  folder: string;
  documentType: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

type LogRow = {
  id: string;
  vehicle_id: string;
  service_type_id: string;
  service_type_name: string;
  service_date: string;
  odometer_value: number | null;
  cost_cents: number | null;
  vendor: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
  attachments: unknown;
};

type LogPayload = {
  serviceTypeId: string;
  serviceDate: string;
  odometerValue: number | null;
  costCents: number | null;
  vendor: string | null;
  notes: string | null;
  scheduleId: string | null;
};

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  listLogs: (vehicleId: string) => Promise<LogRow[]>;
  createLog: (vehicleId: string, payload: LogPayload, userId: string | null) => Promise<LogRow | null>;
};

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

function mapAttachments(value: unknown): LogAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const linkId = String(item.linkId ?? "").trim();
      const documentId = String(item.documentId ?? "").trim();
      if (!UUID_REGEX.test(linkId) || !UUID_REGEX.test(documentId)) return null;
      return {
        linkId,
        documentId,
        title: String(item.title ?? "Document"),
        folder: String(item.folder ?? "Unsorted"),
        documentType: item.documentType ? String(item.documentType) : null,
        mimeType: item.mimeType ? String(item.mimeType) : null,
        sizeBytes:
          typeof item.sizeBytes === "number" && Number.isFinite(item.sizeBytes)
            ? Math.round(item.sizeBytes)
            : null,
        createdAt: String(item.createdAt ?? ""),
      } satisfies LogAttachment;
    })
    .filter((item): item is LogAttachment => Boolean(item));
}

function mapLog(row: LogRow) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    serviceTypeId: row.service_type_id,
    serviceTypeName: row.service_type_name,
    serviceDate: row.service_date,
    odometerValue: row.odometer_value,
    costCents: row.cost_cents,
    vendor: row.vendor,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    attachments: mapAttachments(row.attachments),
  };
}

function normalizePayload(body: Record<string, unknown> | null): LogPayload {
  const serviceDate = normalizeNullableDate(body?.serviceDate ?? body?.service_date) ?? "";
  const scheduleIdRaw = String(body?.scheduleId ?? body?.schedule_id ?? "").trim();
  return {
    serviceTypeId: String(body?.serviceTypeId ?? body?.service_type_id ?? "").trim(),
    serviceDate,
    odometerValue: normalizeNullableNonNegativeInt(body?.odometerValue ?? body?.odometer_value),
    costCents: normalizeNullableNonNegativeInt(body?.costCents ?? body?.cost_cents),
    vendor: normalizeNullableText(body?.vendor, 180),
    notes: normalizeNullableText(body?.notes, 4000),
    scheduleId: UUID_REGEX.test(scheduleIdRaw) ? scheduleIdRaw : null,
  };
}

const BASE_SELECT = `
  select
    l.id,
    l.vehicle_id,
    l.service_type_id,
    coalesce(mst.name, l.service_type, 'General') as service_type_name,
    l.service_date,
    l.odometer_value,
    l.cost_cents,
    l.vendor,
    l.notes,
    l.created_by_user_id,
    l.created_at,
    coalesce(
      json_agg(
        json_build_object(
          'linkId', vdl.id,
          'documentId', vd.id,
          'title', vd.title,
          'folder', vd.folder,
          'documentType', vd.document_type,
          'mimeType', vd.mime_type,
          'sizeBytes', vd.size_bytes,
          'createdAt', vd.created_at
        )
        order by vd.created_at desc
      ) filter (where vdl.id is not null and vd.id is not null),
      '[]'::json
    ) as attachments
  from vehicle_maintenance_logs l
  left join maintenance_service_types mst on mst.id = l.service_type_id
  left join vehicle_document_links vdl on vdl.entity_type = 'MAINTENANCE_LOG' and vdl.entity_id = l.id
  left join vehicle_documents vd on vd.id = vdl.vehicle_document_id and vd.vehicle_id = l.vehicle_id
`;

const GROUP_BY = `
  group by
    l.id,
    l.vehicle_id,
    l.service_type_id,
    mst.name,
    l.service_type,
    l.service_date,
    l.odometer_value,
    l.cost_cents,
    l.vendor,
    l.notes,
    l.created_by_user_id,
    l.created_at
`;

const DEFAULT_DEPS: RouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  listLogs: async (vehicleId) => {
    const result = await dbQuery<LogRow>(
      `${BASE_SELECT}
       where l.vehicle_id = $1::uuid
       ${GROUP_BY}
       order by l.service_date desc, l.created_at desc`,
      [vehicleId],
    );
    return result.rows;
  },
  createLog: async (vehicleId, payload, userId) => {
    const insert = await dbQuery<{
      id: string;
      vehicle_id: string;
      service_type_id: string;
      service_date: string;
      odometer_value: number | null;
      cost_cents: number | null;
      vendor: string | null;
      notes: string | null;
      created_by_user_id: string | null;
      created_at: string;
    }>(
      `insert into vehicle_maintenance_logs (vehicle_id, service_type_id, service_date, service_type, odometer_value, cost_cents, vendor, notes, created_by_user_id)
       select $1::uuid, mst.id, $3::date, mst.name, $4, $5, $6, $7, $8::uuid
       from maintenance_service_types mst
       where mst.id = $2::uuid
       returning id, vehicle_id, service_type_id, service_date, odometer_value, cost_cents, vendor, notes, created_by_user_id, created_at`,
      [
        vehicleId,
        payload.serviceTypeId,
        payload.serviceDate,
        payload.odometerValue,
        payload.costCents,
        payload.vendor,
        payload.notes,
        userId,
      ],
    );

    const created = insert.rows[0];
    if (!created) return null;

    if (payload.scheduleId) {
      const scheduleResult = await dbQuery<{
        interval_days: number | null;
        interval_odometer: number | null;
      }>(
        "select interval_days, interval_odometer from vehicle_maintenance_schedules where id = $1::uuid and vehicle_id = $2::uuid and service_type_id = $3::uuid limit 1",
        [payload.scheduleId, vehicleId, payload.serviceTypeId],
      );
      const schedule = scheduleResult.rows[0];
      if (schedule) {
        const due = computeNextDue({
          intervalDays: schedule.interval_days,
          intervalOdometer: schedule.interval_odometer,
          lastServiceDate: payload.serviceDate,
          lastServiceOdometer: payload.odometerValue,
        });
        await dbQuery(
          "update vehicle_maintenance_schedules set last_service_date = $4::date, last_service_odometer = $5, next_due_date = $6::date, next_due_odometer = $7, updated_at = now(), status = case when status = 'COMPLETED' then 'ACTIVE' else status end where id = $1::uuid and vehicle_id = $2::uuid and service_type_id = $3::uuid",
          [
            payload.scheduleId,
            vehicleId,
            payload.serviceTypeId,
            payload.serviceDate,
            payload.odometerValue,
            due.nextDueDate,
            due.nextDueOdometer,
          ],
        );
      }
    }

    const full = await dbQuery<LogRow>(
      `${BASE_SELECT}
       where l.id = $1::uuid and l.vehicle_id = $2::uuid
       ${GROUP_BY}
       limit 1`,
      [created.id, vehicleId],
    );

    return full.rows[0] ?? null;
  },
};

export async function handleVehicleMaintenanceLogsGet(
  _request: Request,
  context: RouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  try {
    const rows = await deps.listLogs(id);
    return NextResponse.json({ ok: true, items: rows.map(mapLog) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to load maintenance logs." }, { status: 500 });
  }
}

export async function handleVehicleMaintenanceLogsPost(
  request: Request,
  context: RouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id." }, { status: 400 });
  }

  const payload = normalizePayload(body);
  if (!UUID_REGEX.test(payload.serviceTypeId)) {
    return NextResponse.json({ ok: false, error: "Service type is required." }, { status: 400 });
  }
  if (!payload.serviceDate) {
    return NextResponse.json({ ok: false, error: "Service date is required." }, { status: 400 });
  }

  try {
    const created = await deps.createLog(id, payload, session.userId);
    if (!created) {
      return NextResponse.json(
        { ok: false, error: "Invalid vehicle or service type." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, item: mapLog(created) });
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code ?? "");
    if (code === "23503") {
      return NextResponse.json(
        { ok: false, error: "Vehicle or service type not found." },
        { status: 404 },
      );
    }
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to create maintenance log." }, { status: 500 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceLogsGet(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceLogsPost(request, context);
}
