import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string; logId: string }>;
};

type AttachmentRow = {
  link_id: string;
  document_id: string;
  title: string;
  folder: string;
  document_type: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  listAttachments: (vehicleId: string, logId: string) => Promise<AttachmentRow[]>;
  createAttachmentLink: (vehicleId: string, logId: string, documentId: string) => Promise<AttachmentRow | null>;
};

function mapAttachment(row: AttachmentRow) {
  return {
    linkId: row.link_id,
    documentId: row.document_id,
    title: row.title,
    folder: row.folder,
    documentType: row.document_type,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

const LIST_SQL = `
  select
    vdl.id as link_id,
    vd.id as document_id,
    vd.title,
    vd.folder,
    vd.document_type,
    vd.mime_type,
    vd.size_bytes,
    vd.created_at
  from vehicle_document_links vdl
  join vehicle_documents vd on vd.id = vdl.vehicle_document_id
  where vdl.entity_type = 'MAINTENANCE_LOG'
    and vdl.entity_id = $2::uuid
    and vd.vehicle_id = $1::uuid
  order by vd.created_at desc
`;

const DEFAULT_DEPS: RouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  listAttachments: async (vehicleId, logId) => {
    const result = await dbQuery<AttachmentRow>(LIST_SQL, [vehicleId, logId]);
    return result.rows;
  },
  createAttachmentLink: async (vehicleId, logId, documentId) => {
    const logResult = await dbQuery<{ id: string }>(
      "select id from vehicle_maintenance_logs where id = $1::uuid and vehicle_id = $2::uuid limit 1",
      [logId, vehicleId],
    );
    if (logResult.rowCount < 1) return null;

    const documentResult = await dbQuery<{ id: string }>(
      "select id from vehicle_documents where id = $1::uuid and vehicle_id = $2::uuid limit 1",
      [documentId, vehicleId],
    );
    if (documentResult.rowCount < 1) return null;

    await dbQuery(
      "insert into vehicle_document_links (vehicle_document_id, entity_type, entity_id) values ($1::uuid, 'MAINTENANCE_LOG', $2::uuid) on conflict (vehicle_document_id, entity_type, entity_id) do nothing",
      [documentId, logId],
    );

    const linked = await dbQuery<AttachmentRow>(
      `${LIST_SQL} and vd.id = $3::uuid limit 1`,
      [vehicleId, logId, documentId],
    );
    return linked.rows[0] ?? null;
  },
};

export async function handleVehicleMaintenanceAttachmentsGet(
  _request: Request,
  context: RouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { id, logId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(logId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const rows = await deps.listAttachments(id, logId);
    return NextResponse.json({ ok: true, items: rows.map(mapAttachment) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to load attachments." }, { status: 500 });
  }
}

export async function handleVehicleMaintenanceAttachmentsPost(
  request: Request,
  context: RouteContext,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id, logId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(logId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const documentId = String(body?.documentId ?? body?.document_id ?? "").trim();
  if (!UUID_REGEX.test(documentId)) {
    return NextResponse.json({ ok: false, error: "Valid documentId is required." }, { status: 400 });
  }

  try {
    const link = await deps.createAttachmentLink(id, logId, documentId);
    if (!link) {
      return NextResponse.json(
        { ok: false, error: "Document or maintenance log not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, item: mapAttachment(link) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to attach document." }, { status: 500 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceAttachmentsGet(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceAttachmentsPost(request, context);
}
