import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VehicleDocumentRouteContext = {
  params: Promise<{ id: string; docId: string }>;
};

type VehicleDocumentRow = {
  id: string;
  vehicle_id: string;
  maintenance_record_id: string | null;
  folder: string;
  document_type: string;
  title: string;
  label: string | null;
  storage_provider: string;
  mime_type: string | null;
  size_bytes: number | null;
  file_size_bytes: number | null;
  tags: unknown[] | null;
  uploaded_by_user_id: string | null;
  created_at: string;
  archived_at: string | null;
};

type DocumentPatchInput = {
  documentType?: string;
  label?: string | null;
  maintenanceRecordId?: string | null;
  archived?: boolean;
};

export type AdminVehicleDocumentRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  patchDocument: (
    vehicleId: string,
    docId: string,
    input: DocumentPatchInput,
  ) => Promise<VehicleDocumentRow | null>;
  archiveDocument: (vehicleId: string, docId: string) => Promise<boolean>;
};

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

function normalizeText(value: unknown, max = 255) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function normalizeNullableText(value: unknown, max = 255) {
  const normalized = normalizeText(value, max);
  return normalized ? normalized : null;
}

function normalizeRecordId(value: unknown) {
  const text = normalizeText(value, 80);
  if (!text) return null;
  return UUID_REGEX.test(text) ? text : null;
}

function mapDocument(row: VehicleDocumentRow) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    maintenanceRecordId: row.maintenance_record_id,
    folder: row.folder,
    documentType: row.document_type,
    title: row.title,
    label: row.label,
    storageProvider: row.storage_provider,
    mimeType: row.mime_type,
    sizeBytes: row.file_size_bytes ?? row.size_bytes,
    tags: row.tags ?? [],
    uploadedByUserId: row.uploaded_by_user_id,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}

const RETURNING_SQL =
  "returning id, vehicle_id, maintenance_record_id, folder, document_type, title, label, storage_provider, mime_type, size_bytes, file_size_bytes, tags, uploaded_by_user_id, created_at, archived_at";

const DEFAULT_DEPS: AdminVehicleDocumentRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  patchDocument: async (vehicleId, docId, input) => {
    if (input.maintenanceRecordId) {
      const maintenance = await dbQuery<{ id: string }>(
        "select id from vehicle_maintenance_records where id = $1::uuid and vehicle_id = $2::uuid limit 1",
        [input.maintenanceRecordId, vehicleId],
      );
      if (maintenance.rowCount < 1) {
        throw new Error("MAINTENANCE_RECORD_NOT_FOUND");
      }
    }

    const update = await dbQuery<VehicleDocumentRow>(
      `update vehicle_documents
       set document_type = coalesce($3, document_type),
           label = case when $4::boolean then $5 else label end,
           maintenance_record_id = case when $6::boolean then $7::uuid else maintenance_record_id end,
           archived_at = case
             when $8::boolean then
               case when $9::boolean then now() else null end
             else archived_at
           end
       where id = $1::uuid
         and vehicle_id = $2::uuid
       ${RETURNING_SQL}`,
      [
        docId,
        vehicleId,
        input.documentType ?? null,
        input.label !== undefined,
        input.label ?? null,
        input.maintenanceRecordId !== undefined,
        input.maintenanceRecordId ?? null,
        input.archived !== undefined,
        input.archived === true,
      ],
    );

    return update.rows[0] ?? null;
  },
  archiveDocument: async (vehicleId, docId) => {
    const result = await dbQuery<{ id: string }>(
      "update vehicle_documents set archived_at = now() where id = $1::uuid and vehicle_id = $2::uuid and archived_at is null returning id",
      [docId, vehicleId],
    );
    return result.rowCount > 0;
  },
};

export async function handleAdminVehicleDocumentPatch(
  request: Request,
  context: VehicleDocumentRouteContext,
  deps: AdminVehicleDocumentRouteDeps = DEFAULT_DEPS,
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

  const { id, docId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(docId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const documentType =
    body && ("documentType" in body || "document_type" in body)
      ? normalizeText(body.documentType ?? body.document_type, 80)
      : undefined;
  const label = body && "label" in body ? normalizeNullableText(body.label, 140) : undefined;
  const maintenanceRecordId =
    body && ("maintenanceRecordId" in body || "maintenance_record_id" in body)
      ? normalizeRecordId(body.maintenanceRecordId ?? body.maintenance_record_id)
      : undefined;
  const archived = body && "archived" in body ? Boolean(body.archived) : undefined;

  if (documentType !== undefined && !documentType) {
    return NextResponse.json({ ok: false, error: "Document type is required." }, { status: 400 });
  }

  try {
    const row = await deps.patchDocument(id, docId, {
      documentType,
      label,
      maintenanceRecordId,
      archived,
    });

    if (!row) {
      return NextResponse.json({ ok: false, error: "Document not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, item: mapDocument(row) });
  } catch (error) {
    const message = String((error as Error | null)?.message ?? "");
    if (message === "MAINTENANCE_RECORD_NOT_FOUND") {
      return NextResponse.json(
        { ok: false, error: "Maintenance record not found for this vehicle." },
        { status: 404 },
      );
    }
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle documents table is not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to update document." }, { status: 500 });
  }
}

export async function handleAdminVehicleDocumentDelete(
  request: Request,
  context: VehicleDocumentRouteContext,
  deps: AdminVehicleDocumentRouteDeps = DEFAULT_DEPS,
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

  const { id, docId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(docId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const archived = await deps.archiveDocument(id, docId);
    if (!archived) {
      return NextResponse.json({ ok: false, error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle documents table is not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to archive document." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: VehicleDocumentRouteContext) {
  return handleAdminVehicleDocumentPatch(request, context);
}

export async function DELETE(request: Request, context: VehicleDocumentRouteContext) {
  return handleAdminVehicleDocumentDelete(request, context);
}
