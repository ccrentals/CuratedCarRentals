import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { loadAdminSettings } from "@/lib/adminSettings";
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
  template_id: string | null;
  template_key: string | null;
  template_expiry_required: boolean | null;
  template_expiry_warning_days: number | null;
  uploaded_document_id: string | null;
  uploaded_document_title: string | null;
  uploaded_document_label: string | null;
  expiration_date: string | null;
  created_at: string;
  updated_at: string;
};

type UpdateChecklistInput = {
  label: string;
  folder: string;
  required: boolean;
  expirationDate: string | null;
  templateId: string | null;
};

export type AdminVehicleChecklistItemDeleteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getItem: (vehicleId: string, itemId: string) => Promise<ChecklistRow | null>;
  resolveTemplateId: (templateKey: string) => Promise<string | null>;
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

function normalizeFolder(value: unknown) {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, 80) : "Unsorted";
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
    templateId: row.template_id,
    templateKey: row.template_key,
    templateExpiryRequired: row.template_expiry_required,
    templateExpiryWarningDays: row.template_expiry_warning_days,
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
         i.template_id,
         t.key as template_key,
         t.expiry_required as template_expiry_required,
         t.expiry_warning_days as template_expiry_warning_days,
         i.uploaded_document_id,
         d.title as uploaded_document_title,
         d.label as uploaded_document_label,
         i.expiration_date,
         i.created_at,
         i.updated_at
       from vehicle_checklist_items i
       left join vehicle_checklist_templates t
         on t.id = i.template_id
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
  resolveTemplateId: async (templateKey) => {
    const normalizedKey = templateKey.trim().toLowerCase();
    if (!normalizedKey) return null;

    const { settings } = await loadAdminSettings();
    const template = settings.vehicleChecklistTemplates.find(
      (entry) => entry.key.trim().toLowerCase() === normalizedKey,
    );
    if (!template) return null;

    const result = await dbQuery<{ id: string }>(
      `insert into vehicle_checklist_templates (
         key,
         label,
         default_folder,
         required,
         allow_not_required,
         expiry_required,
         expiry_warning_days,
         is_active,
         source,
         updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'SETTINGS', now())
       on conflict (key) do update
         set label = excluded.label,
             default_folder = excluded.default_folder,
             required = excluded.required,
             allow_not_required = excluded.allow_not_required,
             expiry_required = excluded.expiry_required,
             expiry_warning_days = excluded.expiry_warning_days,
             is_active = excluded.is_active,
             source = 'SETTINGS',
             updated_at = now()
       returning id`,
      [
        template.key,
        template.label,
        template.folder,
        template.required,
        template.allowNotRequired,
        template.expiryRequired,
        template.expiryWarningDays,
        template.isActive,
      ],
    );
    return result.rows[0]?.id ?? null;
  },
  updateItem: async (vehicleId, itemId, input) => {
    const result = await dbQuery<ChecklistRow>(
      `with updated as (
         update vehicle_checklist_items
            set label = $3,
                folder = $4,
                required = $5,
                expiration_date = $6::date,
                template_id = $7::uuid,
                updated_at = now()
          where id = $1::uuid
            and vehicle_id = $2::uuid
        returning *
       )
       select
         i.id,
         i.vehicle_id,
         i.label,
         i.folder,
         i.required,
         i.allow_not_required,
         i.template_id,
         t.key as template_key,
         t.expiry_required as template_expiry_required,
         t.expiry_warning_days as template_expiry_warning_days,
         i.uploaded_document_id,
         null::text as uploaded_document_title,
         null::text as uploaded_document_label,
         i.expiration_date,
         i.created_at,
         i.updated_at
       from updated i
       left join vehicle_checklist_templates t
         on t.id = i.template_id`,
      [
        itemId,
        vehicleId,
        input.label,
        input.folder,
        input.required,
        input.expirationDate,
        input.templateId,
      ],
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

    const folder =
      body && ("folder" in body)
        ? normalizeFolder(body.folder)
        : existing.folder;

    const expirationDate =
      body && ("expirationDate" in body || "expiration_date" in body)
        ? normalizeExpirationDate(body.expirationDate ?? body.expiration_date)
        : existing.expiration_date;

    const hasTemplateKeyOverride = Boolean(
      body && ("templateKey" in body || "template_key" in body),
    );
    const templateKey = hasTemplateKeyOverride
      ? normalizeText(body?.templateKey ?? body?.template_key).toLowerCase()
      : existing.template_key ?? "";
    const templateId = hasTemplateKeyOverride
      ? templateKey
        ? await deps.resolveTemplateId(templateKey)
        : null
      : existing.template_id;
    if (hasTemplateKeyOverride && templateKey && !templateId) {
      return NextResponse.json(
        { ok: false, error: "Checklist template not found." },
        { status: 400 },
      );
    }

    const updated = await deps.updateItem(id, itemId, {
      label,
      folder,
      required,
      expirationDate,
      templateId,
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
