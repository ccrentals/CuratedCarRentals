import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { DEFAULT_ADMIN_SETTINGS } from "@/lib/adminSettings";
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

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

function normalizeSettings(raw: unknown): AdminSettings {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_ADMIN_SETTINGS };
  }

  const value = raw as Record<string, unknown>;

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
    vehicleDocumentFolders: normalizeStringList(
      value.vehicleDocumentFolders,
      DEFAULT_ADMIN_SETTINGS.vehicleDocumentFolders,
    ),
    vehicleChecklistTemplateItems: normalizeStringList(
      value.vehicleChecklistTemplateItems,
      DEFAULT_ADMIN_SETTINGS.vehicleChecklistTemplateItems,
    ),
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
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    logError("api.admin.settings.GET", error, { userId: session.userId });
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
      [SETTINGS_KEY, JSON.stringify(settings), session.userId],
    );

    return NextResponse.json({
      ok: true,
      settings: parseStoredContent(result.rows[0]?.content),
      updatedAt: result.rows[0]?.updated_at ?? null,
    });
  } catch (error) {
    const response = handleMissingTable(error);
    if (response) return response;
    logError("api.admin.settings.PATCH", error, { userId: session.userId });
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
