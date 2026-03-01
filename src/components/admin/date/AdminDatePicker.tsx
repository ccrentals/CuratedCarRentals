"use client";

import { CalendarIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type AdminDatePickerProps = {
  value: string;
  onChange: (nextValue: string) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
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

export function AdminDatePicker({
  value,
  onChange,
  disabled,
  min,
  max,
  placeholder = "dd/mm/yyyy",
  className,
  buttonClassName,
}: AdminDatePickerProps) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => parseDateOnly(value), [value]);
  const minDate = useMemo(() => parseDateOnly(min ?? ""), [min]);
  const maxDate = useMemo(() => parseDateOnly(max ?? ""), [max]);

  return (
    <div className={cn("relative", className)}>
      <input type="hidden" value={value} onChange={(event) => onChange(event.target.value)} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[var(--ccr-border)]",
              "bg-transparent px-3 py-2 text-left text-sm text-[var(--ccr-text)]",
              "disabled:cursor-default disabled:opacity-80",
              buttonClassName,
            )}
          >
            <span className={cn(!value && "text-[var(--ccr-muted)]")}>{value || placeholder}</span>
            <CalendarIcon className="h-4 w-4 text-[var(--ccr-muted)]" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(date) => {
              onChange(toDateOnly(date));
              setOpen(false);
            }}
            disabled={(date) => {
              if (minDate && date < minDate) return true;
              if (maxDate && date > maxDate) return true;
              return false;
            }}
            initialFocus
          />
          <div className="flex items-center justify-end gap-2 border-t border-[var(--ccr-border)] p-2">
            <button
              type="button"
              onClick={() => onChange("")}
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
