"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { TURNSTILE_DEV_BYPASS_TOKEN, type TurnstileAction } from "@/lib/security/turnstileShared";

type TurnstileWidgetProps = {
  action: TurnstileAction;
  onTokenChange: (token: string | null) => void;
  resetKey?: number;
  className?: string;
  theme?: "auto" | "light" | "dark";
  devBypassEnabled?: boolean;
};

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "auto" | "light" | "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
const TURNSTILE_PUBLIC_DEV_BYPASS =
  (process.env.NEXT_PUBLIC_TURNSTILE_DEV_BYPASS?.trim() ?? "") === "1";
const SCRIPT_ID = "ccr-turnstile-script";
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoadPromise: Promise<void> | null = null;

function loadTurnstileScript() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Turnstile script")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile script"));
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

function resetTurnstileScriptState() {
  scriptLoadPromise = null;
  if (typeof window !== "undefined") {
    window.turnstile = undefined;
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) existing.remove();
  }
}

export function TurnstileWidget({
  action,
  onTokenChange,
  resetKey = 0,
  className,
  theme = "auto",
  devBypassEnabled = TURNSTILE_PUBLIC_DEV_BYPASS,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [widgetRenderKey, setWidgetRenderKey] = useState(0);
  const devBypassActive = process.env.NODE_ENV !== "production" && devBypassEnabled;

  function retryRender() {
    if (devBypassActive) {
      onTokenChange(TURNSTILE_DEV_BYPASS_TOKEN);
      setRenderError(null);
      return;
    }
    onTokenChange(null);
    setRenderError(null);
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.remove(widgetIdRef.current);
    }
    widgetIdRef.current = null;
    resetTurnstileScriptState();
    setWidgetRenderKey((value) => value + 1);
  }

  useEffect(() => {
    if (devBypassActive) {
      onTokenChange(TURNSTILE_DEV_BYPASS_TOKEN);
      const clearErrorTimer = window.setTimeout(() => {
        setRenderError(null);
      }, 0);
      return () => {
        window.clearTimeout(clearErrorTimer);
      };
    }

    if (!TURNSTILE_SITE_KEY) {
      let nextError: string | null = null;
      onTokenChange(null);
      if (process.env.NODE_ENV !== "production") {
        nextError =
          "Security check isn't configured for this environment. Configure Turnstile keys or set TURNSTILE_DEV_BYPASS=1 for local testing.";
      } else {
        nextError = "Security check is currently unavailable. Please try again.";
      }
      const errorTimer = window.setTimeout(() => {
        setRenderError(nextError);
      }, 0);
      return () => {
        window.clearTimeout(errorTimer);
      };
    }

    onTokenChange(null);
    let cancelled = false;
    const clearErrorTimer = window.setTimeout(() => {
      setRenderError(null);
    }, 0);

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) {
          return;
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          theme,
          callback: (token) => {
            setRenderError(null);
            onTokenChange(token);
          },
          "expired-callback": () => {
            onTokenChange(null);
            setRenderError("Security check expired. Please complete it again.");
            if (widgetIdRef.current && window.turnstile) {
              window.turnstile.reset(widgetIdRef.current);
            }
          },
          "error-callback": () => {
            onTokenChange(null);
            setRenderError("Security check failed. Please retry.");
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        onTokenChange(null);
        resetTurnstileScriptState();
        setRenderError(
          "Security check couldn't load. Please disable ad-blockers or try another network, then Retry.",
        );
      });

    return () => {
      cancelled = true;
      window.clearTimeout(clearErrorTimer);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [action, devBypassActive, onTokenChange, theme, widgetRenderKey]);

  useEffect(() => {
    if (devBypassActive) {
      onTokenChange(TURNSTILE_DEV_BYPASS_TOKEN);
      const clearErrorTimer = window.setTimeout(() => {
        setRenderError(null);
      }, 0);
      return () => {
        window.clearTimeout(clearErrorTimer);
      };
    }
    if (!TURNSTILE_SITE_KEY || !widgetIdRef.current || !window.turnstile) return;
    onTokenChange(null);
    const clearErrorTimer = window.setTimeout(() => {
      setRenderError(null);
    }, 0);
    window.turnstile.reset(widgetIdRef.current);
    return () => {
      window.clearTimeout(clearErrorTimer);
    };
  }, [devBypassActive, onTokenChange, resetKey]);

  return (
    <div className={cn("space-y-2", className)}>
      {!devBypassActive && TURNSTILE_SITE_KEY ? (
        <div ref={containerRef} key={widgetRenderKey} data-testid="turnstile-container" />
      ) : null}
      {devBypassActive ? (
        <p className="text-xs text-[var(--ccr-muted)]" data-testid="turnstile-dev-bypass-note">
          Security check disabled (local dev)
        </p>
      ) : null}
      {renderError ? (
        <div className="space-y-2">
          <p className="text-xs text-rose-600" data-testid="turnstile-error-message">
            {renderError}
          </p>
          {!devBypassActive ? (
            <button
              type="button"
              onClick={retryRender}
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]"
              data-testid="turnstile-retry-button"
            >
              Retry security check
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
