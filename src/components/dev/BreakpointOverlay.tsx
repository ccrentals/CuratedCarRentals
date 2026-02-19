"use client";

import { useEffect, useMemo, useState } from "react";

type ViewportState = {
  width: number;
  height: number;
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeLeft: number;
};

const INITIAL_STATE: ViewportState = {
  width: 0,
  height: 0,
  safeTop: 0,
  safeRight: 0,
  safeBottom: 0,
  safeLeft: 0,
};

function getBreakpointLabel(width: number) {
  if (width >= 1536) return "2xl";
  if (width >= 1280) return "xl";
  if (width >= 1024) return "lg";
  if (width >= 768) return "md";
  if (width >= 640) return "sm";
  return "base";
}

function parsePx(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function readSafeAreaInsets(): Pick<ViewportState, "safeTop" | "safeRight" | "safeBottom" | "safeLeft"> {
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.style.paddingTop = "env(safe-area-inset-top)";
  probe.style.paddingRight = "env(safe-area-inset-right)";
  probe.style.paddingBottom = "env(safe-area-inset-bottom)";
  probe.style.paddingLeft = "env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const styles = window.getComputedStyle(probe);
  const safeTop = parsePx(styles.paddingTop);
  const safeRight = parsePx(styles.paddingRight);
  const safeBottom = parsePx(styles.paddingBottom);
  const safeLeft = parsePx(styles.paddingLeft);
  probe.remove();
  return { safeTop, safeRight, safeBottom, safeLeft };
}

export function BreakpointOverlay() {
  const hideForAutomatedBrowser = typeof navigator !== "undefined" && navigator.webdriver;

  const [viewport, setViewport] = useState<ViewportState>(INITIAL_STATE);

  useEffect(() => {
    const update = () => {
      const insets = readSafeAreaInsets();
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
        ...insets,
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  const breakpoint = useMemo(() => getBreakpointLabel(viewport.width), [viewport.width]);

  if (hideForAutomatedBrowser) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[9999] rounded-lg border border-black/20 bg-black/80 px-3 py-2 text-[10px] font-mono leading-tight text-white shadow-lg backdrop-blur-sm">
      <p>bp: {breakpoint}</p>
      <p>
        vp: {viewport.width} x {viewport.height}
      </p>
      <p>
        safe: {viewport.safeTop}/{viewport.safeRight}/{viewport.safeBottom}/{viewport.safeLeft}
      </p>
    </div>
  );
}
