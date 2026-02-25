import { NextResponse } from "next/server";

import { requireAdminRole, requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import {
  DEFAULT_ADMIN_SETTINGS,
  type VehicleChecklistTemplateSetting,
} from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

const SETTINGS_KEY = "settings";
type AdminSettings = typeof DEFAULT_ADMIN_SETTINGS;

function normalizeDayViewBookingLimit(value: unknown): number | "all" {
  if (value === "all") return "all";
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 50) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "all") return "all";
    const parsed = Number(normalized);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 50) {
      return parsed;
    }
  }
  return DEFAULT_ADMIN_SETTINGS.dayViewBookingLimit;
}

function normalizeNotificationEmails(value: unknown) {
  if (typeof value !== "string") return DEFAULT_ADMIN_SETTINGS.contactNotificationEmails;
  return value
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 25)
    .join(", ");
}

function normalizeContactNotifyCooldownMinutes(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ADMIN_SETTINGS.contactNotifyCooldownMinutes;
  return Math.min(120, Math.max(1, Math.floor(parsed)));
}

function normalizeMaintenanceReminderLeadDays(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ADMIN_SETTINGS.maintenanceReminderLeadDays;
  return Math.min(90, Math.max(1, Math.floor(parsed)));
}

function normalizeMaintenanceDueSoonDays(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ADMIN_SETTINGS.maintenanceDueSoonDays;
  return Math.min(180, Math.max(1, Math.floor(parsed)));
}

function normalizeMaintenanceDueSoonKm(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ADMIN_SETTINGS.maintenanceDueSoonKm;
  return Math.min(25000, Math.max(0, Math.floor(parsed)));
}

function normalizeDepreciationDefaultMethod(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "STRAIGHT_LINE") return "STRAIGHT_LINE" as const;
  return DEFAULT_ADMIN_SETTINGS.depreciationDefaultMethod;
}

function normalizeDepreciationDefaultUsefulLifeMonths(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ADMIN_SETTINGS.depreciationDefaultUsefulLifeMonths;
  }
  return Math.min(240, Math.max(1, Math.floor(parsed)));
}

function normalizeDepreciationDefaultResidualPercent(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ADMIN_SETTINGS.depreciationDefaultResidualPercent;
  }
  return Math.min(95, Math.max(0, Math.floor(parsed)));
}

function normalizeStringList(value: unknown, fallback: string[]) {
  const rawList = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];

  const list = rawList
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, 40);

  return list.length > 0 ? list : [...fallback];
}

function normalizeBool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeChecklistTemplateKey(value: unknown, fallbackLabel: string, index: number) {
  const candidate = String(value ?? "").trim().toLowerCase();
  const fallback = String(fallbackLabel ?? "").trim().toLowerCase();
  const source = candidate || fallback;
  const slug = source
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (slug) return slug;
  return `template-${index + 1}`;
}

function normalizeChecklistTemplateWarningDays(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(3650, Math.max(0, Math.floor(parsed)));
}

function normalizeChecklistTemplateEntry(
  entry: unknown,
  index: number,
  folders: string[],
): VehicleChecklistTemplateSetting | null {
  if (typeof entry === "string") {
    const label = entry.trim();
    if (!label) return null;
    return {
      key: normalizeChecklistTemplateKey("", label, index),
      label: label.slice(0, 160),
      folder: folders[0] ?? "Unsorted",
      required: true,
      allowNotRequired: true,
      expiryRequired: false,
      expiryWarningDays: null,
      isActive: true,
    };
  }

  if (!entry || typeof entry !== "object") return null;
  const value = entry as Record<string, unknown>;
  const label = String(value.label ?? "").trim();
  if (!label) return null;
  const folderText = String(value.folder ?? "").trim();

  return {
    key: normalizeChecklistTemplateKey(value.key, label, index),
    label: label.slice(0, 160),
    folder: (folderText || folders[0] || "Unsorted").slice(0, 80),
    required: normalizeBool(value.required, true),
    allowNotRequired: normalizeBool(
      value.allowNotRequired ?? value.allow_not_required,
      true,
    ),
    expiryRequired: normalizeBool(
      value.expiryRequired ?? value.expiry_required,
      false,
    ),
    expiryWarningDays: normalizeChecklistTemplateWarningDays(
      value.expiryWarningDays ?? value.expiry_warning_days,
    ),
    isActive: normalizeBool(value.isActive ?? value.is_active, true),
  };
}

