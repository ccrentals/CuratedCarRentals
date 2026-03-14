import { dbQuery } from "@/lib/db";

export type VehicleChecklistTemplateSetting = {
  key: string;
  label: string;
  folder: string;
  required: boolean;
  allowNotRequired: boolean;
  expiryRequired: boolean;
  expiryWarningDays: number | null;
  isActive: boolean;
};

export const ADMIN_LOGIN_METHODS = ["clerk", "legacy"] as const;
export type AdminLoginMethod = (typeof ADMIN_LOGIN_METHODS)[number];
export const DEFAULT_ADMIN_LOGIN_METHOD: AdminLoginMethod = "clerk";

export type AdminSettings = {
  authLoginMethod: AdminLoginMethod;
  blockoutSupersedesBookings: boolean;
  requireRestoreReason: boolean;
  sendPickupReminder: boolean;
  sendDropoffReminder: boolean;
  sendLateDropoffAlert: boolean;
  dayViewBookingLimit: number | "all";
  contactNotificationEmails: string;
  contactNotifyCooldownMinutes: number;
  vehicleDocumentFolders: string[];
  vehicleDocumentTypeOptions: string[];
  vehicleChecklistTemplates: VehicleChecklistTemplateSetting[];
  vehicleChecklistTemplateItems: string[];
  maintenanceRemindersEnabled: boolean;
  maintenanceReminderLeadDays: number;
  maintenanceDueSoonDays: number;
  maintenanceDueSoonKm: number;
  maintenanceCategories: string[];
  maintenancePriorities: string[];
  depreciationDefaultMethod: "STRAIGHT_LINE";
  depreciationDefaultUsefulLifeMonths: number;
  depreciationDefaultResidualPercent: number;
};

export type AdminSettingsField =
  | "contactNotificationEmails"
  | "dayViewBookingLimit"
  | "contactNotifyCooldownMinutes"
  | "vehicleDocumentFolders"
  | "vehicleDocumentTypeOptions"
  | "vehicleChecklistTemplates"
  | "maintenanceReminderLeadDays"
  | "maintenanceDueSoonDays"
  | "maintenanceDueSoonKm"
  | "maintenanceCategories"
  | "maintenancePriorities"
  | "depreciationDefaultUsefulLifeMonths"
  | "depreciationDefaultResidualPercent";

export type AdminSettingsFieldErrors = Partial<Record<AdminSettingsField, string>>;

export type AdminSettingsValidationResult = {
  settings: AdminSettings;
  fieldErrors: AdminSettingsFieldErrors;
};

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  authLoginMethod: DEFAULT_ADMIN_LOGIN_METHOD,
  blockoutSupersedesBookings: false,
  requireRestoreReason: true,
  sendPickupReminder: true,
  sendDropoffReminder: false,
  sendLateDropoffAlert: false,
  dayViewBookingLimit: 5,
  contactNotificationEmails: "",
  contactNotifyCooldownMinutes: 10,
  vehicleDocumentFolders: ["Paperwork", "Insurance", "Registration", "Other"],
  vehicleDocumentTypeOptions: [
    "Registration",
    "Insurance Certificate",
    "Inspection Report",
    "Service Invoice",
    "Receipt",
    "Photo",
    "Other",
  ],
  vehicleChecklistTemplates: [
    {
      key: "insurance-certificate",
      label: "Insurance Certificate",
      folder: "Insurance",
      required: true,
      allowNotRequired: true,
      expiryRequired: true,
      expiryWarningDays: 30,
      isActive: true,
    },
    {
      key: "registration",
      label: "Registration",
      folder: "Registration",
      required: true,
      allowNotRequired: true,
      expiryRequired: true,
      expiryWarningDays: 30,
      isActive: true,
    },
    {
      key: "roadside-assistance",
      label: "Roadside Assistance",
      folder: "Paperwork",
      required: false,
      allowNotRequired: true,
      expiryRequired: false,
      expiryWarningDays: null,
      isActive: true,
    },
  ],
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
  maintenancePriorities: ["LOW", "NORMAL", "HIGH", "URGENT"],
  depreciationDefaultMethod: "STRAIGHT_LINE",
  depreciationDefaultUsefulLifeMonths: 60,
  depreciationDefaultResidualPercent: 20,
};

