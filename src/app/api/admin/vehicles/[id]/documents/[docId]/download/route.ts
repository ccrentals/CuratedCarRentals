import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { buildUploadcareCdnUrl, extractUploadcareFileId } from "@/lib/uploads/uploadcare";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VehicleDocumentDownloadRouteContext = {
  params: Promise<{ id: string; docId: string }>;
};

type VehicleDocumentStorageRow = {
  id: string;
  title: string;
  storage_provider: string;
  storage_key: string;
  mime_type: string | null;
};

export type AdminVehicleDocumentDownloadRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  getDocument: (vehicleId: string, docId: string) => Promise<VehicleDocumentStorageRow | null>;
};

function sanitizeFileName(value: string) {
  const trimmed = value.trim();
  const compact = trimmed.replace(/[^a-z0-9._-]+/gi, "_");
  const normalized = compact.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "document";
}

const DEFAULT_DEPS: AdminVehicleDocumentDownloadRouteDeps = {
  getSession: () => getSessionFromRequest(),
  getDocument: async (vehicleId, docId) => {
    const result = await dbQuery<VehicleDocumentStorageRow>(
      "select id, title, storage_provider, storage_key, mime_type from vehicle_documents where id = $1::uuid and vehicle_id = $2::uuid and archived_at is null limit 1",
      [docId, vehicleId],
    );
    return result.rows[0] ?? null;
  },
};

export async function handleAdminVehicleDocumentDownload(
  _request: Request,
  context: VehicleDocumentDownloadRouteContext,
  deps: AdminVehicleDocumentDownloadRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) {
    const status = auth.reason === "unauthorized" ? 401 : 403;
    const error = auth.reason === "unauthorized" ? "Unauthorized" : "Forbidden";
    return NextResponse.json(
      { ok: false, error },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
  const { id, docId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(docId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid request." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const doc = await deps.getDocument(id, docId);
    if (!doc) {
      return NextResponse.json(
        { ok: false, error: "Document not found." },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }

    const provider = doc.storage_provider.trim().toUpperCase();
    if (provider && !["UPLOADCARE", "UPLOADCARE_FILE_ID", "UPLOADCARE_TOKEN"].includes(provider)) {
      return NextResponse.json(
        { ok: false, error: "Unsupported storage provider." },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }

    const fileId = extractUploadcareFileId(doc.storage_key);
    if (!fileId) {
      return NextResponse.json(
        { ok: false, error: "Invalid storage key." },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }

    const upstream = await fetch(buildUploadcareCdnUrl(fileId));
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { ok: false, error: "Unable to load file from storage." },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }

    const filename = sanitizeFileName(doc.title);
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": doc.mime_type || upstream.headers.get("content-type") || "application/octet-stream",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, max-age=0, no-store",
      },
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle documents table is not installed." },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Failed to download document." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function GET(request: Request, context: VehicleDocumentDownloadRouteContext) {
  return handleAdminVehicleDocumentDownload(request, context);
}
