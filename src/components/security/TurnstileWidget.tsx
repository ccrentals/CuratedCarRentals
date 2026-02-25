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

export function TurnstileWidget({
  action,
  onTokenChange,
  resetKey = 0,
  className,
  theme = "auto",
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) {
      if (process.env.NODE_ENV !== "production") {
        onTokenChange(TURNSTILE_DEV_BYPASS_TOKEN);
        setRenderError(null);
      } else {
        onTokenChange(null);
        setRenderError("Security check is unavailable right now. Please try again later.");
      }
      return;
    }

    onTokenChange(null);
    setRenderError(null);
    let cancelled = false;

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
        setRenderError("Unable to load security check. Refresh and try again.");
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [action, onTokenChange, theme]);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !widgetIdRef.current || !window.turnstile) return;
    onTokenChange(null);
    setRenderError(null);
    window.turnstile.reset(widgetIdRef.current);
  }, [onTokenChange, resetKey]);

  return (
    <div className={cn("space-y-2", className)}>
      {TURNSTILE_SITE_KEY ? <div ref={containerRef} /> : null}
      {!TURNSTILE_SITE_KEY && process.env.NODE_ENV !== "production" ? (
        <p className="text-xs text-[var(--ccr-muted)]">
          Turnstile bypass is active in local development because keys are not configured.
        </p>
      ) : null}
      {renderError ? <p className="text-xs text-rose-600">{renderError}</p> : null}
    </div>
  );
}
