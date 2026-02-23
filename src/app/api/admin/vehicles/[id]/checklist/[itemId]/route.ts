import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ChecklistItemRouteContext = {
  params: Promise<{ id: string; itemId: string }>;
};

export type AdminVehicleChecklistItemDeleteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  deleteItem: (vehicleId: string, itemId: string) => Promise<boolean>;
};

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

const DEFAULT_DEPS: AdminVehicleChecklistItemDeleteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  deleteItem: async (vehicleId, itemId) => {
    const result = await dbQuery<{ id: string }>(
      "delete from vehicle_checklist_items where id = $1::uuid and vehicle_id = $2::uuid returning id",
      [itemId, vehicleId],
    );
    return result.rowCount > 0;
  },
};

export async function handleAdminVehicleChecklistItemDelete(
  request: Request,
  context: ChecklistItemRouteContext,
  deps: AdminVehicleChecklistItemDeleteDeps = DEFAULT_DEPS,
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

  const { id, itemId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(itemId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const deleted = await deps.deleteItem(id, itemId);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Checklist item not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle checklist table is not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to delete checklist item." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: ChecklistItemRouteContext) {
  return handleAdminVehicleChecklistItemDelete(request, context);
}
