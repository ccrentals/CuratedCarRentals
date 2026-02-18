"use client";

import { useEffect, useMemo, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import {
  APP_THEMES,
  type AppTheme,
  isAppTheme,
  THEME_LABELS,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

type MeResponse = {
  ok: boolean;
  error?: string;
  userId?: string;
  email?: string;
  role?: string;
  fullName?: string | null;
  username?: string | null;
  createdAt?: string | null;
  lastLoginAt?: string | null;
  isActive?: boolean;
  preferences?: {
    theme?: AppTheme | null;
  };
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function initialsFromName(name: string, email: string) {
  const trimmed = name.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }
  return (email[0] ?? "U").toUpperCase();
}

export function ProfileManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [theme, setTheme] = useState<AppTheme>("light");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/admin/me", { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as MeResponse | null;
        if (!alive) return;
        if (!response.ok || !data?.ok) {
          setError(data?.error ?? "Unable to load profile.");
          setLoading(false);
          return;
        }
        const savedTheme = data.preferences?.theme;
        const fallbackTheme = localStorage.getItem(THEME_STORAGE_KEY);
        const initialTheme = isAppTheme(savedTheme)
          ? savedTheme
          : isAppTheme(fallbackTheme)
            ? fallbackTheme
            : "light";

        setProfile(data);
        setTheme(initialTheme);
        setLoading(false);
      } catch {
        if (!alive) return;
        setError("Unable to load profile.");
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const userSummary = useMemo(() => {
    if (!profile?.ok) return null;
    return {
      email: profile.email ?? "—",
      role: profile.role ?? "—",
      fullName: profile.fullName ?? "",
      username: profile.username ?? "—",
      createdAt: formatDate(profile.createdAt),
      lastLoginAt: formatDate(profile.lastLoginAt),
      status: profile.isActive === false ? "Inactive" : "Active",
      userId: profile.userId ?? "—",
    };
  }, [profile]);

  const displayName = userSummary?.fullName?.trim() || userSummary?.email || "Admin User";
  const avatarInitials = initialsFromName(userSummary?.fullName ?? "", userSummary?.email ?? "");

  async function saveTheme() {
    if (!isAppTheme(theme)) return;

    setSaving(true);
    setSaveMessage(null);
    setError(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ theme }),
      });
      const data = (await response.json().catch(() => null)) as MeResponse | null;
      if (!response.ok || !data?.ok) {
        setError(data?.error ?? "Unable to save theme.");
        setSaving(false);
        return;
      }

      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      setSaveMessage("Preferences saved.");
      setSaving(false);
    } catch {
      setError("Unable to save theme.");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm text-[var(--ccr-muted)]">
        Loading profile...
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {error ? (
        <section className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4">
          <p className="text-sm font-semibold text-red-200">{error}</p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--ccr-border)] bg-gradient-to-br from-[var(--ccr-surface)] to-[var(--ccr-surface-soft)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-bg)] text-lg font-bold text-[var(--ccr-accent)]">
              {avatarInitials}
            </div>
            <div>
              <p className="text-xl font-bold text-[var(--ccr-text)]">{displayName}</p>
              <p className="text-sm text-[var(--ccr-muted)]">{userSummary?.email ?? "—"}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
              {userSummary?.role ?? "—"}
            </span>
            <span className="rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-bg)] px-3 py-1 text-xs font-semibold text-[var(--ccr-accent)]">
              {userSummary?.status ?? "—"}
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Identity</h2>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Core account details currently saved for your login.
          </p>
          <div className="mt-4 grid gap-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Username</p>
              <p className="font-semibold text-[var(--ccr-text)]">{userSummary?.username ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">User ID</p>
              <p className="break-all font-mono text-xs text-[var(--ccr-text)]">{userSummary?.userId ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Member since</p>
              <p className="font-semibold text-[var(--ccr-text)]">{userSummary?.createdAt ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Last login</p>
              <p className="font-semibold text-[var(--ccr-text)]">{userSummary?.lastLoginAt ?? "—"}</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Theme Preferences</h2>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Select your personal admin theme. This is saved per account.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {APP_THEMES.map((item) => {
              const selected = theme === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTheme(item)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                    selected
                      ? "border-[var(--ccr-accent)] bg-[var(--ccr-bg)] text-[var(--ccr-text)]"
                      : "border-[var(--ccr-border)] bg-transparent text-[var(--ccr-muted)] hover:border-[var(--ccr-accent)] hover:text-[var(--ccr-text)]"
                  }`}
                >
                  {THEME_LABELS[item]}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveTheme}
              disabled={saving}
              className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Preferences"}
            </button>
            {saveMessage ? (
              <p className="text-sm font-semibold text-[var(--ccr-text)]" role="status" aria-live="polite">
                {saveMessage}
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
        <h2 className="text-lg font-bold text-[var(--ccr-text)]">Security Snapshot</h2>
        <p className="mt-1 text-sm text-[var(--ccr-muted)]">
          Operational safeguards currently active for your account.
        </p>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Session policy</p>
            <p className="mt-1 font-semibold text-[var(--ccr-text)]">20 min idle timeout</p>
          </div>
          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Role protection</p>
            <p className="mt-1 font-semibold text-[var(--ccr-text)]">
              {userSummary?.role === "DEVELOPER" ? "Developer-level access" : "Role-scoped access"}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Account state</p>
            <p className="mt-1 font-semibold text-[var(--ccr-text)]">{userSummary?.status ?? "—"}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
