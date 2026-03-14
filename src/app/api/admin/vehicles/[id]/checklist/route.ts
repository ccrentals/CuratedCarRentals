import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { loadAdminSettings } from "@/lib/adminSettings";
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

export type AdminVehicleChecklistRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  listItems: (vehicleId: string) => Promise<ChecklistRow[]>;
  resolveTemplateId: (templateKey: string) => Promise<string | null>;
  createItem: (vehicleId: string, input: CreateChecklistInput) => Promise<ChecklistRow>;
};

type CreateChecklistInput = {
  label: string;
  folder: string;
  required: boolean;
  allowNotRequired: boolean;
  expirationDate: string | null;
  templateId: string | null;
};

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

const DEFAULT_DEPS: AdminVehicleChecklistRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  listItems: async (vehicleId) => {
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
       where i.vehicle_id = $1::uuid
       order by i.required desc, lower(i.label) asc, i.created_at desc`,
      [vehicleId],
    );
    return result.rows;
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
  createItem: async (vehicleId, input) => {
    const result = await dbQuery<ChecklistRow>(
      `with inserted as (
         insert into vehicle_checklist_items (
           vehicle_id,
           template_id,
           label,
           folder,
           required,
           allow_not_required,
           expiration_date
         )
         values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date)
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
       from inserted i
       left join vehicle_checklist_templates t
         on t.id = i.template_id`,
      [
        vehicleId,
        input.templateId,
        input.label,
        input.folder,
        input.required,
        input.allowNotRequired,
        input.expirationDate,
      ],
    );
    return result.rows[0];
  },
};

export async function handleAdminVehicleChecklistGet(
  _request: Request,
  context: ChecklistRouteContext,
  deps: AdminVehicleChecklistRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

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
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

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

  const templateKey = normalizeText(body?.templateKey ?? body?.template_key).toLowerCase();
  const templateId = templateKey ? await deps.resolveTemplateId(templateKey) : null;
  if (templateKey && !templateId) {
    return NextResponse.json({ ok: false, error: "Checklist template not found." }, { status: 400 });
  }

  const input: CreateChecklistInput = {
    label,
    folder: normalizeFolder(body?.folder),
    required: normalizeRequired(body?.required),
    allowNotRequired: normalizeRequired(body?.allowNotRequired ?? body?.allow_not_required ?? true),
    expirationDate: normalizeExpirationDate(body?.expirationDate ?? body?.expiration_date),
    templateId,
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
