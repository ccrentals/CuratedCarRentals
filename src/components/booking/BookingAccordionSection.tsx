import type { ReactNode } from "react";
import { Check, ChevronDown, Lock } from "lucide-react";

import { cn } from "@/lib/utils";

type BookingAccordionSectionProps = {
  id: string;
  title: string;
  summary?: ReactNode;
  open: boolean;
  completed: boolean;
  locked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  testId?: string;
  children: ReactNode;
};

export function BookingAccordionSection({
  id,
  title,
  summary,
  open,
  completed,
  locked,
  disabled = false,
  onToggle,
  testId,
  children,
}: BookingAccordionSectionProps) {
  const headerId = `${id}-header`;
  const panelId = `${id}-panel`;

  return (
    <div
      id={id}
      className={cn(
        "min-w-0 scroll-mt-24 rounded-[1.35rem] border transition-colors duration-300 sm:scroll-mt-28",
        open
          ? "border-[var(--ccr-accent)]/60 bg-[var(--ccr-surface)] shadow-[0_18px_48px_rgba(15,23,42,0.08)]"
          : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]/90",
      )}
    >
      <h2 className="m-0">
        <button
          type="button"
          id={headerId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          disabled={locked || disabled}
          data-testid={testId}
          className="flex w-full min-w-0 items-center gap-3 rounded-[1.35rem] px-4 py-4 text-left transition disabled:cursor-not-allowed sm:px-5"
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
              completed && !open
                ? "border-emerald-500 bg-emerald-500 text-white"
                : open
                  ? "border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/15 text-[var(--ccr-text)]"
                  : "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-muted)]",
            )}
          >
            {completed && !open ? (
              <Check className="h-4 w-4" strokeWidth={3} />
            ) : locked ? (
              <Lock className="h-3.5 w-3.5" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-current" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block break-words text-base font-semibold sm:text-lg",
                locked ? "text-[var(--ccr-muted)]" : "text-[var(--ccr-text)]",
              )}
            >
              {title}
            </span>
            {summary && !open ? (
              <span className="mt-0.5 block truncate text-sm text-[var(--ccr-muted)]">{summary}</span>
            ) : null}
          </span>
          {completed && !open && !locked ? (
            <span className="hidden shrink-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ccr-accent-strong)] min-[430px]:inline">
              Edit
            </span>
          ) : null}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-5 w-5 shrink-0 text-[var(--ccr-muted)] transition-transform duration-300",
              open && "rotate-180",
              locked && "opacity-40",
            )}
          />
        </button>
      </h2>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-300 ease-out starting:grid-rows-[0fr] starting:opacity-0"
        >
          <div className="min-w-0 overflow-hidden">
            <div className="border-t border-[var(--ccr-border)] px-4 pb-5 pt-4 sm:px-5 sm:pb-6">
              {children}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
