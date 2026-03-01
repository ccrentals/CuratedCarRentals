"use client";

import { CalendarIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DateRange } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type AdminDateRangePickerProps = {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
};

function parseDateOnly(value: string): Date | undefined {
  const normalized = value.trim();
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return undefined;
  const date = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toDateOnly(value?: Date) {
  if (!value) return "";
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function AdminDateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
  disabled,
  className,
  placeholder = "Select date range",
}: AdminDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const range = useMemo<DateRange | undefined>(() => {
    const fromDate = parseDateOnly(from);
    const toDate = parseDateOnly(to);
    if (!fromDate && !toDate) return undefined;
    return { from: fromDate, to: toDate };
  }, [from, to]);

  const label = from && to ? `${from} - ${to}` : from ? `${from} - ...` : placeholder;

  return (
    <div className={cn("relative", className)}>
      <input type="hidden" value={from} onChange={(event) => onFromChange(event.target.value)} />
      <input type="hidden" value={to} onChange={(event) => onToChange(event.target.value)} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-left text-sm text-[var(--ccr-text)] disabled:cursor-default disabled:opacity-80"
          >
            <span className={cn(!from && !to && "text-[var(--ccr-muted)]")}>{label}</span>
            <CalendarIcon className="h-4 w-4 text-[var(--ccr-muted)]" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="w-auto p-0">
          <Calendar
            mode="range"
            selected={range}
            onSelect={(nextRange) => {
              onFromChange(toDateOnly(nextRange?.from));
              onToChange(toDateOnly(nextRange?.to));
              if (nextRange?.from && nextRange?.to) setOpen(false);
            }}
            numberOfMonths={1}
            initialFocus
          />
          <div className="flex items-center justify-end gap-2 border-t border-[var(--ccr-border)] p-2">
            <button
              type="button"
              onClick={() => {
                onFromChange("");
                onToChange("");
              }}
              className="rounded-md border border-[var(--ccr-border)] px-2 py-1 text-xs font-semibold text-[var(--ccr-muted)]"
            >
              Clear
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
