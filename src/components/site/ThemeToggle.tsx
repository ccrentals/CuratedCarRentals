"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { cn } from "@/lib/utils";
import {
  APP_THEMES,
  type AppTheme,
  isAppTheme,
  THEME_COOKIE_NAME,
  THEME_LABELS,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

type ThemeToggleProps = {
  className?: string;
  variant?: "default" | "inverse";
  persistence?: "local" | "user";
  showLabel?: boolean;
  controlId?: string;
};

function applyTheme(theme: AppTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function persistThemeCookie(theme: AppTheme) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE_NAME}=${encodeURIComponent(theme)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
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
  controlId,
}: ThemeToggleProps) {
  const generatedId = useId();
  const selectId = controlId ?? generatedId;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const theme = useSyncExternalStore(subscribeToTheme, getCurrentTheme, getThemeServerSnapshot);

  function selectTheme(nextTheme: AppTheme) {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    persistThemeCookie(nextTheme);
    applyTheme(nextTheme);
    if (persistence === "user") {
      void persistThemeForUser(nextTheme);
    }
  }

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const selectedLabel = THEME_LABELS[theme];

  return (
    <div ref={rootRef} className="relative inline-flex items-center gap-2">
      {showLabel ? (
        <label
          htmlFor={selectId}
          className={cn(
            "text-xs font-semibold uppercase tracking-wide",
            variant === "default" && "text-[var(--ccr-muted)]",
            variant === "inverse" && "text-white",
          )}
        >
          Theme
        </label>
      ) : null}
      <button
        id={selectId}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Theme"
        className={cn(
          "inline-flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ccr-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ccr-surface)]",
          variant === "default" &&
            "border border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]",
          variant === "inverse" &&
            "border border-white/35 bg-[var(--ccr-primary-soft)] text-white hover:bg-white hover:text-[var(--ccr-primary)]",
          className,
        )}
      >
        <span className="min-w-[4.5rem] text-left">{selectedLabel}</span>
        <svg
          className={cn("h-4 w-4 transition-transform", open ? "rotate-180" : "")}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M5 7.5L10 12.5L15 7.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          className={cn(
            "absolute right-0 top-[calc(100%+0.35rem)] z-40 min-w-[10rem] overflow-hidden rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-2xl",
            variant === "inverse" && "bg-[var(--ccr-primary)]",
          )}
          role="listbox"
          aria-label="Theme options"
        >
          {APP_THEMES.map((item) => {
            const selected = item === theme;
            return (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  if (isAppTheme(item)) {
                    selectTheme(item);
                  }
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold transition-colors",
                  selected
                    ? "bg-[var(--ccr-accent)] text-white"
                    : "text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]",
                  variant === "inverse" &&
                    (selected
                      ? "bg-white text-[var(--ccr-primary)]"
                      : "text-white hover:bg-white/10"),
                )}
              >
                <span>{THEME_LABELS[item]}</span>
                {selected ? <span aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