export function normalizeAdminLoginMethod(value: unknown): AdminLoginMethod {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "legacy") {
    return "legacy";
  }
  return "clerk";
}

function cloneDefaultAdminSettings(): AdminSettings {
  return {
    ...DEFAULT_ADMIN_SETTINGS,
    vehicleDocumentFolders: [...DEFAULT_ADMIN_SETTINGS.vehicleDocumentFolders],
    vehicleDocumentTypeOptions: [...DEFAULT_ADMIN_SETTINGS.vehicleDocumentTypeOptions],
    vehicleChecklistTemplates: cloneDefaultChecklistTemplates(),
    vehicleChecklistTemplateItems: [...DEFAULT_ADMIN_SETTINGS.vehicleChecklistTemplateItems],
    maintenanceCategories: [...DEFAULT_ADMIN_SETTINGS.maintenanceCategories],
    maintenancePriorities: [...DEFAULT_ADMIN_SETTINGS.maintenancePriorities],
  };
}

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
  return splitDelimitedEntries(value).slice(0, 25).join(", ");
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

function normalizeMaintenancePriorityList(value: unknown, fallback: string[]) {
  const list = normalizeStringList(value, fallback)
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    deduped.push(entry);
  }
  return deduped.length > 0 ? deduped : [...fallback];
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
  const list = splitDelimitedEntries(value).slice(0, 40);

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

function splitDelimitedEntries(value: unknown) {
  const rawList = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];

  return rawList
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function hasExplicitListValue(value: unknown) {
  return Array.isArray(value) || typeof value === "string";
}

function validateIntegerRange(
  value: unknown,
  min: number,
  max: number,
  label: string,
) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    return `${label} must be a whole number between ${min} and ${max}.`;
  }
  return null;
}

function isValidEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
  const folderOptions = folders.filter(Boolean);
  const fallbackFolder = folderOptions[0] ?? "Unsorted";
  const folder = folderOptions.includes(folderText) ? folderText : fallbackFolder;

  return {
    key: normalizeChecklistTemplateKey(value.key, label, index),
    label: label.slice(0, 160),
    folder: folder.slice(0, 80),
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

function cloneDefaultChecklistTemplates() {
  return DEFAULT_ADMIN_SETTINGS.vehicleChecklistTemplates.map((template) => ({
    ...template,
  }));
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

  return cloneDefaultChecklistTemplates();
}

export function normalizeAdminSettingsValue(raw: unknown): AdminSettings {
  if (!raw || typeof raw !== "object") {
    return cloneDefaultAdminSettings();
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
    authLoginMethod: normalizeAdminLoginMethod(
      value.authLoginMethod ?? value.auth_login_method,
    ),
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
    maintenancePriorities: normalizeMaintenancePriorityList(
      value.maintenancePriorities,
      DEFAULT_ADMIN_SETTINGS.maintenancePriorities,
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

export function validateAdminSettingsValue(raw: unknown): AdminSettingsValidationResult {
  const fieldErrors: AdminSettingsFieldErrors = {};

  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;

    if (typeof value.contactNotificationEmails === "string") {
      const notificationRecipients = splitDelimitedEntries(value.contactNotificationEmails);
      const invalidEmails = notificationRecipients.filter(
        (entry) => !isValidEmailAddress(entry),
      );
      const notificationEmailErrors: string[] = [];
      if (invalidEmails.length > 0) {
        notificationEmailErrors.push(
          invalidEmails.length === 1
            ? `Enter a valid email address. "${invalidEmails[0]}" is not valid.`
            : `Enter valid email addresses. Invalid entries: ${invalidEmails.join(", ")}.`,
        );
      }
      if (notificationRecipients.length > 25) {
        notificationEmailErrors.push("Keep the notification recipient list to 25 email addresses or fewer.");
      }
      if (notificationEmailErrors.length > 0) {
        fieldErrors.contactNotificationEmails = notificationEmailErrors.join(" ");
      }
    }

    if (
      hasExplicitListValue(value.vehicleDocumentFolders) &&
      splitDelimitedEntries(value.vehicleDocumentFolders).length < 1
    ) {
      fieldErrors.vehicleDocumentFolders = "Add at least one vehicle document folder.";
    }

    if (
      hasExplicitListValue(value.vehicleDocumentTypeOptions) &&
      splitDelimitedEntries(value.vehicleDocumentTypeOptions).length < 1
    ) {
      fieldErrors.vehicleDocumentTypeOptions = "Add at least one vehicle document type.";
    }

    if (
      hasExplicitListValue(value.maintenanceCategories) &&
      splitDelimitedEntries(value.maintenanceCategories).length < 1
    ) {
      fieldErrors.maintenanceCategories = "Add at least one maintenance category.";
    }

    if (
      hasExplicitListValue(value.maintenancePriorities) &&
      splitDelimitedEntries(value.maintenancePriorities).length < 1
    ) {
      fieldErrors.maintenancePriorities = "Add at least one maintenance priority.";
    }

    if (Array.isArray(value.vehicleChecklistTemplates)) {
      const hasBlankTemplate = value.vehicleChecklistTemplates.some((entry) => {
        if (typeof entry === "string") return !entry.trim();
        if (!entry || typeof entry !== "object") return true;
        return !String((entry as { label?: unknown }).label ?? "").trim();
      });
      if (hasBlankTemplate) {
        fieldErrors.vehicleChecklistTemplates =
          "Checklist template labels cannot be blank. Remove blank rows or add a label.";
      }
    }

    if (value.dayViewBookingLimit !== undefined) {
      const rawValue = value.dayViewBookingLimit;
      const isAll =
        rawValue === "all" ||
        (typeof rawValue === "string" && rawValue.trim().toLowerCase() === "all");
      if (!isAll) {
        const error = validateIntegerRange(rawValue, 1, 50, "Day View booking limit");
        if (error) {
          fieldErrors.dayViewBookingLimit = error;
        }
      }
    }

    if (value.contactNotifyCooldownMinutes !== undefined) {
      const error = validateIntegerRange(
        value.contactNotifyCooldownMinutes,
        1,
        120,
        "Contact notification cooldown",
      );
      if (error) {
        fieldErrors.contactNotifyCooldownMinutes = error;
      }
    }

    if (value.maintenanceReminderLeadDays !== undefined) {
      const error = validateIntegerRange(
        value.maintenanceReminderLeadDays,
        1,
        90,
        "Maintenance reminder lead time",
      );
      if (error) {
        fieldErrors.maintenanceReminderLeadDays = error;
      }
    }

    if (value.maintenanceDueSoonDays !== undefined) {
      const error = validateIntegerRange(
        value.maintenanceDueSoonDays,
        1,
        180,
        "Maintenance due-soon days",
      );
      if (error) {
        fieldErrors.maintenanceDueSoonDays = error;
      }
    }

    if (value.maintenanceDueSoonKm !== undefined) {
      const error = validateIntegerRange(
        value.maintenanceDueSoonKm,
        0,
        25000,
        "Maintenance due-soon mileage",
      );
      if (error) {
        fieldErrors.maintenanceDueSoonKm = error;
      }
    }

    if (value.depreciationDefaultUsefulLifeMonths !== undefined) {
      const error = validateIntegerRange(
        value.depreciationDefaultUsefulLifeMonths,
        1,
        240,
        "Depreciation useful life",
      );
      if (error) {
        fieldErrors.depreciationDefaultUsefulLifeMonths = error;
      }
    }

    if (value.depreciationDefaultResidualPercent !== undefined) {
      const error = validateIntegerRange(
        value.depreciationDefaultResidualPercent,
        0,
        95,
        "Depreciation residual value",
      );
      if (error) {
        fieldErrors.depreciationDefaultResidualPercent = error;
      }
    }
  }

  return {
    settings: normalizeAdminSettingsValue(raw),
    fieldErrors,
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
      return { settings: cloneDefaultAdminSettings(), source: "default" };
    }

    try {
      const parsed = JSON.parse(content);
      return { settings: normalizeAdminSettingsValue(parsed), source: "db" };
    } catch {
      return { settings: cloneDefaultAdminSettings(), source: "default" };
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "42P01") {
      return { settings: cloneDefaultAdminSettings(), source: "default" };
    }
    throw error;
  }
}
