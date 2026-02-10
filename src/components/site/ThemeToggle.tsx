"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const THEME_KEY = "ccr-theme";

type Theme = "light" | "dark";
type ThemeToggleProps = {
  className?: string;
  variant?: "default" | "inverse";
};

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeToggle({ className, variant = "default" }: ThemeToggleProps) {
  // NOTE: Keep the initial render deterministic to avoid hydration mismatch.
  // We apply the real theme in the effect below (and also bootstrap it in RootLayout).
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem(THEME_KEY) as Theme | null;

    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
      applyTheme(savedTheme);
      return;
    }

    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme: Theme = prefersDark ? "dark" : "light";
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
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
      {/* Avoid hydration mismatch by only rendering the dynamic label after mount. */}
      {mounted ? (theme === "dark" ? "Light Mode" : "Dark Mode") : "Theme"}
    </button>
  );
}
