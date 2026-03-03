import Link from "next/link";
import { isAdminRole, isDeveloperRole } from "@/lib/auth/roles";

import { AdminSettingsForm } from "@/components/admin/AdminSettingsForm";
import type { AdminSettingsFormTab } from "@/components/admin/AdminSettingsForm";
import { AdminPillTabs } from "@/components/admin/AdminPillTabs";
import { BookingFlowConfigPanel } from "@/components/admin/BookingFlowConfigPanel";
import { SettingsVehiclesPanel } from "@/components/admin/SettingsVehiclesPanel";
import { loadPrimaryAdminLoginMethodResolution } from "@/lib/auth/adminLoginMethod";
import { getSessionFromRequest } from "@/lib/auth/session";
import { DEFAULT_ADMIN_SETTINGS, normalizeAdminSettingsValue } from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
type AdminSettings = typeof DEFAULT_ADMIN_SETTINGS;

type SettingRow = {
  content: string;
  updated_at: string;
  updated_by_email: string | null;
};

const SETTINGS_TABS = [
  { key: "general", label: "General" },
  { key: "notifications", label: "Notifications" },
  { key: "maintenance", label: "Maintenance" },
  { key: "documents", label: "Vehicle Docs" },
  { key: "vehicles", label: "Vehicles" },
  { key: "depreciation", label: "Depreciation" },
  { key: "booking-flow", label: "Booking Flow" },
] as const;

type AdminSettingsTab = (typeof SETTINGS_TABS)[number]["key"];

function normalizeAdminSettingsTab(value: string | string[] | undefined): AdminSettingsTab {
  const candidate = typeof value === "string" ? value.toLowerCase().trim() : "";
  const match = SETTINGS_TABS.find((tab) => tab.key === candidate);
  return match?.key ?? "general";
}

function isSettingsFormTab(tab: AdminSettingsTab): tab is AdminSettingsFormTab {
  return (
    tab === "general" ||
    tab === "notifications" ||
    tab === "maintenance" ||
    tab === "documents" ||
    tab === "depreciation"
  );
}

function buildSettingsTabHref(
  tab: AdminSettingsTab,
  params: Record<string, string | string[] | undefined>,
) {
  const nextQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "string" || key === "tab") continue;
    nextQuery.set(key, value);
  }
  nextQuery.set("tab", tab);
  return `/admin/settings?${nextQuery.toString()}`;
}

function parseStoredSettings(content: unknown): AdminSettings {
  if (typeof content !== "string" || !content.trim()) {
    return normalizeAdminSettingsValue({});
  }

  try {
    return normalizeAdminSettingsValue(JSON.parse(content));
  } catch {
    return normalizeAdminSettingsValue({});
  }
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const activeTab = normalizeAdminSettingsTab(query.tab);
  const session = await getSessionFromRequest();
  const isAdmin = isAdminRole(session?.role);
  const isDeveloper = isDeveloperRole(session?.role);
  const loginMethodResolution = await loadPrimaryAdminLoginMethodResolution();

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
            <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Settings</h1>
            <p className="mt-2 text-sm text-[var(--ccr-muted)]">
              Configure platform-wide toggles for booking, payment, and operational workflows.
            </p>
          </div>
          <Link
            href="/admin"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Back to dashboard
          </Link>
        </div>
        <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Admin access required.</p>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            Only ADMIN users can modify platform settings.
          </p>
        </section>
      </div>
    );
  }

  let settings = { ...DEFAULT_ADMIN_SETTINGS };
  let updatedAt: string | null = null;
  let updatedByEmail: string | null = null;
  let tableMissing = false;

  try {
    const result = await dbQuery<SettingRow>(
      "select d.content, d.updated_at, u.email as updated_by_email from admin_documents d left join users u on u.id = d.updated_by where d.key = 'settings'",
    );
    const row = result.rows[0] ?? null;
    settings = parseStoredSettings(row?.content);
    updatedAt = row?.updated_at ?? null;
    updatedByEmail = row?.updated_by_email ?? null;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "42P01") {
      tableMissing = true;
    } else {
      throw error;
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Settings</h1>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            Configure platform-wide toggles for booking, payment, and operational workflows.
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Back to dashboard
        </Link>
      </div>

      <div className="mt-6 space-y-6">
        <AdminPillTabs
          tabs={SETTINGS_TABS.map((tab) => ({
            key: tab.key,
            label: tab.label,
            href: buildSettingsTabHref(tab.key, query),
          }))}
          activeKey={activeTab}
          ariaLabel="Admin settings tabs"
          navTestId="settings-tabs"
          tabTestIdPrefix="settings-tab"
        />

        {activeTab === "booking-flow" ? (
          <BookingFlowConfigPanel />
        ) : activeTab === "vehicles" ? (
          <SettingsVehiclesPanel />
        ) : tableMissing ? (
          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">Settings storage not configured.</p>
            <p className="mt-2 text-sm text-[var(--ccr-muted)]">
              The <code>admin_documents</code> table is missing. Apply the current schema in Neon and
              refresh this page.
            </p>
          </section>
        ) : isSettingsFormTab(activeTab) ? (
          <AdminSettingsForm
            initialSettings={settings}
            updatedAt={updatedAt}
            updatedByEmail={updatedByEmail}
            activeTab={activeTab}
            disabled={false}
            showDeveloperControls={isDeveloper}
            effectiveAuthLoginMethod={loginMethodResolution.method}
            authLoginMethodSource={loginMethodResolution.source}
          />
        ) : null}
      </div>
    </div>
  );
}
