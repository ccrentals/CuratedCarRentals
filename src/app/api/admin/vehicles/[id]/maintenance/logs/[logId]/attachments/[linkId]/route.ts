import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string; logId: string; linkId: string }>;
};

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  deleteAttachmentLink: (vehicleId: string, logId: string, linkId: string) => Promise<boolean>;
};

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

const DEFAULT_DEPS: RouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  deleteAttachmentLink: async (vehicleId, logId, linkId) => {
    const result = await dbQuery<{ id: string }>(
      `delete from vehicle_document_links vdl
       using vehicle_documents vd
       where vdl.id = $3::uuid
         and vdl.entity_type = 'MAINTENANCE_LOG'
         and vdl.entity_id = $2::uuid
         and vd.id = vdl.vehicle_document_id
         and vd.vehicle_id = $1::uuid
       returning vdl.id`,
      [vehicleId, logId, linkId],
    );
    return result.rowCount > 0;
  },
};

export async function handleVehicleMaintenanceAttachmentDelete(
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

  const { id, logId, linkId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(logId) || !UUID_REGEX.test(linkId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const deleted = await deps.deleteAttachmentLink(id, logId, linkId);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Attachment not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to remove attachment." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleVehicleMaintenanceAttachmentDelete(request, context);
}

