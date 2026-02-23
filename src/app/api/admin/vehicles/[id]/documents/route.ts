import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { extractUploadcareFileId } from "@/lib/uploads/uploadcare";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VehicleDocumentRow = {
  id: string;
  vehicle_id: string;
  maintenance_record_id: string | null;
  maintenance_title: string | null;
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

type DocumentsRouteContext = {
  params: Promise<{ id: string }>;
};

type CreateVehicleDocumentInput = {
  folder: string;
  maintenanceRecordId: string | null;
  documentType: string;
  title: string;
  label: string | null;
  storageProvider: string;
  storageKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  fileSizeBytes: number | null;
  tags: unknown[];
  uploadedByUserId: string | null;
};

export type AdminVehicleDocumentsRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  listDocuments: (
    vehicleId: string,
    options: { folder?: string | null; includeArchived?: boolean },
  ) => Promise<VehicleDocumentRow[]>;
  createDocument: (vehicleId: string, input: CreateVehicleDocumentInput) => Promise<VehicleDocumentRow>;
};

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeNullableText(value: unknown, max = 255) {
  const text = normalizeText(value).slice(0, max);
  return text ? text : null;
}

function normalizeFolder(value: unknown) {
  const folder = normalizeText(value);
  if (!folder) return "";
  return folder.slice(0, 60);
}

function normalizeDocumentType(value: unknown) {
  const type = normalizeText(value);
  if (!type) return "OTHER";
  return type.slice(0, 80);
}

function normalizeTitle(value: unknown, fallback: string) {
  const title = normalizeText(value);
  if (!title) return fallback.slice(0, 140);
  return title.slice(0, 140);
}

function normalizeMimeType(value: unknown) {
  const mime = normalizeText(value);
  return mime ? mime.slice(0, 120) : null;
}

function normalizeSizeBytes(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 ? rounded : null;
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20);
}

function normalizeRecordId(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  return UUID_REGEX.test(text) ? text : null;
}

function mapDocument(row: VehicleDocumentRow) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    maintenanceRecordId: row.maintenance_record_id,
    linkedTo: row.maintenance_title ?? "Vehicle",
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

const BASE_SELECT = `
  select
    d.id,
    d.vehicle_id,
    d.maintenance_record_id,
    r.title as maintenance_title,
    d.folder,
    d.document_type,
    d.title,
    d.label,
    d.storage_provider,
    d.mime_type,
    d.size_bytes,
    d.file_size_bytes,
    d.tags,
    d.uploaded_by_user_id,
    d.created_at,
    d.archived_at
  from vehicle_documents d
  left join vehicle_maintenance_records r
    on r.id = d.maintenance_record_id
   and r.vehicle_id = d.vehicle_id
`;

const DEFAULT_DEPS: AdminVehicleDocumentsRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  listDocuments: async (vehicleId, options) => {
    const values: Array<string | boolean> = [vehicleId];
    const where: string[] = ["d.vehicle_id = $1::uuid"];

    if (!options.includeArchived) {
      where.push("d.archived_at is null");
    }

    if (options.folder) {
      values.push(options.folder);
      where.push(`lower(d.folder) = lower($${values.length})`);
    }

    const result = await dbQuery<VehicleDocumentRow>(
      `${BASE_SELECT}
       where ${where.join(" and ")}
       order by d.created_at desc`,
      values,
    );

    return result.rows;
  },
  createDocument: async (vehicleId, input) => {
    const vehicleResult = await dbQuery<{ id: string }>(
      "select id from vehicles where id = $1::uuid limit 1",
      [vehicleId],
    );
    if (vehicleResult.rowCount < 1) {
      throw new Error("VEHICLE_NOT_FOUND");
    }

    if (input.maintenanceRecordId) {
      const maintenance = await dbQuery<{ id: string }>(
        "select id from vehicle_maintenance_records where id = $1::uuid and vehicle_id = $2::uuid limit 1",
        [input.maintenanceRecordId, vehicleId],
      );
      if (maintenance.rowCount < 1) {
        throw new Error("MAINTENANCE_RECORD_NOT_FOUND");
      }
    }

    const created = await dbQuery<{ id: string }>(
      `insert into vehicle_documents (
        vehicle_id,
        maintenance_record_id,
        folder,
        document_type,
        title,
        label,
        storage_provider,
        storage_key,
        mime_type,
        size_bytes,
        file_size_bytes,
        tags,
        uploaded_by_user_id
      ) values (
        $1::uuid,
        $2::uuid,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb,
        $13::uuid
      )
      returning id`,
      [
        vehicleId,
        input.maintenanceRecordId,
        input.folder,
        input.documentType,
        input.title,
        input.label,
        input.storageProvider,
        input.storageKey,
        input.mimeType,
        input.sizeBytes,
        input.fileSizeBytes,
        input.tags,
        input.uploadedByUserId,
      ],
    );

    const result = await dbQuery<VehicleDocumentRow>(
      `${BASE_SELECT} where d.id = $1::uuid limit 1`,
      [created.rows[0].id],
    );

    return result.rows[0];
  },
};

