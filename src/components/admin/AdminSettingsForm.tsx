"use client";

import { useState } from "react";

import { DateTimeStack } from "@/components/shared/DateTimeStack";
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
    | "sendLateDropoffAlert";
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

  const dayViewBookingLimitValue =
    settings.dayViewBookingLimit === "all" ? "all" : String(settings.dayViewBookingLimit);

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
              <DateTimeStack value={updatedAt} className="inline-flex font-semibold text-[var(--ccr-text)]" />
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
