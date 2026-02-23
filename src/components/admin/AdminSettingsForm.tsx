"use client";

import { useEffect, useState } from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type AdminSettings = {
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
  updatedAt: string | null;
  updatedByEmail: string | null;
  disabled?: boolean;
};

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
      "When enabled, the maintenance reminder cron route creates due-soon reminder records (and optional emails if configured).",
  },
];

export function AdminSettingsForm({
  initialSettings,
  updatedAt,
  updatedByEmail,
  disabled,
}: AdminSettingsFormProps) {
  const [settings, setSettings] = useState<AdminSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [serviceTypesLoading, setServiceTypesLoading] = useState(false);
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

  async function loadServiceTypes() {
    setServiceTypesLoading(true);
    setServiceTypesError(null);
    try {
      const response = await fetch("/api/admin/maintenance/service-types", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: ServiceType[];
      };
      if (!response.ok || !payload.ok) {
        setServiceTypesError(payload.error ?? "Failed to load service types.");
        setServiceTypes([]);
        return;
      }
      setServiceTypes(Array.isArray(payload.items) ? payload.items : []);
    } catch {
      setServiceTypesError("Failed to load service types.");
      setServiceTypes([]);
    } finally {
      setServiceTypesLoading(false);
    }
  }

  useEffect(() => {
    void loadServiceTypes();
  }, []);

  async function save() {
    if (disabled) return;
    if (saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ settings }),
    });

    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      ok?: boolean;
      updatedAt?: string | null;
    };

    setSaving(false);

    if (!response.ok || !data.ok) {
      setError(data.error ?? "Failed to save settings.");
      return;
    }

    setSuccess("Settings saved.");
  }

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
  const vehicleDocumentFoldersValue = settings.vehicleDocumentFolders.join("\n");
  const vehicleChecklistTemplateItemsValue = settings.vehicleChecklistTemplateItems.join("\n");
  const maintenanceCategoriesValue = settings.maintenanceCategories.join("\n");

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
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
            {updatedAt ? (
              <DateTimeInline value={updatedAt} className="inline-flex font-semibold text-[var(--ccr-text)]" />
            ) : (
              <span className="font-semibold text-[var(--ccr-text)]">Never</span>
            )}
          </div>
          <div>
            By: <span className="font-semibold text-[var(--ccr-text)]">{updatedByEmail ?? "System"}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
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
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Message notification recipients</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Comma-separated emails for contact message alerts. Leave empty to use <code>ADMIN_NOTIFY_EMAILS</code>.
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
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
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
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">60 minutes</option>
            </select>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
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
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
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
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
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
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Vehicle document folders</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            One folder per line. These options appear in the vehicle Files and Checklist tabs.
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
                }))
              }
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder={"Paperwork\nInsurance\nRegistration\nOther"}
            />
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Vehicle checklist template items</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            One checklist item per line. Used by the Checklist tab quick template action.
          </p>
          <div className="mt-3">
            <textarea
              value={vehicleChecklistTemplateItemsValue}
              disabled={disabled || saving}
              rows={5}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  vehicleChecklistTemplateItems: event.target.value
                    .split(/\n|,|;/)
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                    .slice(0, 40),
                }))
              }
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder={"Insurance Certificate\nRegistration\nRoadside Assistance"}
            />
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
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
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
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
              className="min-h-11 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
            >
              Add service type
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {serviceTypesLoading ? (
              <p className="text-sm text-[var(--ccr-muted)]">Loading service types...</p>
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
                            className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingServiceTypeId(null)}
                            className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
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
                            className={`inline-flex min-h-8 items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${
                              item.isActive
                                ? "border-emerald-300/45 bg-emerald-500/15 text-emerald-100"
                                : "border-slate-300/45 bg-slate-500/15 text-slate-100"
                            }`}
                          >
                            {item.isActive ? "Active" : "Inactive"}
                          </span>
                          <button
                            type="button"
                            onClick={() => beginEditServiceType(item)}
                            className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
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
            <p className="mt-3 text-xs font-semibold text-emerald-200">{serviceTypesMessage}</p>
          ) : null}
        </div>

        {TOGGLE_FIELDS.map((field) => (
          <label
            key={field.key}
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

      {error ? <p className="mt-4 text-sm font-semibold text-red-300">{error}</p> : null}
      {success ? <p className="mt-4 text-sm font-semibold text-[var(--ccr-text)]">{success}</p> : null}

      <div className="mt-5">
        <button
          type="button"
          onClick={save}
          disabled={disabled || saving}
          className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save settings"}
        </button>
      </div>
    </section>
  );
}