export async function handleAdminVehicleDocumentsGet(
  request: Request,
  context: DocumentsRouteContext,
  deps: AdminVehicleDocumentsRouteDeps = DEFAULT_DEPS,
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
    return NextResponse.json({ ok: false, error: "Invalid vehicle id" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const folder = normalizeFolder(searchParams.get("folder"));
  const includeArchived = searchParams.get("includeArchived") === "1";

  try {
    const rows = await deps.listDocuments(id, { folder: folder || null, includeArchived });
    return NextResponse.json({ ok: true, items: rows.map(mapDocument) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle documents table is not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to load vehicle documents." }, { status: 500 });
  }
}

export async function handleAdminVehicleDocumentsPost(
  request: Request,
  context: DocumentsRouteContext,
  deps: AdminVehicleDocumentsRouteDeps = DEFAULT_DEPS,
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
    return NextResponse.json({ ok: false, error: "Invalid vehicle id" }, { status: 400 });
  }

  const folder = normalizeFolder(body?.folder);
  const documentType = normalizeDocumentType(body?.document_type ?? body?.documentType);
  const storageProvider =
    normalizeText(body?.storage_provider ?? body?.storageProvider).toUpperCase() || "UPLOADCARE_FILE_ID";
  const rawStorageReference =
    body?.storage_key ??
    body?.storageKey ??
    body?.uploadcareFileId ??
    body?.uploadcare_file_id ??
    body?.fileId ??
    body?.cdnUrl;
  const uploadcareFileId = extractUploadcareFileId(rawStorageReference);
  const title = normalizeTitle(body?.title, documentType || "Document");
  const label = normalizeNullableText(body?.label, 140);
  const maintenanceRecordId = normalizeRecordId(
    body?.maintenanceRecordId ?? body?.maintenance_record_id,
  );
  const mimeType = normalizeMimeType(body?.mime_type ?? body?.mimeType);
  const sizeBytes = normalizeSizeBytes(body?.size_bytes ?? body?.sizeBytes);
  const fileSizeBytes = normalizeSizeBytes(body?.file_size_bytes ?? body?.fileSizeBytes ?? sizeBytes);
  const tags = normalizeTags(body?.tags);

  if (!folder) {
    return NextResponse.json({ ok: false, error: "Folder is required." }, { status: 400 });
  }
  if (!uploadcareFileId) {
    return NextResponse.json(
      { ok: false, error: "Invalid upload reference. Upload a file first." },
      { status: 400 },
    );
  }
  if (!documentType) {
    return NextResponse.json({ ok: false, error: "Document type is required." }, { status: 400 });
  }
  if (!["UPLOADCARE_FILE_ID", "UPLOADCARE", "UPLOADCARE_TOKEN"].includes(storageProvider)) {
    return NextResponse.json({ ok: false, error: "Unsupported storage provider." }, { status: 400 });
  }

  try {
    const row = await deps.createDocument(id, {
      folder,
      maintenanceRecordId,
      documentType,
      title,
      label,
      storageProvider,
      storageKey: uploadcareFileId,
      mimeType,
      sizeBytes,
      fileSizeBytes,
      tags,
      uploadedByUserId: session.userId,
    });

    return NextResponse.json({ ok: true, item: mapDocument(row) });
  } catch (error) {
    const message = String((error as Error | null)?.message ?? "");
    if (message === "VEHICLE_NOT_FOUND") {
      return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
    }
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
    return NextResponse.json({ ok: false, error: "Failed to save vehicle document." }, { status: 500 });
  }
}

export async function GET(request: Request, context: DocumentsRouteContext) {
  return handleAdminVehicleDocumentsGet(request, context);
}

export async function POST(request: Request, context: DocumentsRouteContext) {
  return handleAdminVehicleDocumentsPost(request, context);
}
