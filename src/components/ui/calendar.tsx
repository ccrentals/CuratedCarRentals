"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-2", className)}
      classNames={{
        months: "flex flex-col gap-3 sm:flex-row sm:gap-4",
        month: "space-y-3",
        caption: "relative flex items-center justify-center px-8 py-1",
        caption_label: "text-sm font-semibold text-[var(--ccr-text)]",
        nav: "flex items-center gap-1",
        nav_button:
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)] hover:border-[var(--ccr-primary)] disabled:opacity-50",
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse",
        head_row: "flex",
        head_cell:
          "w-9 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]",
        row: "mt-1 flex w-full",
        cell: "relative h-9 w-9 p-0 text-center",
        day: cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-md text-sm",
          "text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ccr-accent)]",
        ),
        day_selected:
          "bg-[var(--ccr-primary)] text-white hover:bg-[var(--ccr-primary)] focus:bg-[var(--ccr-primary)]",
        day_today: "ring-1 ring-[var(--ccr-accent)]",
        day_outside: "text-[var(--ccr-muted)] opacity-50",
        day_disabled: "cursor-not-allowed opacity-40",
        day_range_start: "bg-[var(--ccr-primary)] text-white rounded-l-md rounded-r-none",
        day_range_end: "bg-[var(--ccr-primary)] text-white rounded-r-md rounded-l-none",
        day_range_middle: "bg-[var(--ccr-primary-soft)] text-[var(--ccr-text)] rounded-none",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ className: iconClassName, orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("h-4 w-4", iconClassName)} />
          ) : (
            <ChevronRight className={cn("h-4 w-4", iconClassName)} />
          ),
      }}
      {...props}
    />
  );
}

Calendar.displayName = "Calendar";

export { Calendar };