function normalizeChecklistTemplates(
  value: unknown,
  fallbackLegacyItems: string[],
  folders: string[],
) {
  const rawList = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n|,|;/)
      : [];

  const normalized = rawList
    .map((entry, index) => normalizeChecklistTemplateEntry(entry, index, folders))
    .filter((entry): entry is VehicleChecklistTemplateSetting => Boolean(entry))
    .slice(0, 80);

  if (normalized.length > 0) {
    const deduped: VehicleChecklistTemplateSetting[] = [];
    const seen = new Set<string>();
    for (const template of normalized) {
      const key = `${template.key.toLowerCase()}::${template.label.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(template);
    }
    if (deduped.length > 0) return deduped;
  }

  const legacy = fallbackLegacyItems
    .map((entry, index) => normalizeChecklistTemplateEntry(entry, index, folders))
    .filter((entry): entry is VehicleChecklistTemplateSetting => Boolean(entry));
  if (legacy.length > 0) return legacy;

  return DEFAULT_ADMIN_SETTINGS.vehicleChecklistTemplates.map((template) => ({ ...template }));
}

function normalizeSettings(raw: unknown): AdminSettings {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_ADMIN_SETTINGS };
  }

  const value = raw as Record<string, unknown>;
  const vehicleDocumentFolders = normalizeStringList(
    value.vehicleDocumentFolders,
    DEFAULT_ADMIN_SETTINGS.vehicleDocumentFolders,
  );
  const legacyTemplateItems = normalizeStringList(
    value.vehicleChecklistTemplateItems,
    DEFAULT_ADMIN_SETTINGS.vehicleChecklistTemplateItems,
  );
  const vehicleChecklistTemplates = normalizeChecklistTemplates(
    value.vehicleChecklistTemplates,
    legacyTemplateItems,
    vehicleDocumentFolders,
  );

  return {
    blockoutSupersedesBookings:
      typeof value.blockoutSupersedesBookings === "boolean"
        ? value.blockoutSupersedesBookings
        : DEFAULT_ADMIN_SETTINGS.blockoutSupersedesBookings,
    requireRestoreReason:
      typeof value.requireRestoreReason === "boolean"
        ? value.requireRestoreReason
        : DEFAULT_ADMIN_SETTINGS.requireRestoreReason,
    sendPickupReminder:
      typeof value.sendPickupReminder === "boolean"
        ? value.sendPickupReminder
        : DEFAULT_ADMIN_SETTINGS.sendPickupReminder,
    sendDropoffReminder:
      typeof value.sendDropoffReminder === "boolean"
        ? value.sendDropoffReminder
        : DEFAULT_ADMIN_SETTINGS.sendDropoffReminder,
    sendLateDropoffAlert:
      typeof value.sendLateDropoffAlert === "boolean"
        ? value.sendLateDropoffAlert
        : DEFAULT_ADMIN_SETTINGS.sendLateDropoffAlert,
    dayViewBookingLimit: normalizeDayViewBookingLimit(value.dayViewBookingLimit),
    contactNotificationEmails: normalizeNotificationEmails(value.contactNotificationEmails),
    contactNotifyCooldownMinutes: normalizeContactNotifyCooldownMinutes(
      value.contactNotifyCooldownMinutes,
    ),
    vehicleDocumentFolders,
    vehicleDocumentTypeOptions: normalizeStringList(
      value.vehicleDocumentTypeOptions,
      DEFAULT_ADMIN_SETTINGS.vehicleDocumentTypeOptions,
    ),
    vehicleChecklistTemplates,
    vehicleChecklistTemplateItems: vehicleChecklistTemplates.map((template) => template.label),
    maintenanceRemindersEnabled:
      typeof value.maintenanceRemindersEnabled === "boolean"
        ? value.maintenanceRemindersEnabled
        : DEFAULT_ADMIN_SETTINGS.maintenanceRemindersEnabled,
    maintenanceReminderLeadDays: normalizeMaintenanceReminderLeadDays(
      value.maintenanceReminderLeadDays,
    ),
    maintenanceDueSoonDays: normalizeMaintenanceDueSoonDays(
      value.maintenanceDueSoonDays,
    ),
    maintenanceDueSoonKm: normalizeMaintenanceDueSoonKm(
      value.maintenanceDueSoonKm,
    ),
    maintenanceCategories: normalizeStringList(
      value.maintenanceCategories,
      DEFAULT_ADMIN_SETTINGS.maintenanceCategories,
    ),
    depreciationDefaultMethod: normalizeDepreciationDefaultMethod(
      value.depreciationDefaultMethod,
    ),
    depreciationDefaultUsefulLifeMonths:
      normalizeDepreciationDefaultUsefulLifeMonths(
        value.depreciationDefaultUsefulLifeMonths,
      ),
    depreciationDefaultResidualPercent:
      normalizeDepreciationDefaultResidualPercent(
        value.depreciationDefaultResidualPercent,
      ),
  };
}

function parseStoredContent(content: unknown): AdminSettings {
  if (typeof content !== "string" || !content.trim()) {
    return { ...DEFAULT_ADMIN_SETTINGS };
  }

  try {
    return normalizeSettings(JSON.parse(content));
  } catch {
    return { ...DEFAULT_ADMIN_SETTINGS };
  }
}

function handleMissingTable(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  if (code === "42P01") {
    return NextResponse.json(
      {
        error: "SETTINGS_TABLE_MISSING",
        message: "Settings storage table is not installed. Apply schema.sql changes.",
      },
      { status: 500 },
    );
  }
  return null;
}

export async function GET() {
  const auth = await requireStaffOrAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const result = await dbQuery<{
      content: string;
      updated_at: string;
      updated_by_email: string | null;
    }>(
      "select d.content, d.updated_at, u.email as updated_by_email from admin_documents d left join users u on u.id = d.updated_by where d.key = $1",
      [SETTINGS_KEY],
    );

    const row = result.rows[0] ?? null;
    return NextResponse.json({
      settings: parseStoredContent(row?.content),
      updatedAt: row?.updated_at ?? null,
      updatedByEmail: row?.updated_by_email ?? null,
    });
  } catch (error) {
    const response = handleMissingTable(error);
    if (response) return response;
    logError("api.admin.settings.GET", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const settings = normalizeSettings(body?.settings);

  try {
    const result = await dbQuery<{
      content: string;
      updated_at: string;
      updated_by: string | null;
    }>(
      "insert into admin_documents (key, content, updated_by) values ($1, $2, $3) on conflict (key) do update set content = excluded.content, updated_by = excluded.updated_by, updated_at = now() returning content, updated_at, updated_by",
      [SETTINGS_KEY, JSON.stringify(settings), actor.userId],
    );

    return NextResponse.json({
      ok: true,
      settings: parseStoredContent(result.rows[0]?.content),
      updatedAt: result.rows[0]?.updated_at ?? null,
    });
  } catch (error) {
    const response = handleMissingTable(error);
    if (response) return response;
    logError("api.admin.settings.PATCH", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
