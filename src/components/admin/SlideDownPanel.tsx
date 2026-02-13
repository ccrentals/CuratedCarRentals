"use client";

import { type ReactNode, useState } from "react";

type SlideDownPanelProps = {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function SlideDownPanel({
  title,
  description,
  defaultOpen = false,
  children,
}: SlideDownPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-start gap-3 text-left"
        aria-expanded={open}
      >
        <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md border border-[var(--ccr-accent)] text-[var(--ccr-accent)]">
          <svg
            viewBox="0 0 20 20"
            className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
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
          open ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </section>
  );
}
