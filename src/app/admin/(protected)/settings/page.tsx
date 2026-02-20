import Link from "next/link";

import { AdminSettingsForm } from "@/components/admin/AdminSettingsForm";
import { BookingFlowConfigPanel } from "@/components/admin/BookingFlowConfigPanel";
import { getSessionFromRequest } from "@/lib/auth/session";
import { DEFAULT_ADMIN_SETTINGS } from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
type AdminSettings = typeof DEFAULT_ADMIN_SETTINGS;

type SettingRow = {
  content: string;
  updated_at: string;
  updated_by_email: string | null;
};

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

function parseStoredSettings(content: unknown): AdminSettings {
  if (typeof content !== "string" || !content.trim()) {
    return { ...DEFAULT_ADMIN_SETTINGS };
  }
  try {
    const raw = JSON.parse(content) as Record<string, unknown>;
    const next: AdminSettings = { ...DEFAULT_ADMIN_SETTINGS };
    for (const key of Object.keys(DEFAULT_ADMIN_SETTINGS) as Array<keyof AdminSettings>) {
      if (key === "dayViewBookingLimit") {
        continue;
      }
      if (typeof raw[key] === "boolean") {
        next[key] = raw[key] as boolean;
      }
    }
    const limit = raw.dayViewBookingLimit;
    if (limit === "all") {
      next.dayViewBookingLimit = "all";
    } else if (typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= 50) {
      next.dayViewBookingLimit = limit;
    } else if (typeof limit === "string" && limit.trim()) {
      const normalized = limit.trim().toLowerCase();
      if (normalized === "all") {
        next.dayViewBookingLimit = "all";
      } else {
        const parsed = Number(normalized);
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 50) {
          next.dayViewBookingLimit = parsed;
        }
      }
    }
    return next;
  } catch {
    return { ...DEFAULT_ADMIN_SETTINGS };
  }
}

export default async function AdminSettingsPage() {
  const session = await getSessionFromRequest();
  const isAdmin = isAdminRole(session?.role);

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
        {!isAdmin ? (
          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">Admin access required.</p>
            <p className="mt-2 text-sm text-[var(--ccr-muted)]">
              Only ADMIN users can modify platform settings.
            </p>
          </section>
        ) : tableMissing ? (
          <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">Settings storage not configured.</p>
            <p className="mt-2 text-sm text-[var(--ccr-muted)]">
              The <code>admin_documents</code> table is missing. Apply the current schema in Neon and
              refresh this page.
            </p>
          </section>
        ) : (
          <AdminSettingsForm
            initialSettings={settings}
            updatedAt={updatedAt}
            updatedByEmail={updatedByEmail}
            disabled={!isAdmin}
          />
        )}

        {isAdmin ? <BookingFlowConfigPanel /> : null}
      </div>
    </div>
  );
}
