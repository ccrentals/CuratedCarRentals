"use client";

import { useEffect, useRef, useState } from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { buttonStyles } from "@/components/ui/Button";
import type { AdminSettings, AdminSettingsFieldErrors } from "@/lib/adminSettings";
import type {
  NotificationConfigurationHealth,
  NotificationOwnershipDirectory,
  NotificationOwnershipOption,
  NotificationOwnershipResolution,
  OperationalNotificationRoutingSummary,
} from "@/lib/notifications/operationalRouting";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type VehicleChecklistTemplateSetting = {
  key: string;
  label: string;
  folder: string;
  required: boolean;
  allowNotRequired: boolean;
  expiryRequired: boolean;
  expiryWarningDays: number | null;
  isActive: boolean;
};

type ServiceType = {
  id: string;
  name: string;
  description: string | null;
  defaultIntervalDays: number | null;
  defaultIntervalOdometer: number | null;
  isActive: boolean;
};

type AdminSettingsFormProps = {
  initialSettings: AdminSettings;
  initialOwnership: NotificationOwnershipDirectory;
  initialOperationalRouting: OperationalNotificationRoutingSummary;
  initialConfigurationHealth: NotificationConfigurationHealth;
  updatedAt: string | null;
  updatedByEmail: string | null;
  activeTab: AdminSettingsFormTab;
  disabled?: boolean;
  showDeveloperControls?: boolean;
  effectiveAuthLoginMethod: "clerk" | "legacy";
  authLoginMethodSource: "env-override" | "db" | "default";
};

export type AdminSettingsFormTab =
  | "general"
  | "notifications"
  | "maintenance"
  | "documents"
  | "depreciation";

type ToggleField = {
  key:
    | "blockoutSupersedesBookings"
    | "requireRestoreReason"
    | "sendPickupReminder"
    | "sendDropoffReminder"
    | "sendLateDropoffAlert"
    | "maintenanceRemindersEnabled";
  label: string;
  description: string;
};

const TOGGLE_FIELDS: ToggleField[] = [
  {
    key: "blockoutSupersedesBookings",
    label: "Blockout supersedes bookings",
    description:
      "When enabled, blockouts can trigger booking cancellation workflows instead of only blocking new availability.",
  },
  {
    key: "requireRestoreReason",
    label: "Require restore reason",
    description: "When enabled, restoring a deleted manual payment will require a reason.",
  },
  {
    key: "sendPickupReminder",
    label: "Send pickup-day email",
    description: "Enable automatic customer reminders on pickup day.",
  },
  {
    key: "sendDropoffReminder",
    label: "Send dropoff-day email",
    description: "Enable automatic customer reminders on dropoff day.",
  },
  {
    key: "sendLateDropoffAlert",
    label: "Send late dropoff alert",
    description:
      "Enable automatic late-return alerts when dropoff is missed (time-based logic can be expanded later).",
  },
          {
            key: "maintenanceRemindersEnabled",
            label: "Enable maintenance reminders",
            description:
      "When enabled, the maintenance reminder cron route creates due-soon reminder records. This switch does not send customer emails by itself.",
          },
];

const TOGGLE_FIELD_TAB_MAP: Record<ToggleField["key"], AdminSettingsFormTab> = {
  blockoutSupersedesBookings: "general",
  requireRestoreReason: "general",
  sendPickupReminder: "notifications",
  sendDropoffReminder: "notifications",
  sendLateDropoffAlert: "notifications",
  maintenanceRemindersEnabled: "maintenance",
};

const SETTINGS_FIELD_TAB_LABELS: Record<
  keyof AdminSettingsFieldErrors,
  { key: AdminSettingsFormTab; label: string }
> = {
  contactNotificationEmails: { key: "notifications", label: "Notifications" },
  dayViewBookingLimit: { key: "general", label: "General" },
  contactNotifyCooldownMinutes: { key: "notifications", label: "Notifications" },
  primaryAdminUserId: { key: "notifications", label: "Notifications" },
  primaryDeveloperUserId: { key: "notifications", label: "Notifications" },
  defaultOperationalNotificationEmail: { key: "notifications", label: "Notifications" },
  additionalOperationalNotificationEmails: { key: "notifications", label: "Notifications" },
  sendVehicleInspectionWarningEmails: { key: "notifications", label: "Notifications" },
  vehicleDocumentFolders: { key: "documents", label: "Vehicle Docs" },
  vehicleDocumentTypeOptions: { key: "documents", label: "Vehicle Docs" },
  vehicleChecklistTemplates: { key: "documents", label: "Vehicle Docs" },
  maintenanceReminderLeadDays: { key: "maintenance", label: "Maintenance" },
  maintenanceDueSoonDays: { key: "maintenance", label: "Maintenance" },
  maintenanceDueSoonKm: { key: "maintenance", label: "Maintenance" },
  maintenanceCategories: { key: "maintenance", label: "Maintenance" },
  maintenancePriorities: { key: "maintenance", label: "Maintenance" },
  depreciationDefaultUsefulLifeMonths: { key: "depreciation", label: "Depreciation" },
  depreciationDefaultResidualPercent: { key: "depreciation", label: "Depreciation" },
  bookingMinimumRentalDays: { key: "general", label: "Booking Flow" },
};

const UNSAVED_SETTINGS_MESSAGE =
  "You have unsaved settings changes. Leave this page without saving?";
const SETTINGS_CHECKBOX_CLASS_NAME =
  "h-5 w-5 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]";

function buildChecklistTemplateItems(templates: VehicleChecklistTemplateSetting[]) {
  return templates
    .map((template) => template.label.trim())
    .filter(Boolean)
    .slice(0, 80);
}

function normalizeTemplateFolder(folder: string, folders: string[]) {
  const normalizedFolder = folder.trim();
  if (folders.includes(normalizedFolder)) {
    return normalizedFolder;
  }
  return folders[0] ?? "Paperwork";
}

function serializeSettingsSnapshot(settings: AdminSettings) {
  return JSON.stringify(settings);
}

function isOwnershipStatusWarning(status: NotificationOwnershipResolution["status"]) {
  return status === "not_found" || status === "inactive" || status === "wrong_role";
}

