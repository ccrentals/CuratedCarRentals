"use client";

import { type ReactNode, useState } from "react";

type SlideDownPanelProps = {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

export function SlideDownPanel({
  title,
  description,
  defaultOpen = false,
  open,
  onOpenChange,
  children,
}: SlideDownPanelProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = typeof open === "boolean";
  const panelOpen = isControlled ? Boolean(open) : internalOpen;

  function setPanelOpen(nextOpen: boolean) {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        className="flex w-full items-start gap-3 text-left"
        aria-expanded={panelOpen}
      >
        <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]">
          <svg
            viewBox="0 0 20 20"
            className={`h-3.5 w-3.5 transition-transform duration-200 ${panelOpen ? "rotate-90" : ""}`}
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 4l6 6-6 6" />
          </svg>
        </span>
        <span className="flex-1">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">{description}</p>
          ) : null}
        </span>
      </button>

      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin-top] duration-300 ease-out ${
          panelOpen ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </section>
  );
}
