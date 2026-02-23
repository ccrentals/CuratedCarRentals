import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VehicleNotesRouteContext = {
  params: Promise<{ id: string }>;
};

type VehicleNoteRow = {
  id: string;
  vehicle_id: string;
  note_text: string;
  created_by_user_id: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type CreateVehicleNoteInput = {
  noteText: string;
  createdByUserId: string | null;
};

export type AdminVehicleNotesRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  listNotes: (vehicleId: string) => Promise<VehicleNoteRow[]>;
  createNote: (vehicleId: string, input: CreateVehicleNoteInput) => Promise<VehicleNoteRow>;
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

function mapNote(row: VehicleNoteRow) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    noteText: row.note_text,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

const BASE_SELECT = `
  select
    n.id,
    n.vehicle_id,
    n.note_text,
    n.created_by_user_id,
    u.email as created_by_email,
    n.created_at,
    n.updated_at,
    n.deleted_at
  from vehicle_notes n
  left join users u on u.id = n.created_by_user_id
`;

const DEFAULT_DEPS: AdminVehicleNotesRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  listNotes: async (vehicleId) => {
    const result = await dbQuery<VehicleNoteRow>(
      `${BASE_SELECT}
       where n.vehicle_id = $1::uuid
         and n.deleted_at is null
       order by n.created_at desc`,
      [vehicleId],
    );
    return result.rows;
  },
  createNote: async (vehicleId, input) => {
    const result = await dbQuery<VehicleNoteRow>(
      `insert into vehicle_notes (vehicle_id, note_text, created_by_user_id)
       values ($1::uuid, $2, $3::uuid)
       returning id, vehicle_id, note_text, created_by_user_id, null::text as created_by_email, created_at, updated_at, deleted_at`,
      [vehicleId, input.noteText, input.createdByUserId],
    );
    return result.rows[0];
  },
};

export async function handleAdminVehicleNotesGet(
  _request: Request,
  context: VehicleNotesRouteContext,
  deps: AdminVehicleNotesRouteDeps = DEFAULT_DEPS,
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

  try {
    const items = await deps.listNotes(id);
    return NextResponse.json({ ok: true, items: items.map(mapNote) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle notes table is not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to load vehicle notes." }, { status: 500 });
  }
}

export async function handleAdminVehicleNotesPost(
  request: Request,
  context: VehicleNotesRouteContext,
  deps: AdminVehicleNotesRouteDeps = DEFAULT_DEPS,
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

  const noteText = normalizeText(body?.noteText ?? body?.note_text);
  if (!noteText) {
    return NextResponse.json({ ok: false, error: "Note text is required." }, { status: 400 });
  }
  if (noteText.length > 4000) {
    return NextResponse.json({ ok: false, error: "Note text is too long." }, { status: 400 });
  }

  try {
    const item = await deps.createNote(id, {
      noteText,
      createdByUserId: session.userId,
    });
    return NextResponse.json({ ok: true, item: mapNote(item) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle notes table is not installed." },
        { status: 503 },
      );
    }
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "23503") {
      return NextResponse.json({ ok: false, error: "Vehicle not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "Failed to save vehicle note." }, { status: 500 });
  }
}

export async function GET(request: Request, context: VehicleNotesRouteContext) {
  return handleAdminVehicleNotesGet(request, context);
}

export async function POST(request: Request, context: VehicleNotesRouteContext) {
  return handleAdminVehicleNotesPost(request, context);
}
