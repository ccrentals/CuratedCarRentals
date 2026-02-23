import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ChecklistRouteContext = {
  params: Promise<{ id: string }>;
};

type ChecklistRow = {
  id: string;
  vehicle_id: string;
  label: string;
  folder: string;
  required: boolean;
  uploaded_document_id: string | null;
  expiration_date: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminVehicleChecklistRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  listItems: (vehicleId: string) => Promise<ChecklistRow[]>;
  createItem: (vehicleId: string, input: CreateChecklistInput) => Promise<ChecklistRow>;
};

type CreateChecklistInput = {
  label: string;
  folder: string;
  required: boolean;
  expirationDate: string | null;
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

function normalizeFolder(value: unknown) {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, 80) : "Unsorted";
}

function normalizeLabel(value: unknown) {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, 160) : "";
}

function normalizeRequired(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeExpirationDate(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function mapItem(row: ChecklistRow) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    label: row.label,
    folder: row.folder,
    required: row.required,
    uploadedDocumentId: row.uploaded_document_id,
    expirationDate: row.expiration_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DEFAULT_DEPS: AdminVehicleChecklistRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  listItems: async (vehicleId) => {
    const result = await dbQuery<ChecklistRow>(
      "select id, vehicle_id, label, folder, required, uploaded_document_id, expiration_date, created_at, updated_at from vehicle_checklist_items where vehicle_id = $1::uuid order by required desc, lower(label) asc, created_at desc",
      [vehicleId],
    );
    return result.rows;
  },
  createItem: async (vehicleId, input) => {
    const result = await dbQuery<ChecklistRow>(
      "insert into vehicle_checklist_items (vehicle_id, label, folder, required, expiration_date) values ($1::uuid, $2, $3, $4, $5::date) returning id, vehicle_id, label, folder, required, uploaded_document_id, expiration_date, created_at, updated_at",
      [vehicleId, input.label, input.folder, input.required, input.expirationDate],
    );
    return result.rows[0];
  },
};

export async function handleAdminVehicleChecklistGet(
  _request: Request,
  context: ChecklistRouteContext,
  deps: AdminVehicleChecklistRouteDeps = DEFAULT_DEPS,
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
    const items = await deps.listItems(id);
    return NextResponse.json({ ok: true, items: items.map(mapItem) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle checklist table is not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to load checklist." }, { status: 500 });
  }
}

export async function handleAdminVehicleChecklistPost(
  request: Request,
  context: ChecklistRouteContext,
  deps: AdminVehicleChecklistRouteDeps = DEFAULT_DEPS,
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

  const label = normalizeLabel(body?.label);
  if (!label) {
    return NextResponse.json({ ok: false, error: "Label is required." }, { status: 400 });
  }

  const input: CreateChecklistInput = {
    label,
    folder: normalizeFolder(body?.folder),
    required: normalizeRequired(body?.required),
    expirationDate: normalizeExpirationDate(body?.expirationDate ?? body?.expiration_date),
  };

  try {
    const item = await deps.createItem(id, input);
    return NextResponse.json({ ok: true, item: mapItem(item) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle checklist table is not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to save checklist item." }, { status: 500 });
  }
}

export async function GET(request: Request, context: ChecklistRouteContext) {
  return handleAdminVehicleChecklistGet(request, context);
}

export async function POST(request: Request, context: ChecklistRouteContext) {
  return handleAdminVehicleChecklistPost(request, context);
}
