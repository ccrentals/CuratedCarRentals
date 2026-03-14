import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ChecklistItemRouteContext = {
  params: Promise<{ id: string; itemId: string }>;
};

type ChecklistRow = {
  id: string;
  vehicle_id: string;
  label: string;
  folder: string;
  required: boolean;
  allow_not_required: boolean;
  uploaded_document_id: string | null;
  uploaded_document_title: string | null;
  uploaded_document_label: string | null;
  expiration_date: string | null;
  created_at: string;
  updated_at: string;
};

type UpdateChecklistInput = {
  label: string;
  required: boolean;
  expirationDate: string | null;
};

export type AdminVehicleChecklistItemDeleteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getItem: (vehicleId: string, itemId: string) => Promise<ChecklistRow | null>;
  updateItem: (
    vehicleId: string,
    itemId: string,
    input: UpdateChecklistInput,
  ) => Promise<ChecklistRow | null>;
  deleteItem: (vehicleId: string, itemId: string) => Promise<boolean>;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
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
    allowNotRequired: row.allow_not_required,
    uploadedDocumentId: row.uploaded_document_id,
    uploadedDocumentDisplayLabel: row.uploaded_document_label ?? row.uploaded_document_title,
    expirationDate: row.expiration_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DEFAULT_DEPS: AdminVehicleChecklistItemDeleteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getItem: async (vehicleId, itemId) => {
    const result = await dbQuery<ChecklistRow>(
      `select
         i.id,
         i.vehicle_id,
         i.label,
         i.folder,
         i.required,
         i.allow_not_required,
         i.uploaded_document_id,
         d.title as uploaded_document_title,
         d.label as uploaded_document_label,
         i.expiration_date,
         i.created_at,
         i.updated_at
       from vehicle_checklist_items i
       left join vehicle_documents d
         on d.id = i.uploaded_document_id
        and d.archived_at is null
       where i.id = $1::uuid
         and i.vehicle_id = $2::uuid
       limit 1`,
      [itemId, vehicleId],
    );
    return result.rows[0] ?? null;
  },
  updateItem: async (vehicleId, itemId, input) => {
    const result = await dbQuery<ChecklistRow>(
      `update vehicle_checklist_items
          set label = $3,
              required = $4,
              expiration_date = $5::date,
              updated_at = now()
        where id = $1::uuid
          and vehicle_id = $2::uuid
      returning id,
                vehicle_id,
                label,
                folder,
                required,
                allow_not_required,
                uploaded_document_id,
                null::text as uploaded_document_title,
                null::text as uploaded_document_label,
                expiration_date,
                created_at,
                updated_at`,
      [itemId, vehicleId, input.label, input.required, input.expirationDate],
    );
    return result.rows[0] ?? null;
  },
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
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

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

export async function handleAdminVehicleChecklistItemPatch(
  request: Request,
  context: ChecklistItemRouteContext,
  deps: AdminVehicleChecklistItemDeleteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await deps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id, itemId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(itemId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const existing = await deps.getItem(id, itemId);
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Checklist item not found." }, { status: 404 });
    }

    const label =
      body && ("label" in body)
        ? normalizeLabel(body.label)
        : existing.label;
    if (!label) {
      return NextResponse.json({ ok: false, error: "Label is required." }, { status: 400 });
    }

    const required =
      body && ("required" in body)
        ? normalizeRequired(body.required)
        : existing.required;
    if (!existing.allow_not_required && !required) {
      return NextResponse.json(
        { ok: false, error: "This item must remain required." },
        { status: 400 },
      );
    }

    const expirationDate =
      body && ("expirationDate" in body || "expiration_date" in body)
        ? normalizeExpirationDate(body.expirationDate ?? body.expiration_date)
        : existing.expiration_date;

    const updated = await deps.updateItem(id, itemId, {
      label,
      required,
      expirationDate,
    });
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Checklist item not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, item: mapItem(updated) });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle checklist table is not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to update checklist item." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: ChecklistItemRouteContext) {
  return handleAdminVehicleChecklistItemDelete(request, context);
}

export async function PATCH(request: Request, context: ChecklistItemRouteContext) {
  return handleAdminVehicleChecklistItemPatch(request, context);
}
