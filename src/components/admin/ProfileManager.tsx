"use client";

import { useEffect, useMemo, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { APP_THEMES, type AppTheme, isAppTheme, THEME_LABELS, THEME_STORAGE_KEY } from "@/lib/theme";

type MeResponse = {
  ok: boolean;
  error?: string;
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
      fullName: profile.fullName ?? "—",
      username: profile.username ?? "—",
      createdAt: formatDate(profile.createdAt),
      lastLoginAt: formatDate(profile.lastLoginAt),
      status: profile.isActive === false ? "Inactive" : "Active",
    };
  }, [profile]);

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
      setSaveMessage("Profile preferences saved.");
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
      <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
        <h2 className="text-lg font-bold text-[var(--ccr-text)]">Account</h2>
        {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
        {userSummary ? (
          <div className="mt-4 grid gap-4 text-sm text-[var(--ccr-muted)] md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide">Full name</p>
              <p className="font-semibold text-[var(--ccr-text)]">{userSummary.fullName}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide">Username</p>
              <p className="font-semibold text-[var(--ccr-text)]">{userSummary.username}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide">Email</p>
              <p className="font-semibold text-[var(--ccr-text)]">{userSummary.email}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide">Role</p>
              <p className="font-semibold text-[var(--ccr-text)]">{userSummary.role}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide">Created</p>
              <p className="font-semibold text-[var(--ccr-text)]">{userSummary.createdAt}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide">Last login</p>
              <p className="font-semibold text-[var(--ccr-text)]">{userSummary.lastLoginAt}</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
        <h2 className="text-lg font-bold text-[var(--ccr-text)]">Theme Preferences</h2>
        <p className="mt-1 text-sm text-[var(--ccr-muted)]">
          Choose your personal admin theme. Your selection is saved to your profile and applied immediately.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Theme
            <select
              value={theme}
              onChange={(event) => {
                const value = event.target.value;
                if (isAppTheme(value)) {
                  setTheme(value);
                }
              }}
              className="mt-2 w-full min-w-[220px] rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              {APP_THEMES.map((item) => (
                <option key={item} value={item}>
                  {THEME_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={saveTheme}
            disabled={saving}
            className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Preferences"}
          </button>
        </div>
        {saveMessage ? <p className="mt-3 text-sm font-semibold text-[var(--ccr-text)]">{saveMessage}</p> : null}
      </section>
    </div>
  );
}
