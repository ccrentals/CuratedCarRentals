"use client";

import { useSyncExternalStore } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { cn } from "@/lib/utils";
import { APP_THEMES, type AppTheme, isAppTheme, THEME_LABELS, THEME_STORAGE_KEY } from "@/lib/theme";

type ThemeToggleProps = {
  className?: string;
  variant?: "default" | "inverse";
  persistence?: "local" | "user";
  showLabel?: boolean;
};

function applyTheme(theme: AppTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function getCurrentTheme() {
  if (typeof document === "undefined") return "light" as AppTheme;
  const current = document.documentElement.getAttribute("data-theme");
  if (isAppTheme(current)) return current;
  const savedTheme =
    typeof window !== "undefined" ? localStorage.getItem(THEME_STORAGE_KEY) : null;
  if (isAppTheme(savedTheme)) return savedTheme;
  return "light" as AppTheme;
}

function subscribeToTheme(callback: () => void) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const handleStorage = () => callback();
  const observer = new MutationObserver(() => callback());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener("storage", handleStorage);
    observer.disconnect();
  };
}

function getThemeServerSnapshot(): AppTheme {
  return "light";
}

async function persistThemeForUser(theme: AppTheme) {
  const csrfToken = await ensureCsrfToken();
  await fetch("/api/admin/me", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken ?? "",
    },
    body: JSON.stringify({ theme }),
  });
}

export function ThemeToggle({
  className,
  variant = "default",
  persistence = "local",
  showLabel = true,
}: ThemeToggleProps) {
  const theme = useSyncExternalStore(subscribeToTheme, getCurrentTheme, getThemeServerSnapshot);

  function selectTheme(nextTheme: AppTheme) {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
    if (persistence === "user") {
      void persistThemeForUser(nextTheme);
    }
  }

  return (
    <label className="inline-flex items-center gap-2">
      {showLabel ? (
        <span
          className={cn(
            "text-xs font-semibold uppercase tracking-wide",
            variant === "default" && "text-[var(--ccr-muted)]",
            variant === "inverse" && "text-white",
          )}
        >
          Theme
        </span>
      ) : null}
      <select
        value={theme}
        onChange={(event) => {
          const value = event.target.value;
          if (!isAppTheme(value)) return;
          selectTheme(value);
        }}
        suppressHydrationWarning
        aria-label="Theme"
        className={cn(
          "rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
          variant === "default" &&
            "border border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]",
          variant === "inverse" &&
            "border border-white/35 bg-[var(--ccr-primary-soft)] text-white hover:bg-white hover:text-[var(--ccr-primary)]",
          className,
        )}
      >
        {APP_THEMES.map((item) => (
          <option key={item} value={item}>
            {THEME_LABELS[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
