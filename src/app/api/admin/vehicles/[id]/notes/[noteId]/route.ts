import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VehicleNoteItemRouteContext = {
  params: Promise<{ id: string; noteId: string }>;
};

export type AdminVehicleNoteItemRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  softDeleteNote: (vehicleId: string, noteId: string) => Promise<boolean>;
};

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

const DEFAULT_DEPS: AdminVehicleNoteItemRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  softDeleteNote: async (vehicleId, noteId) => {
    const result = await dbQuery<{ id: string }>(
      `update vehicle_notes
       set deleted_at = now(), updated_at = now()
       where vehicle_id = $1::uuid and id = $2::uuid and deleted_at is null
       returning id`,
      [vehicleId, noteId],
    );
    return result.rowCount > 0;
  },
};

export async function handleAdminVehicleNoteDelete(
  request: Request,
  context: VehicleNoteItemRouteContext,
  deps: AdminVehicleNoteItemRouteDeps = DEFAULT_DEPS,
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

  const { id, noteId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(noteId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const deleted = await deps.softDeleteNote(id, noteId);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Note not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle notes table is not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to delete note." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: VehicleNoteItemRouteContext) {
  return handleAdminVehicleNoteDelete(request, context);
}