function filterOwnershipOptions(
  options: NotificationOwnershipOption[],
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter((option) =>
    [option.label, option.email ?? "", option.fullName ?? "", option.username ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

function ownershipStatusLabel(status: NotificationOwnershipResolution["status"]) {
  switch (status) {
    case "valid":
      return "Valid";
    case "missing":
      return "Missing";
    case "inactive":
      return "Inactive";
    case "wrong_role":
      return "Wrong role";
    default:
      return "Unavailable";
  }
}

function ownershipStatusClassName(status: NotificationOwnershipResolution["status"]) {
  if (status === "valid") {
    return "border-[var(--ccr-accent)]/45 bg-[var(--ccr-accent)]/10 text-[var(--ccr-text)]";
  }
  if (status === "missing") {
    return "border-slate-400/30 bg-slate-500/10 text-slate-200";
  }
  return "border-amber-400/40 bg-amber-500/10 text-amber-200";
}

export function AdminSettingsForm({
  initialSettings,
  initialOwnership,
  initialOperationalRouting,
  initialConfigurationHealth,
  updatedAt,
  updatedByEmail,
  activeTab,
  disabled,
  showDeveloperControls = false,
  effectiveAuthLoginMethod,
  authLoginMethodSource,
}: AdminSettingsFormProps) {
  const [settings, setSettings] = useState<AdminSettings>(initialSettings);
  const [ownership, setOwnership] = useState<NotificationOwnershipDirectory>(initialOwnership);
  const [operationalRouting, setOperationalRouting] =
    useState<OperationalNotificationRoutingSummary>(initialOperationalRouting);
  const [configurationHealth, setConfigurationHealth] =
    useState<NotificationConfigurationHealth>(initialConfigurationHealth);
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    serializeSettingsSnapshot(initialSettings),
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(updatedAt);
  const [lastUpdatedByEmail, setLastUpdatedByEmail] = useState<string | null>(updatedByEmail);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<AdminSettingsFieldErrors>({});
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [serviceTypesLoading, setServiceTypesLoading] = useState(false);
  const [serviceTypesLoaded, setServiceTypesLoaded] = useState(false);
  const [serviceTypesLoadError, setServiceTypesLoadError] = useState<string | null>(null);
  const [serviceTypesError, setServiceTypesError] = useState<string | null>(null);
  const [serviceTypesMessage, setServiceTypesMessage] = useState<string | null>(null);
  const [serviceTypeDraft, setServiceTypeDraft] = useState({
    name: "",
    description: "",
    defaultIntervalDays: "",
    defaultIntervalOdometer: "",
  });
  const [editingServiceTypeId, setEditingServiceTypeId] = useState<string | null>(null);
  const [editingServiceTypeDraft, setEditingServiceTypeDraft] = useState({
    name: "",
    description: "",
    defaultIntervalDays: "",
    defaultIntervalOdometer: "",
    isActive: true,
  });
  const dirtyRef = useRef(false);
  const navigationApprovedRef = useRef(false);
  const [ownershipSearch, setOwnershipSearch] = useState({
    primaryAdmin: "",
    primaryDeveloper: "",
  });
  const isGeneralTab = activeTab === "general";
  const isNotificationsTab = activeTab === "notifications";
  const isMaintenanceTab = activeTab === "maintenance";
  const isDocumentsTab = activeTab === "documents";
  const isDepreciationTab = activeTab === "depreciation";

  useEffect(() => {
    setSettings(initialSettings);
    setOwnership(initialOwnership);
    setOperationalRouting(initialOperationalRouting);
    setConfigurationHealth(initialConfigurationHealth);
    setSavedSnapshot(serializeSettingsSnapshot(initialSettings));
    setFieldErrors({});
    setError(null);
    setSuccess(null);
    setConflictMessage(null);
  }, [initialConfigurationHealth, initialOperationalRouting, initialOwnership, initialSettings]);

  useEffect(() => {
    setLastUpdatedAt(updatedAt);
  }, [updatedAt]);

  useEffect(() => {
    setLastUpdatedByEmail(updatedByEmail);
  }, [updatedByEmail]);

  async function loadServiceTypes() {
    setServiceTypesLoading(true);
    setServiceTypesLoadError(null);
    try {
      const response = await fetch("/api/admin/maintenance/service-types", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: ServiceType[];
      };
      if (!response.ok || !payload.ok) {
        setServiceTypesLoadError(payload.error ?? "Failed to load service types.");
        setServiceTypes([]);
        return;
      }
      setServiceTypes(Array.isArray(payload.items) ? payload.items : []);
    } catch {
      setServiceTypesLoadError("Failed to load service types.");
      setServiceTypes([]);
    } finally {
      setServiceTypesLoaded(true);
      setServiceTypesLoading(false);
    }
  }

  useEffect(() => {
    if (!isMaintenanceTab || serviceTypesLoading || serviceTypesLoaded) return;
    void loadServiceTypes();
  }, [isMaintenanceTab, serviceTypesLoaded, serviceTypesLoading]);

  const currentSnapshot = serializeSettingsSnapshot(settings);
  const isDirty = currentSnapshot !== savedSnapshot;

  useEffect(() => {
    dirtyRef.current = isDirty;
    if (!isDirty) {
      navigationApprovedRef.current = false;
      return;
    }
    setSuccess(null);
    setError(null);
    setConflictMessage(null);
  }, [currentSnapshot, isDirty]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current || navigationApprovedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function handleDocumentClick(event: MouseEvent) {
      if (!dirtyRef.current || navigationApprovedRef.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      const nextLocation = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      const currentLocation = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;

      if (nextLocation === currentLocation) return;
      if (nextUrl.origin !== currentUrl.origin) {
        const shouldLeave = window.confirm(UNSAVED_SETTINGS_MESSAGE);
        if (!shouldLeave) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        navigationApprovedRef.current = true;
        return;
      }

      const shouldNavigate = window.confirm(UNSAVED_SETTINGS_MESSAGE);
      if (!shouldNavigate) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      navigationApprovedRef.current = true;
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, []);

  async function save() {
    if (disabled) return;
    if (saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    setConflictMessage(null);
    setFieldErrors({});

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          settings,
          baseUpdatedAt: lastUpdatedAt,
          csrfToken,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        ok?: boolean;
        errorCode?: string;
        settings?: AdminSettings;
        ownership?: NotificationOwnershipDirectory;
        operationalRouting?: OperationalNotificationRoutingSummary;
        configurationHealth?: NotificationConfigurationHealth;
        updatedAt?: string | null;
        updatedByEmail?: string | null;
        fieldErrors?: AdminSettingsFieldErrors;
      };

      if (!response.ok || !data.ok) {
        if (data.settings) {
          setSettings(data.settings);
          setSavedSnapshot(serializeSettingsSnapshot(data.settings));
        }
        if ("updatedAt" in data) {
          setLastUpdatedAt(data.updatedAt ?? null);
        }
        if ("updatedByEmail" in data) {
          setLastUpdatedByEmail(data.updatedByEmail ?? null);
        }
        if (data.ownership) {
          setOwnership(data.ownership);
        }
        if (data.operationalRouting) {
          setOperationalRouting(data.operationalRouting);
        }
        if (data.configurationHealth) {
          setConfigurationHealth(data.configurationHealth);
        }
        setFieldErrors(data.fieldErrors ?? {});
        if (data.error === "SETTINGS_CONFLICT") {
          setError(null);
          setConflictMessage(
            "Newer settings were detected and the latest server values were loaded. Review them, re-apply any needed edits, and save again.",
          );
        } else {
          setError(data.message ?? data.error ?? "Failed to save settings.");
        }
        return;
      }

      if (data.settings) {
        setSettings(data.settings);
        setSavedSnapshot(serializeSettingsSnapshot(data.settings));
      }
      if (data.ownership) {
        setOwnership(data.ownership);
      }
      if (data.operationalRouting) {
        setOperationalRouting(data.operationalRouting);
      }
      if (data.configurationHealth) {
        setConfigurationHealth(data.configurationHealth);
      }
      setLastUpdatedAt(data.updatedAt ?? null);
      setLastUpdatedByEmail(data.updatedByEmail ?? null);
      setFieldErrors({});
      setSuccess("Settings saved.");
    } catch {
      setError("Unable to save settings right now. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const validationEntries = Object.entries(fieldErrors).filter((entry): entry is [keyof AdminSettingsFieldErrors, string] =>
    Boolean(entry[1]),
  );
  const validationMessages = validationEntries.map(([, message]) => message);
  const validationTabs = validationEntries.reduce<{ key: AdminSettingsFormTab; label: string }[]>(
    (tabs, [field]) => {
      const tab = SETTINGS_FIELD_TAB_LABELS[field];
      if (!tab || tabs.some((entry) => entry.key === tab.key)) {
        return tabs;
      }
      tabs.push(tab);
      return tabs;
    },
    [],
  );
  const hiddenValidationTabs = validationTabs.filter((tab) => tab.key !== activeTab);

  async function createServiceType() {
    if (disabled) return;

    const name = serviceTypeDraft.name.trim();
    if (!name) {
      setServiceTypesError("Service type name is required.");
      return;
    }

    setServiceTypesError(null);
    setServiceTypesMessage(null);
    const csrfToken = await ensureCsrfToken();
    const response = await fetch("/api/admin/maintenance/service-types", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        name,
        description: serviceTypeDraft.description.trim() || null,
        defaultIntervalDays: serviceTypeDraft.defaultIntervalDays
          ? Number(serviceTypeDraft.defaultIntervalDays)
          : null,
        defaultIntervalOdometer: serviceTypeDraft.defaultIntervalOdometer
          ? Number(serviceTypeDraft.defaultIntervalOdometer)
          : null,
        isActive: true,
        csrfToken,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setServiceTypesError(payload.error ?? "Failed to create service type.");
      return;
    }

    setServiceTypesMessage("Service type created.");
    setServiceTypeDraft({
      name: "",
      description: "",
      defaultIntervalDays: "",
      defaultIntervalOdometer: "",
    });
    await loadServiceTypes();
  }

  function beginEditServiceType(item: ServiceType) {
    setEditingServiceTypeId(item.id);
    setEditingServiceTypeDraft({
      name: item.name,
      description: item.description ?? "",
      defaultIntervalDays: item.defaultIntervalDays === null ? "" : String(item.defaultIntervalDays),
      defaultIntervalOdometer:
        item.defaultIntervalOdometer === null ? "" : String(item.defaultIntervalOdometer),
      isActive: item.isActive,
    });
    setServiceTypesError(null);
    setServiceTypesMessage(null);
  }

  async function saveEditedServiceType() {
    if (!editingServiceTypeId) return;
    const name = editingServiceTypeDraft.name.trim();
    if (!name) {
      setServiceTypesError("Service type name is required.");
      return;
    }

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/maintenance/service-types/${editingServiceTypeId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        name,
        description: editingServiceTypeDraft.description.trim() || null,
        defaultIntervalDays: editingServiceTypeDraft.defaultIntervalDays
          ? Number(editingServiceTypeDraft.defaultIntervalDays)
          : null,
        defaultIntervalOdometer: editingServiceTypeDraft.defaultIntervalOdometer
          ? Number(editingServiceTypeDraft.defaultIntervalOdometer)
          : null,
        isActive: editingServiceTypeDraft.isActive,
        csrfToken,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setServiceTypesError(payload.error ?? "Failed to update service type.");
      return;
    }

    setServiceTypesMessage("Service type updated.");
    setEditingServiceTypeId(null);
    await loadServiceTypes();
  }

  function updateChecklistTemplates(
    updater: (
      currentTemplates: VehicleChecklistTemplateSetting[],
      availableFolders: string[],
    ) => VehicleChecklistTemplateSetting[],
  ) {
    setSettings((current) => {
      const folderOptions =
        current.vehicleDocumentFolders.length > 0
          ? current.vehicleDocumentFolders
          : ["Paperwork"];
      const nextTemplates = updater(current.vehicleChecklistTemplates, folderOptions).slice(0, 80);

      return {
        ...current,
        vehicleChecklistTemplates: nextTemplates,
        vehicleChecklistTemplateItems: buildChecklistTemplateItems(nextTemplates),
      };
    });
  }

  const dayViewBookingLimitValue =
    settings.dayViewBookingLimit === "all" ? "all" : String(settings.dayViewBookingLimit);
  const maintenanceLeadDaysValue = String(settings.maintenanceReminderLeadDays);
  const maintenanceDueSoonDaysValue = String(settings.maintenanceDueSoonDays);
  const maintenanceDueSoonKmValue = String(settings.maintenanceDueSoonKm);
  const depreciationUsefulLifeValue = String(
    settings.depreciationDefaultUsefulLifeMonths,
  );
  const depreciationResidualPercentValue = String(
    settings.depreciationDefaultResidualPercent,
  );
  const checklistTemplateFolderOptions =
    settings.vehicleDocumentFolders.length > 0
      ? settings.vehicleDocumentFolders
      : ["Paperwork"];
  const vehicleDocumentFoldersValue = settings.vehicleDocumentFolders.join("\n");
  const vehicleDocumentTypeOptionsValue = settings.vehicleDocumentTypeOptions.join("\n");
  const maintenanceCategoriesValue = settings.maintenanceCategories.join("\n");
  const maintenancePrioritiesValue = settings.maintenancePriorities.join("\n");
  const visibleToggleFields = TOGGLE_FIELDS.filter(
    (field) => TOGGLE_FIELD_TAB_MAP[field.key] === activeTab,
  );
  const isAuthLoginMethodOverridden = authLoginMethodSource === "env-override";
  const filteredPrimaryAdminOptions = filterOwnershipOptions(
    ownership.primaryAdminOptions,
    ownershipSearch.primaryAdmin,
  );
  const filteredPrimaryDeveloperOptions = filterOwnershipOptions(
    ownership.primaryDeveloperOptions,
    ownershipSearch.primaryDeveloper,
  );
  const selectedPrimaryAdminMissingOption =
    settings.primaryAdminUserId &&
    !ownership.primaryAdminOptions.some((option) => option.id === settings.primaryAdminUserId);
  const selectedPrimaryDeveloperMissingOption =
    settings.primaryDeveloperUserId &&
    !ownership.primaryDeveloperOptions.some((option) => option.id === settings.primaryDeveloperUserId);
  const additionalOperationalNotificationEmailsValue =
    settings.additionalOperationalNotificationEmails.join("\n");
  return (
    <section
      data-testid="admin-settings"
      className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--ccr-text)]">Platform Settings</h2>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Configure operational behavior and notification switches for admin workflows.
          </p>
        </div>
        <div className="text-xs text-[var(--ccr-muted)]">
          <div>
            Updated:{" "}
            {lastUpdatedAt ? (
              <DateTimeInline value={lastUpdatedAt} className="inline-flex font-semibold text-[var(--ccr-text)]" />
            ) : (
              <span className="font-semibold text-[var(--ccr-text)]">Never</span>
            )}
          </div>
          <div>
            By: <span className="font-semibold text-[var(--ccr-text)]">{lastUpdatedByEmail ?? "System"}</span>
          </div>
        </div>
      </div>

      {validationMessages.length > 0 ? (
        <div
          data-testid="settings-validation-errors"
          role="alert"
          className="mt-4 rounded-xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100"
        >
          <p className="font-semibold">Fix these settings before saving:</p>
          {validationTabs.length > 0 ? (
            <p className="mt-2 text-xs text-rose-100/90">
              Review tab{validationTabs.length === 1 ? "" : "s"}:{" "}
              <span className="font-semibold">
                {validationTabs.map((tab) => tab.label).join(", ")}
              </span>
              .
            </p>
          ) : null}
          {hiddenValidationTabs.length > 0 ? (
            <p className="mt-1 text-xs text-rose-100/90">
              Some issues are outside the current tab. Open{" "}
              <span className="font-semibold">
                {hiddenValidationTabs.map((tab) => tab.label).join(", ")}
              </span>{" "}
              and review those fields before saving again.
            </p>
          ) : null}
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {validationMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {showDeveloperControls && isGeneralTab ? (
          <div
            data-testid="settings-panel-general"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4"
          >
            <p className="text-sm font-semibold text-[var(--ccr-text)]">Primary Admin Login Method</p>
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">
              Both routes remain available. This changes the default Admin sign-in path.
            </p>
            <div className="mt-3 max-w-sm">
              <select
                value={settings.authLoginMethod}
                disabled={disabled || saving || isAuthLoginMethodOverridden}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    authLoginMethod: event.target.value === "legacy" ? "legacy" : "clerk",
                  }))
                }
                className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              >
                <option value="clerk">Clerk (recommended)</option>
                <option value="legacy">Legacy (fallback)</option>
              </select>
            </div>
            <p className="mt-2 text-xs text-[var(--ccr-muted)]">
              Saved preference:{" "}
              <span className="font-semibold text-[var(--ccr-text)]">
                {settings.authLoginMethod === "legacy" ? "Legacy" : "Clerk"}
              </span>
            </p>
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">
              Effective mode:{" "}
              <span className="font-semibold text-[var(--ccr-text)]">
                {effectiveAuthLoginMethod === "legacy" ? "Legacy" : "Clerk"}
              </span>
            </p>
            {isAuthLoginMethodOverridden ? (
              <p className="mt-2 text-xs font-semibold text-amber-300">
                This switch is unavailable because <code>AUTH_LOGIN_METHOD_OVERRIDE</code> is forcing
                the live mode. Remove the override to switch between Clerk and Legacy here.
              </p>
            ) : (
              <p className="mt-2 text-xs text-[var(--ccr-muted)]">
                Changes apply after clicking <span className="font-semibold">Save settings</span>.
              </p>
            )}
          </div>
        ) : null}

        <div
          data-testid="settings-panel-general"
          className={`${isGeneralTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Day View booking limit</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Controls how many bookings are shown first in Calendar Day View before “Show more”.
          </p>
          <div className="mt-3 max-w-xs">
            <select
              value={dayViewBookingLimitValue}
              disabled={disabled || saving}
              onChange={(event) => {
                const next = event.target.value;
                setSettings((current) => ({
                  ...current,
                  dayViewBookingLimit: next === "all" ? "all" : Number(next),
                }));
              }}
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="3">3 bookings</option>
              <option value="5">5 bookings</option>
              <option value="10">10 bookings</option>
              <option value="15">15 bookings</option>
              <option value="20">20 bookings</option>
              <option value="all">All bookings</option>
            </select>
            {fieldErrors.dayViewBookingLimit ? (
              <p className="mt-2 text-xs font-semibold text-rose-300">{fieldErrors.dayViewBookingLimit}</p>
            ) : null}
          </div>
        </div>

        <div
          data-testid="settings-panel-notifications"
          className={`${isNotificationsTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--ccr-text)]">Operational notification readiness</p>
                <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                  Review ownership, routing, and fallback health before enabling new warning delivery channels.
                </p>
              </div>
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                  configurationHealth.status === "ready"
                    ? "border-[var(--ccr-accent)]/45 bg-[var(--ccr-accent)]/10 text-[var(--ccr-text)]"
                    : "border-amber-400/40 bg-amber-500/10 text-amber-200"
                }`}
              >
                {configurationHealth.status === "ready" ? "Ready" : "Needs review"}
              </span>
            </div>
            {configurationHealth.warnings.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm text-amber-200">
                {configurationHealth.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-[var(--ccr-muted)]">
                Ownership and operational recipient settings are in a healthy state.
              </p>
            )}
          </div>
        </div>

        <div
          data-testid="settings-panel-notifications"
          className={`${isNotificationsTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--ccr-text)]">Notification ownership</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                Set the primary accounts responsible for operational notifications. This is separate from the
                <span className="font-semibold text-[var(--ccr-text)]"> Primary Admin Login Method</span> above.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--ccr-text)]">Primary admin account</p>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${ownershipStatusClassName(
                    ownership.primaryAdmin.status,
                  )}`}
                >
                  {ownershipStatusLabel(ownership.primaryAdmin.status)}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                Choose the active ADMIN or DEVELOPER account that owns operational admin notifications.
              </p>
              <input
                type="search"
                value={ownershipSearch.primaryAdmin}
                disabled={disabled || saving}
                placeholder="Search admin accounts"
                onChange={(event) =>
                  setOwnershipSearch((current) => ({ ...current, primaryAdmin: event.target.value }))
                }
                className="mt-3 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
              <select
                value={settings.primaryAdminUserId ?? ""}
                disabled={disabled || saving}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    primaryAdminUserId: event.target.value || null,
                  }))
                }
                className="mt-3 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              >
                <option value="">No primary admin account selected</option>
                {selectedPrimaryAdminMissingOption ? (
                  <option value={settings.primaryAdminUserId ?? ""}>{ownership.primaryAdmin.label}</option>
                ) : null}
                {filteredPrimaryAdminOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {fieldErrors.primaryAdminUserId ? (
                <p className="mt-2 text-xs font-semibold text-rose-300">{fieldErrors.primaryAdminUserId}</p>
              ) : null}
              <p
                className={`mt-2 text-xs ${
                  isOwnershipStatusWarning(ownership.primaryAdmin.status) ? "font-semibold text-amber-300" : "text-[var(--ccr-muted)]"
                }`}
              >
                {ownership.primaryAdmin.message}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--ccr-text)]">Primary developer account</p>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${ownershipStatusClassName(
                    ownership.primaryDeveloper.status,
                  )}`}
                >
                  {ownershipStatusLabel(ownership.primaryDeveloper.status)}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                Choose the active DEVELOPER account that owns developer-level notification routing and fallback.
              </p>
              <input
                type="search"
                value={ownershipSearch.primaryDeveloper}
                disabled={disabled || saving || !showDeveloperControls}
                placeholder="Search developer accounts"
                onChange={(event) =>
                  setOwnershipSearch((current) => ({ ...current, primaryDeveloper: event.target.value }))
                }
                className="mt-3 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
              <select
                value={settings.primaryDeveloperUserId ?? ""}
                disabled={disabled || saving || !showDeveloperControls}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    primaryDeveloperUserId: event.target.value || null,
                  }))
                }
                className="mt-3 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              >
                <option value="">No primary developer account selected</option>
                {selectedPrimaryDeveloperMissingOption ? (
                  <option value={settings.primaryDeveloperUserId ?? ""}>{ownership.primaryDeveloper.label}</option>
                ) : null}
                {filteredPrimaryDeveloperOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {!showDeveloperControls ? (
                <p className="mt-2 text-xs font-semibold text-amber-300">
                  Only DEVELOPER users can change the primary developer account.
                </p>
              ) : null}
              {fieldErrors.primaryDeveloperUserId ? (
                <p className="mt-2 text-xs font-semibold text-rose-300">{fieldErrors.primaryDeveloperUserId}</p>
              ) : null}
              <p
                className={`mt-2 text-xs ${
                  isOwnershipStatusWarning(ownership.primaryDeveloper.status) ? "font-semibold text-amber-300" : "text-[var(--ccr-muted)]"
                }`}
              >
                {ownership.primaryDeveloper.message}
              </p>
            </div>
          </div>
        </div>

        <div
          data-testid="settings-panel-notifications"
          className={`${isNotificationsTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Operational notification routing</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Configure the default operational notification email and any additional recipients used for routed vehicle inspection warnings and internal booking notification emails.
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Default operational email
              <input
                type="email"
                value={settings.defaultOperationalNotificationEmail}
                disabled={disabled || saving}
                placeholder="ops@example.com"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    defaultOperationalNotificationEmail: event.target.value,
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm normal-case tracking-normal text-[var(--ccr-text)]"
              />
              {fieldErrors.defaultOperationalNotificationEmail ? (
                <p className="mt-2 text-[11px] font-semibold normal-case tracking-normal text-rose-300">
                  {fieldErrors.defaultOperationalNotificationEmail}
                </p>
              ) : null}
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Additional operational recipients
              <textarea
                value={additionalOperationalNotificationEmailsValue}
                disabled={disabled || saving}
                rows={5}
                placeholder={"ops@example.com\nfleet@example.com"}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    additionalOperationalNotificationEmails: event.target.value
                      .split(/\n|,|;/)
                      .map((entry) => entry.trim())
                      .filter(Boolean)
                      .slice(0, 25),
                  }))
                }
                className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm normal-case tracking-normal text-[var(--ccr-text)]"
              />
              {fieldErrors.additionalOperationalNotificationEmails ? (
                <p className="mt-2 text-[11px] font-semibold normal-case tracking-normal text-rose-300">
                  {fieldErrors.additionalOperationalNotificationEmails}
                </p>
              ) : null}
            </label>
          </div>

          <label className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--ccr-border)] px-3 py-3 text-sm text-[var(--ccr-text)]">
            <input
              type="checkbox"
              checked={settings.sendVehicleInspectionWarningEmails}
              disabled={disabled || saving}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  sendVehicleInspectionWarningEmails: event.target.checked,
                }))
              }
              className={SETTINGS_CHECKBOX_CLASS_NAME}
            />
            Enable vehicle inspection warning emails when routed delivery is activated. Internal booking notifications also use the operational recipient list above.
          </label>
          {fieldErrors.sendVehicleInspectionWarningEmails ? (
            <p className="mt-2 text-xs font-semibold text-rose-300">
              {fieldErrors.sendVehicleInspectionWarningEmails}
            </p>
          ) : null}

          <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">Effective operational recipients</p>
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">
              Preview of the current recipient resolution order used for vehicle inspection warnings and internal booking notifications.
            </p>
            <p className="mt-2 text-xs text-[var(--ccr-muted)]">
              Routing source:{" "}
              <span className="font-semibold text-[var(--ccr-text)]">
                {operationalRouting.hasConfiguredRecipients
                  ? "Configured recipients"
                  : operationalRouting.usesFallback
                    ? "Fallback recipients"
                    : "No recipients"}
              </span>
            </p>
            {operationalRouting.recipients.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm text-[var(--ccr-text)]">
                {operationalRouting.recipients.map((recipient) => (
                  <li
                    key={`${recipient.email}-${recipient.source}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ccr-border)] px-3 py-2"
                  >
                    <span className="font-medium">{recipient.email}</span>
                    <span className="text-xs text-[var(--ccr-muted)]">{recipient.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-[var(--ccr-muted)]">
                No operational recipients resolve yet. Add a default email or additional recipients to avoid fallback-only routing for internal booking notifications and warning emails.
              </p>
            )}
            {operationalRouting.warnings.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-amber-300">
                {operationalRouting.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div
          data-testid="settings-panel-notifications"
          className={`${isNotificationsTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Message notification recipients</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Comma-separated emails for contact message alerts. Leave empty to use the effective operational recipients configured above, then environment fallback if none resolve.
          </p>
          <div className="mt-3">
            <input
              type="text"
              value={settings.contactNotificationEmails}
              disabled={disabled || saving}
              placeholder="owner@example.com, ops@example.com"
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  contactNotificationEmails: event.target.value,
                }))
              }
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
            {fieldErrors.contactNotificationEmails ? (
              <p className="mt-2 text-xs font-semibold text-rose-300">
                {fieldErrors.contactNotificationEmails}
              </p>
            ) : null}
          </div>
        </div>

        <div
          data-testid="settings-panel-notifications"
          className={`${isNotificationsTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Contact notification cooldown</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Prevent duplicate alerts by sending at most once per cooldown window.
          </p>
          <div className="mt-3 max-w-xs">
            <select
              value={String(settings.contactNotifyCooldownMinutes)}
              disabled={disabled || saving}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  contactNotifyCooldownMinutes: Number(event.target.value),
                }))
              }
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="1">1 minute</option>
              <option value="3">3 minutes</option>
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">60 minutes</option>
            </select>
            {fieldErrors.contactNotifyCooldownMinutes ? (
              <p className="mt-2 text-xs font-semibold text-rose-300">
                {fieldErrors.contactNotifyCooldownMinutes}
              </p>
            ) : null}
          </div>
        </div>

        <div
          data-testid="settings-panel-maintenance"
          className={`${isMaintenanceTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Maintenance reminder lead time</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Number of days before due date to generate maintenance reminders.
          </p>
          <div className="mt-3 max-w-xs">
            <select
              value={maintenanceLeadDaysValue}
              disabled={disabled || saving}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  maintenanceReminderLeadDays: Number(event.target.value),
                }))
              }
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="3">3 days</option>
              <option value="5">5 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="21">21 days</option>
              <option value="30">30 days</option>
            </select>
            {fieldErrors.maintenanceReminderLeadDays ? (
              <p className="mt-2 text-xs font-semibold text-rose-300">
                {fieldErrors.maintenanceReminderLeadDays}
              </p>
            ) : null}
          </div>
        </div>

        <div
          data-testid="settings-panel-maintenance"
          className={`${isMaintenanceTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Maintenance due-soon thresholds</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Used by maintenance due-state labels in vehicles and fleet-wide maintenance views.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Due Soon Days
              <input
                type="number"
                min={1}
                max={180}
                value={maintenanceDueSoonDaysValue}
                disabled={disabled || saving}
                data-testid="settings-maintenanceDueSoonDays"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    maintenanceDueSoonDays: Math.min(
                      180,
                      Math.max(1, Number(event.target.value || 1)),
                    ),
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
              {fieldErrors.maintenanceDueSoonDays ? (
                <p className="mt-2 text-[11px] font-semibold normal-case tracking-normal text-rose-300">
                  {fieldErrors.maintenanceDueSoonDays}
                </p>
              ) : null}
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Due Soon Mileage (km)
              <input
                type="number"
                min={0}
                max={25000}
                value={maintenanceDueSoonKmValue}
                disabled={disabled || saving}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    maintenanceDueSoonKm: Math.min(
                      25000,
                      Math.max(0, Number(event.target.value || 0)),
                    ),
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
              {fieldErrors.maintenanceDueSoonKm ? (
                <p className="mt-2 text-[11px] font-semibold normal-case tracking-normal text-rose-300">
                  {fieldErrors.maintenanceDueSoonKm}
                </p>
              ) : null}
            </label>
          </div>
        </div>

        <div
          data-testid="settings-panel-depreciation"
          className={`${isDepreciationTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Depreciation defaults</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Default method and life assumptions used when creating vehicle finance records.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Method
              <select
                value={settings.depreciationDefaultMethod}
                disabled={disabled || saving}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    depreciationDefaultMethod:
                      event.target.value === "STRAIGHT_LINE"
                        ? "STRAIGHT_LINE"
                        : "STRAIGHT_LINE",
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              >
                <option value="STRAIGHT_LINE">Straight-line</option>
              </select>
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Useful Life (Months)
              <input
                type="number"
                min={1}
                max={240}
                value={depreciationUsefulLifeValue}
                disabled={disabled || saving}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    depreciationDefaultUsefulLifeMonths: Math.min(
                      240,
                      Math.max(1, Number(event.target.value || 1)),
                    ),
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
              {fieldErrors.depreciationDefaultUsefulLifeMonths ? (
                <p className="mt-2 text-[11px] font-semibold normal-case tracking-normal text-rose-300">
                  {fieldErrors.depreciationDefaultUsefulLifeMonths}
                </p>
              ) : null}
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Residual Value (%)
              <input
                type="number"
                min={0}
                max={95}
                value={depreciationResidualPercentValue}
                disabled={disabled || saving}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    depreciationDefaultResidualPercent: Math.min(
                      95,
                      Math.max(0, Number(event.target.value || 0)),
                    ),
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
              {fieldErrors.depreciationDefaultResidualPercent ? (
                <p className="mt-2 text-[11px] font-semibold normal-case tracking-normal text-rose-300">
                  {fieldErrors.depreciationDefaultResidualPercent}
                </p>
              ) : null}
            </label>
          </div>
        </div>

        <div
          data-testid="settings-panel-documents"
          className={`${isDocumentsTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Vehicle document folders</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            One folder per line. These options are shared by the vehicle Files and Checklist
            tabs.
          </p>
          <div className="mt-3">
            <textarea
              value={vehicleDocumentFoldersValue}
              disabled={disabled || saving}
              rows={4}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  vehicleDocumentFolders: event.target.value
                    .split(/\n|,|;/)
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                    .slice(0, 40),
                  vehicleChecklistTemplates: current.vehicleChecklistTemplates.map((template) => {
                    const nextFolders = event.target.value
                      .split(/\n|,|;/)
                      .map((entry) => entry.trim())
                      .filter(Boolean)
                      .slice(0, 40);
                    const folderOptions = nextFolders.length > 0 ? nextFolders : ["Paperwork"];
                    return {
                      ...template,
                      folder: normalizeTemplateFolder(template.folder, folderOptions),
                    };
                  }),
                }))
              }
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder={"Paperwork\nInsurance\nRegistration\nOther"}
            />
            {fieldErrors.vehicleDocumentFolders ? (
              <p className="mt-2 text-xs font-semibold text-rose-300">
                {fieldErrors.vehicleDocumentFolders}
              </p>
            ) : null}
          </div>
        </div>

        <div
          data-testid="settings-panel-documents"
          className={`${isDocumentsTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Vehicle document types</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            One type per line. Files tab only. Used as quick type suggestions in vehicle
            document forms.
          </p>
          <div className="mt-3">
            <textarea
              value={vehicleDocumentTypeOptionsValue}
              disabled={disabled || saving}
              rows={5}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  vehicleDocumentTypeOptions: event.target.value
                    .split(/\n|,|;/)
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                    .slice(0, 40),
                }))
              }
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder={"Registration\nInsurance Certificate\nService Invoice\nReceipt\nPhoto\nOther"}
            />
            {fieldErrors.vehicleDocumentTypeOptions ? (
              <p className="mt-2 text-xs font-semibold text-rose-300">
                {fieldErrors.vehicleDocumentTypeOptions}
              </p>
            ) : null}
          </div>
        </div>

        <div
          data-testid="settings-panel-documents"
          className={`${isDocumentsTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Vehicle checklist templates</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Checklist tab only. These structured templates are the saved source of truth for
            checklist items. The current vehicle Checklist quick template action still uses the
            label list derived from these entries.
          </p>
          {fieldErrors.vehicleChecklistTemplates ? (
            <p className="mt-3 text-xs font-semibold text-rose-300">
              {fieldErrors.vehicleChecklistTemplates}
            </p>
          ) : null}
          <div className="mt-4 space-y-4">
            {settings.vehicleChecklistTemplates.map((template, index) => (
              <div
                key={template.key || `template-${index}`}
                className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4"
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Label
                    <input
                      type="text"
                      value={template.label}
                      disabled={disabled || saving}
                      onChange={(event) =>
                        updateChecklistTemplates((currentTemplates) =>
                          currentTemplates.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, label: event.target.value.slice(0, 160) }
                              : entry,
                          ),
                        )
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                      placeholder="Insurance Certificate"
                    />
                  </label>

                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Folder
                    <select
                      value={normalizeTemplateFolder(template.folder, checklistTemplateFolderOptions)}
                      disabled={disabled || saving}
                      onChange={(event) =>
                        updateChecklistTemplates((currentTemplates) =>
                          currentTemplates.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, folder: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                    >
                      {checklistTemplateFolderOptions.map((folder) => (
                        <option key={folder} value={folder}>
                          {folder}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex items-center gap-3 rounded-xl border border-[var(--ccr-border)] px-3 py-3 text-sm text-[var(--ccr-text)]">
                    <input
                      type="checkbox"
                      checked={template.required}
                      disabled={disabled || saving}
                      onChange={(event) =>
                        updateChecklistTemplates((currentTemplates) =>
                          currentTemplates.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, required: event.target.checked }
                              : entry,
                          ),
                        )
                      }
                      className={SETTINGS_CHECKBOX_CLASS_NAME}
                    />
                    Required by default
                  </label>

                  <label className="flex items-center gap-3 rounded-xl border border-[var(--ccr-border)] px-3 py-3 text-sm text-[var(--ccr-text)]">
                    <input
                      type="checkbox"
                      checked={template.allowNotRequired}
                      disabled={disabled || saving}
                      onChange={(event) =>
                        updateChecklistTemplates((currentTemplates) =>
                          currentTemplates.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, allowNotRequired: event.target.checked }
                              : entry,
                          ),
                        )
                      }
                      className={SETTINGS_CHECKBOX_CLASS_NAME}
                    />
                    Staff can mark optional later
                  </label>

                  <label className="flex items-center gap-3 rounded-xl border border-[var(--ccr-border)] px-3 py-3 text-sm text-[var(--ccr-text)]">
                    <input
                      type="checkbox"
                      checked={template.expiryRequired}
                      disabled={disabled || saving}
                      onChange={(event) =>
                        updateChecklistTemplates((currentTemplates) =>
                          currentTemplates.map((entry, entryIndex) =>
                            entryIndex === index
                              ? {
                                  ...entry,
                                  expiryRequired: event.target.checked,
                                  expiryWarningDays: event.target.checked
                                    ? entry.expiryWarningDays ?? 30
                                    : null,
                                }
                              : entry,
                          ),
                        )
                      }
                      className={SETTINGS_CHECKBOX_CLASS_NAME}
                    />
                    Expiry date required
                  </label>

                  <label className="flex items-center gap-3 rounded-xl border border-[var(--ccr-border)] px-3 py-3 text-sm text-[var(--ccr-text)]">
                    <input
                      type="checkbox"
                      checked={template.isActive}
                      disabled={disabled || saving}
                      onChange={(event) =>
                        updateChecklistTemplates((currentTemplates) =>
                          currentTemplates.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, isActive: event.target.checked }
                              : entry,
                          ),
                        )
                      }
                      className={SETTINGS_CHECKBOX_CLASS_NAME}
                    />
                    Available in Checklist template apply
                  </label>

                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Expiry Warning Days
                    <input
                      type="number"
                      min={0}
                      max={3650}
                      value={template.expiryWarningDays === null ? "" : String(template.expiryWarningDays)}
                      disabled={disabled || saving || !template.expiryRequired}
                      onChange={(event) =>
                        updateChecklistTemplates((currentTemplates) =>
                          currentTemplates.map((entry, entryIndex) =>
                            entryIndex === index
                              ? {
                                  ...entry,
                                  expiryWarningDays: event.target.value
                                    ? Math.min(3650, Math.max(0, Number(event.target.value)))
                                    : null,
                                }
                              : entry,
                          ),
                        )
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                      placeholder="30"
                    />
                  </label>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={disabled || saving}
                    onClick={() =>
                      updateChecklistTemplates((currentTemplates) =>
                        currentTemplates.filter((_, entryIndex) => entryIndex !== index),
                      )
                    }
                    className="rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
                  >
                    Remove template
                  </button>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--ccr-border)] px-4 py-3">
              <div className="text-xs text-[var(--ccr-muted)]">
                Add a new checklist template entry with folder, required, and expiry metadata.
              </div>
              <button
                type="button"
                disabled={disabled || saving}
                onClick={() =>
                  updateChecklistTemplates((currentTemplates, availableFolders) => [
                    ...currentTemplates,
                    {
                      key: "",
                      label: "",
                      folder: availableFolders[0] ?? "Paperwork",
                      required: true,
                      allowNotRequired: true,
                      expiryRequired: false,
                      expiryWarningDays: null,
                      isActive: true,
                    },
                  ])
                }
                className={`${buttonStyles({ variant: "secondary" })} min-h-11`}
              >
                Add template
              </button>
            </div>

            <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Derived Checklist Labels
              </p>
              <p className="mt-2 text-sm text-[var(--ccr-text)]">
                {settings.vehicleChecklistTemplateItems.length > 0
                  ? settings.vehicleChecklistTemplateItems.join(", ")
                  : "No active checklist labels yet."}
              </p>
            </div>
          </div>
        </div>

        <div
          data-testid="settings-panel-maintenance"
          className={`${isMaintenanceTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Maintenance categories</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            One category per line. These values are available in maintenance forms and filters.
          </p>
          <div className="mt-3">
            <textarea
              value={maintenanceCategoriesValue}
              disabled={disabled || saving}
              rows={5}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  maintenanceCategories: event.target.value
                    .split(/\n|,|;/)
                    .map((entry) => entry.trim().toUpperCase())
                    .filter(Boolean)
                    .slice(0, 40),
                }))
              }
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder={"SERVICE\nREPAIR\nINSPECTION\nREGISTRATION\nINSURANCE"}
            />
            {fieldErrors.maintenanceCategories ? (
              <p className="mt-2 text-xs font-semibold text-rose-300">
                {fieldErrors.maintenanceCategories}
              </p>
            ) : null}
          </div>
        </div>

        <div
          data-testid="settings-panel-maintenance"
          className={`${isMaintenanceTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Maintenance priorities</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            One priority per line. These values are available in maintenance forms and filtering.
          </p>
          <div className="mt-3">
            <textarea
              value={maintenancePrioritiesValue}
              disabled={disabled || saving}
              rows={4}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  maintenancePriorities: event.target.value
                    .split(/\n|,|;/)
                    .map((entry) => entry.trim().toUpperCase())
                    .filter(Boolean)
                    .slice(0, 20),
                }))
              }
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder={"LOW\nNORMAL\nHIGH\nURGENT"}
            />
            {fieldErrors.maintenancePriorities ? (
              <p className="mt-2 text-xs font-semibold text-rose-300">
                {fieldErrors.maintenancePriorities}
              </p>
            ) : null}
          </div>
        </div>

        <div
          data-testid="settings-panel-maintenance"
          className={`${isMaintenanceTab ? "" : "hidden"} rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4`}
        >
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Maintenance service types</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Create and manage default service types and intervals used by vehicle maintenance schedules.
          </p>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Name
              <input
                type="text"
                value={serviceTypeDraft.name}
                disabled={disabled}
                onChange={(event) =>
                  setServiceTypeDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                placeholder="Oil Change"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Default Interval Days
              <input
                type="number"
                min={1}
                value={serviceTypeDraft.defaultIntervalDays}
                disabled={disabled}
                onChange={(event) =>
                  setServiceTypeDraft((current) => ({
                    ...current,
                    defaultIntervalDays: event.target.value,
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                placeholder="180"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Default Interval Odometer
              <input
                type="number"
                min={1}
                value={serviceTypeDraft.defaultIntervalOdometer}
                disabled={disabled}
                onChange={(event) =>
                  setServiceTypeDraft((current) => ({
                    ...current,
                    defaultIntervalOdometer: event.target.value,
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                placeholder="8000"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Description
              <input
                type="text"
                value={serviceTypeDraft.description}
                disabled={disabled}
                onChange={(event) =>
                  setServiceTypeDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                placeholder="Engine oil and filter service"
              />
            </label>
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={() => void createServiceType()}
              disabled={disabled}
              className={buttonStyles({ variant: "secondary", size: "md" })}
            >
              Add service type
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {serviceTypesLoading ? (
              <p className="text-sm text-[var(--ccr-muted)]">Loading service types...</p>
            ) : serviceTypesLoadError ? (
              <div
                data-testid="settings-service-types-error"
                className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-4"
              >
                <p className="text-sm font-semibold text-rose-100">{serviceTypesLoadError}</p>
                <p className="mt-1 text-xs text-rose-100/90">
                  Retry to load the latest service types for this tab.
                </p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => void loadServiceTypes()}
                    disabled={disabled || serviceTypesLoading}
                    data-testid="settings-service-types-retry"
                    className={buttonStyles({ variant: "secondary", size: "sm" })}
                  >
                    Retry load
                  </button>
                </div>
              </div>
            ) : serviceTypes.length < 1 ? (
              <p className="text-sm text-[var(--ccr-muted)]">No maintenance service types yet.</p>
            ) : (
              serviceTypes.map((item) => {
                const isEditing = editingServiceTypeId === item.id;
                return (
                  <article
                    key={item.id}
                    className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3"
                  >
                    {isEditing ? (
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                          Name
                          <input
                            type="text"
                            value={editingServiceTypeDraft.name}
                            onChange={(event) =>
                              setEditingServiceTypeDraft((current) => ({
                                ...current,
                                name: event.target.value,
                              }))
                            }
                            className="mt-1 min-h-10 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                          Interval Days
                          <input
                            type="number"
                            min={1}
                            value={editingServiceTypeDraft.defaultIntervalDays}
                            onChange={(event) =>
                              setEditingServiceTypeDraft((current) => ({
                                ...current,
                                defaultIntervalDays: event.target.value,
                              }))
                            }
                            className="mt-1 min-h-10 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                          Interval Odometer
                          <input
                            type="number"
                            min={1}
                            value={editingServiceTypeDraft.defaultIntervalOdometer}
                            onChange={(event) =>
                              setEditingServiceTypeDraft((current) => ({
                                ...current,
                                defaultIntervalOdometer: event.target.value,
                              }))
                            }
                            className="mt-1 min-h-10 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                          Description
                          <input
                            type="text"
                            value={editingServiceTypeDraft.description}
                            onChange={(event) =>
                              setEditingServiceTypeDraft((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                            className="mt-1 min-h-10 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                          />
                        </label>
                        <label className="flex min-h-10 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] md:col-span-2">
                          <input
                            type="checkbox"
                            checked={editingServiceTypeDraft.isActive}
                            onChange={(event) =>
                              setEditingServiceTypeDraft((current) => ({
                                ...current,
                                isActive: event.target.checked,
                              }))
                            }
                            className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
                          />
                          Active
                        </label>
                        <div className="flex flex-wrap gap-2 md:col-span-2">
                          <button
                            type="button"
                            onClick={() => void saveEditedServiceType()}
                            className={buttonStyles({
                              variant: "secondary",
                              size: "sm",
                              className: "rounded-lg",
                            })}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingServiceTypeId(null)}
                            className={buttonStyles({
                              variant: "secondary",
                              size: "sm",
                              className: "rounded-lg",
                            })}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--ccr-text)]">{item.name}</p>
                          <p className="text-xs text-[var(--ccr-muted)]">
                            Days: {item.defaultIntervalDays ?? "—"} · Odometer:{" "}
                            {item.defaultIntervalOdometer ?? "—"}
                          </p>
                          {item.description ? (
                            <p className="mt-1 text-xs text-[var(--ccr-muted)]">{item.description}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span
                            className={`inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-none ${
                              item.isActive
                                ? "border-[var(--ccr-accent)]/45 bg-[var(--ccr-accent)]/10 text-[var(--ccr-text)]"
                                : "border-slate-300/45 bg-slate-500/15 text-slate-100"
                            }`}
                          >
                            {item.isActive ? "Active" : "Inactive"}
                          </span>
                          <button
                            type="button"
                            onClick={() => beginEditServiceType(item)}
                            className={buttonStyles({
                              variant: "secondary",
                              size: "sm",
                              className: "rounded-lg",
                            })}
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>

          {serviceTypesError ? (
            <p className="mt-3 text-xs font-semibold text-red-300">{serviceTypesError}</p>
          ) : null}
          {serviceTypesMessage ? (
            <p className="mt-3 text-xs font-semibold text-[var(--ccr-text)]">{serviceTypesMessage}</p>
          ) : null}
        </div>

        {visibleToggleFields.map((field) => (
          <label
            key={field.key}
            data-testid={`settings-panel-${TOGGLE_FIELD_TAB_MAP[field.key]}`}
            className="flex items-start justify-between gap-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4"
          >
            <div>
              <p className="text-sm font-semibold text-[var(--ccr-text)]">{field.label}</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">{field.description}</p>
            </div>
            <input
              type="checkbox"
              checked={settings[field.key]}
              disabled={disabled || saving}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  [field.key]: event.target.checked,
                }))
              }
              className="mt-1 h-5 w-5 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
            />
          </label>
        ))}
      </div>

      {conflictMessage ? (
        <div
          data-testid="settings-conflict-message"
          role="alert"
          className="mt-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100"
        >
          <p className="font-semibold">Newer settings were detected.</p>
          <p className="mt-1 text-xs text-amber-100/90">{conflictMessage}</p>
        </div>
      ) : null}
      {error ? (
        <p data-testid="settings-save-error" className="mt-4 text-sm font-semibold text-red-300">
          {error}
        </p>
      ) : null}
      {success ? (
        <p data-testid="settings-save-success" className="mt-4 text-sm font-semibold text-[var(--ccr-text)]">
          {success}
        </p>
      ) : null}

      <div className="mt-5 space-y-2">
        {isDirty ? (
          <p data-testid="settings-unsaved-indicator" className="text-xs font-semibold text-amber-200">
            You have unsaved changes.
          </p>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={disabled || saving}
          data-testid="settings-save"
          className={buttonStyles({
            variant: "primary",
            size: "md",
          })}
        >
          {saving ? "Saving..." : "Save settings"}
        </button>
      </div>
    </section>
  );
}
