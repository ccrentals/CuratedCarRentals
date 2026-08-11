import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
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
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

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
