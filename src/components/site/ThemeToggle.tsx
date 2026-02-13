"use client";

import { useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { cn } from "@/lib/utils";
import { type AppTheme, isAppTheme, THEME_STORAGE_KEY } from "@/lib/theme";

type ThemeToggleProps = {
  className?: string;
  variant?: "default" | "inverse";
  persistence?: "local" | "user";
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
}: ThemeToggleProps) {
  const [, setRefreshKey] = useState(0);
  const theme = getCurrentTheme();

  function toggleTheme() {
    const nextTheme: AppTheme = theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
    if (persistence === "user") {
      void persistThemeForUser(nextTheme);
    }
    setRefreshKey((value) => value + 1);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
        variant === "default" &&
          "border border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-muted)] hover:bg-[var(--ccr-surface-soft)]",
        variant === "inverse" &&
          "border border-white/35 bg-[var(--ccr-primary-soft)] text-white hover:bg-white hover:text-[var(--ccr-primary)]",
        className,
      )}
      aria-label="Toggle site theme"
    >
      <span suppressHydrationWarning>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
    </button>
  );
}
