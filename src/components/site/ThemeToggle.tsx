"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { type AppTheme, isAppTheme } from "@/lib/theme";

const THEME_KEY = "ccr-theme";

type ThemeToggleProps = {
  className?: string;
  variant?: "default" | "inverse";
};

function applyTheme(theme: AppTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function getCurrentTheme() {
  if (typeof document === "undefined") return "light" as AppTheme;
  const current = document.documentElement.getAttribute("data-theme");
  if (isAppTheme(current)) return current;
  const savedTheme = typeof window !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
  if (isAppTheme(savedTheme)) return savedTheme;
  return "light" as AppTheme;
}

export function ThemeToggle({ className, variant = "default" }: ThemeToggleProps) {
  const [, setRefreshKey] = useState(0);
  const theme = getCurrentTheme();

  function toggleTheme() {
    const nextTheme: AppTheme = theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
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
