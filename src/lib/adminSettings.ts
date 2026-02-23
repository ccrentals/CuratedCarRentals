import { dbQuery } from "@/lib/db";

export type AdminSettings = {
  blockoutSupersedesBookings: boolean;
  requireRestoreReason: boolean;
  sendPickupReminder: boolean;
  sendDropoffReminder: boolean;
  sendLateDropoffAlert: boolean;
  dayViewBookingLimit: number | "all";
  contactNotificationEmails: string;
  contactNotifyCooldownMinutes: number;
  vehicleDocumentFolders: string[];
  vehicleChecklistTemplateItems: string[];
  maintenanceRemindersEnabled: boolean;
  maintenanceReminderLeadDays: number;
  maintenanceDueSoonDays: number;
  maintenanceDueSoonKm: number;
  maintenanceCategories: string[];
  depreciationDefaultMethod: "STRAIGHT_LINE";
  depreciationDefaultUsefulLifeMonths: number;
  depreciationDefaultResidualPercent: number;
};

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  blockoutSupersedesBookings: false,
  requireRestoreReason: true,
  sendPickupReminder: true,
  sendDropoffReminder: false,
  sendLateDropoffAlert: false,
  dayViewBookingLimit: 5,
  contactNotificationEmails: "",
  contactNotifyCooldownMinutes: 10,
  vehicleDocumentFolders: ["Paperwork", "Insurance", "Registration", "Other"],
  vehicleChecklistTemplateItems: [
    "Insurance Certificate",
    "Registration",
    "Roadside Assistance",
  ],
  maintenanceRemindersEnabled: false,
  maintenanceReminderLeadDays: 7,
  maintenanceDueSoonDays: 14,
  maintenanceDueSoonKm: 500,
  maintenanceCategories: [
    "SERVICE",
    "REPAIR",
    "INSPECTION",
    "REGISTRATION",
    "INSURANCE",
    "TIRE",
    "BRAKE",
    "BATTERY",
    "OTHER",
  ],
  depreciationDefaultMethod: "STRAIGHT_LINE",
  depreciationDefaultUsefulLifeMonths: 60,
  depreciationDefaultResidualPercent: 20,
};

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

function normalizeAdminSettings(raw: unknown): AdminSettings {
  if (!raw || typeof raw !== "object") {
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

export async function loadAdminSettings(): Promise<{
  settings: AdminSettings;
  source: "db" | "default";
}> {
  try {
    const result = await dbQuery<{ content: string }>(
      "select content from admin_documents where key = 'settings' limit 1",
    );
    const content = result.rows[0]?.content;
    if (!content || typeof content !== "string") {
      return { settings: { ...DEFAULT_ADMIN_SETTINGS }, source: "default" };
    }

    try {
      const parsed = JSON.parse(content);
      return { settings: normalizeAdminSettings(parsed), source: "db" };
    } catch {
      return { settings: { ...DEFAULT_ADMIN_SETTINGS }, source: "default" };
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "42P01") {
      return { settings: { ...DEFAULT_ADMIN_SETTINGS }, source: "default" };
    }
    throw error;
  }
}
