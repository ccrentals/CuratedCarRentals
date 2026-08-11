import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { getFileStorageProvider } from "@/lib/env";
import { requireCsrf } from "@/lib/security/csrf";
import {
  BunnyStorageError,
  createBunnyVehicleDocumentStorageKey,
  deleteBunnyStorageObject,
  getBunnyStorageConfig,
  normalizeBunnyStorageKey,
  uploadBunnyStorageObject,
} from "@/lib/uploads/bunny";
import {
  extractUploadcareDeliveryUrl,
  extractUploadcareFileId,
  UPLOADCARE_ALLOWED_RASTER_IMAGE_MIME_TYPES,
  UploadcareFileValidationError,
  validateUploadcareFiles,
} from "@/lib/uploads/uploadcare";
import { writeMediaAudit } from "@/lib/uploads/mediaAudit";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VEHICLE_DOCUMENT_POLICY = {
  label: "Vehicle document",
  maxCount: 1,
  maxBytes: 20 * 1024 * 1024,
  allowedMimeTypes: ["application/pdf", ...UPLOADCARE_ALLOWED_RASTER_IMAGE_MIME_TYPES],
} as const;

type VehicleDocumentRow = {
  id: string;
  vehicle_id: string;
  maintenance_record_id: string | null;
  maintenance_title: string | null;
  checklist_item_id: string | null;
  checklist_label: string | null;
  folder: string;
  document_type: string;
  title: string;
  label: string | null;
  storage_provider: string;
  storage_key?: string | null;
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

type UploadFile = File & { name: string; size: number; type: string };

function isUploadFile(value: FormDataEntryValue | null): value is UploadFile {
  return Boolean(value && typeof value !== "string" && typeof value.name === "string" && typeof value.size === "number");
}

type CreateVehicleDocumentInput = {
  folder: string;
  maintenanceRecordId: string | null;
  checklistItemId: string | null;
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
  validateUploads?: typeof validateUploadcareFiles;
  writeMediaAudit?: typeof writeMediaAudit;
};

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
  const normalizedProvider = row.storage_provider.trim().toUpperCase();
  const isBunnyStorage = normalizedProvider === "BUNNY_STORAGE";
  const providerIsSupported = !normalizedProvider || isBunnyStorage ||
    ["UPLOADCARE_FILE_ID", "UPLOADCARE", "UPLOADCARE_TOKEN"].includes(normalizedProvider);
  const hasDeliveryUrl = Boolean(extractUploadcareDeliveryUrl(row.storage_key ?? ""));
  const hasKnownFileId = Boolean(extractUploadcareFileId(row.storage_key ?? ""));
  let hasBunnyStorageKey = false;
  if (isBunnyStorage) {
    try {
      hasBunnyStorageKey = normalizeBunnyStorageKey(row.storage_key ?? "").startsWith("private/vehicles/");
    } catch {
      hasBunnyStorageKey = false;
    }
  }
  const canDownload = providerIsSupported && (hasBunnyStorageKey || hasDeliveryUrl || hasKnownFileId);
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    maintenanceRecordId: row.maintenance_record_id,
    linkedTo: row.maintenance_title ?? "Vehicle",
    checklistItemId: row.checklist_item_id,
    checklistItemLabel: row.checklist_label,
    folder: row.folder,
    documentType: row.document_type,
    title: row.title,
    label: row.label,
    storageProvider: row.storage_provider,
    mimeType: row.mime_type,
    sizeBytes: row.file_size_bytes ?? row.size_bytes,
    canDownload,
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
    checklist.checklist_item_id,
    checklist.checklist_label,
    d.folder,
    d.document_type,
    d.title,
    d.label,
    d.storage_provider,
    d.storage_key,
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
  left join lateral (
    select
      i.id as checklist_item_id,
      i.label as checklist_label
    from vehicle_checklist_items i
    where i.vehicle_id = d.vehicle_id
      and i.uploaded_document_id = d.id
      and i.archived_at is null
    order by i.updated_at desc
    limit 1
  ) checklist on true
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

    if (input.checklistItemId) {
      const checklistItem = await dbQuery<{ id: string; folder: string }>(
        "select id, folder from vehicle_checklist_items where id = $1::uuid and vehicle_id = $2::uuid and archived_at is null limit 1",
        [input.checklistItemId, vehicleId],
      );
      if (checklistItem.rowCount < 1) {
        throw new Error("CHECKLIST_ITEM_NOT_FOUND");
      }
      const checklistFolder = checklistItem.rows[0]?.folder?.trim().toLowerCase() ?? "";
      if (checklistFolder !== input.folder.trim().toLowerCase()) {
        throw new Error("CHECKLIST_ITEM_FOLDER_MISMATCH");
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

    if (input.checklistItemId) {
      await dbQuery(
        "update vehicle_checklist_items set uploaded_document_id = $1::uuid, updated_at = now() where id = $2::uuid and vehicle_id = $3::uuid",
        [created.rows[0].id, input.checklistItemId, vehicleId],
      );
    }

    const result = await dbQuery<VehicleDocumentRow>(
      `${BASE_SELECT} where d.id = $1::uuid limit 1`,
      [created.rows[0].id],
    );

    return result.rows[0];
  },
  validateUploads: validateUploadcareFiles,
  writeMediaAudit,
};

export async function handleAdminVehicleDocumentsGet(
  request: Request,
  context: DocumentsRouteContext,
  deps: AdminVehicleDocumentsRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

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
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const isMultipart = request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data") ?? false;
  const form = isMultipart ? await request.formData().catch(() => null) : null;
  const body = isMultipart ? null : (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const read = (key: string) => form?.get(key) ?? body?.[key];
  const csrfToken = read("csrfToken");
  if (!(await deps.requireCsrfCheck(request, typeof csrfToken === "string" ? csrfToken : null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid vehicle id" }, { status: 400 });
  }

  const folder = normalizeFolder(read("folder"));
  const documentType = normalizeDocumentType(read("document_type") ?? read("documentType"));
  const uploadedFile = isMultipart ? form?.get("file") ?? null : null;
  const isBunnyUpload = isMultipart && isUploadFile(uploadedFile);
  const storageProvider =
    isBunnyUpload ? "BUNNY_STORAGE" : normalizeText(read("storage_provider") ?? read("storageProvider")).toUpperCase() || "UPLOADCARE_FILE_ID";
  const rawStorageReference =
    read("storage_key") ?? read("storageKey") ?? read("uploadcareFileId") ?? read("uploadcare_file_id") ?? read("fileId") ?? read("cdnUrl");
  const rawStorageText = normalizeText(rawStorageReference);
  const uploadcareFileId = extractUploadcareFileId(rawStorageReference);
  const normalizedStorageKey =
    uploadcareFileId ?? extractUploadcareDeliveryUrl(rawStorageText);
  const title = normalizeTitle(read("title"), documentType || "Document");
  const label = normalizeNullableText(read("label"), 140);
  const maintenanceRecordId = normalizeRecordId(
    read("maintenanceRecordId") ?? read("maintenance_record_id"),
  );
  const checklistItemId = normalizeRecordId(
    read("checklistItemId") ?? read("checklist_item_id"),
  );
  const mimeType = isBunnyUpload ? normalizeMimeType(uploadedFile.type) : normalizeMimeType(read("mime_type") ?? read("mimeType"));
  const sizeBytes = isBunnyUpload ? uploadedFile.size : normalizeSizeBytes(read("size_bytes") ?? read("sizeBytes"));
  const fileSizeBytes = isBunnyUpload ? uploadedFile.size : normalizeSizeBytes(read("file_size_bytes") ?? read("fileSizeBytes") ?? sizeBytes);
  const tags = normalizeTags(body?.tags);

  if (!folder) {
    return NextResponse.json({ ok: false, error: "Folder is required." }, { status: 400 });
  }
  if (!isBunnyUpload && !normalizedStorageKey) {
    return NextResponse.json(
      { ok: false, error: "Invalid upload reference. Upload a file first." },
      { status: 400 },
    );
  }
  if (!documentType) {
    return NextResponse.json({ ok: false, error: "Document type is required." }, { status: 400 });
  }
  if (isMultipart && (!isBunnyUpload || getFileStorageProvider() !== "bunny")) {
    return NextResponse.json({ ok: false, error: "Private Bunny uploads are not active for this environment." }, { status: 409 });
  }
  if (isBunnyUpload && (
    !mimeType || !VEHICLE_DOCUMENT_POLICY.allowedMimeTypes.includes(mimeType as never) || !sizeBytes || sizeBytes > VEHICLE_DOCUMENT_POLICY.maxBytes
  )) {
    return NextResponse.json({ ok: false, error: "Select a PDF, JPG, PNG, WebP, HEIC, or HEIF file no larger than 20 MB." }, { status: 400 });
  }
  if (!["UPLOADCARE_FILE_ID", "UPLOADCARE", "UPLOADCARE_TOKEN", "BUNNY_STORAGE"].includes(storageProvider)) {
    return NextResponse.json({ ok: false, error: "Unsupported storage provider." }, { status: 400 });
  }

  let uploadedBunnyStorageKey: string | null = null;
  try {
    let storageKey = normalizedStorageKey ?? "";
    if (isBunnyUpload) {
      const config = getBunnyStorageConfig("private");
      storageKey = createBunnyVehicleDocumentStorageKey({ vehicleId: id, fileName: uploadedFile.name });
      await uploadBunnyStorageObject(config, storageKey, uploadedFile);
      uploadedBunnyStorageKey = storageKey;
    } else {
      await deps.validateUploads?.([storageKey], VEHICLE_DOCUMENT_POLICY);
    }
    const row = await deps.createDocument(id, {
      folder,
      maintenanceRecordId,
      checklistItemId,
      documentType,
      title,
      label,
      storageProvider,
      storageKey,
      mimeType,
      sizeBytes,
      fileSizeBytes,
      tags,
      uploadedByUserId: session.userId,
    });
    try {
      await deps.writeMediaAudit?.({
        userId: session.userId,
        action: "MEDIA_UPLOAD",
        entityType: "vehicle",
        entityId: id,
        fileId: storageKey,
        context: maintenanceRecordId ? "maintenance document" : "vehicle document",
        label: title,
        outcome: isBunnyUpload ? "Saved privately to Bunny Storage" : "Saved to vehicle files",
        details: { documentId: row.id, folder, documentType, storageProvider },
      });
    } catch {
      // Document creation remains successful when audit logging is unavailable.
    }

    return NextResponse.json({ ok: true, item: mapDocument(row) });
  } catch (error) {
    if (uploadedBunnyStorageKey) {
      try {
        await deleteBunnyStorageObject(getBunnyStorageConfig("private"), uploadedBunnyStorageKey);
      } catch {
        // The primary save failure is more useful than a best-effort cleanup failure.
      }
    }
    if (error instanceof UploadcareFileValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof BunnyStorageError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
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
    if (message === "CHECKLIST_ITEM_NOT_FOUND") {
      return NextResponse.json(
        { ok: false, error: "Checklist item not found for this vehicle." },
        { status: 404 },
      );
    }
    if (message === "CHECKLIST_ITEM_FOLDER_MISMATCH") {
      return NextResponse.json(
        { ok: false, error: "Checklist item folder must match the selected file folder." },
        { status: 400 },
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
