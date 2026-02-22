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
