"use client";

import { CalendarIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { parseMonthOnly, toMonthOnly } from "@/components/admin/date/dateUtils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type AdminMonthPickerProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: string;
  onChange: (nextValue: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  calendarButtonClassName?: string;
};

export function AdminMonthPicker({
  value,
  onChange,
  disabled,
  min,
  max,
  placeholder = "yyyy-mm",
  className,
  inputClassName,
  calendarButtonClassName,
  ...inputProps
}: AdminMonthPickerProps) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => parseMonthOnly(value), [value]);
  const minDate = useMemo(() => parseMonthOnly(min ?? ""), [min]);
  const maxDate = useMemo(() => parseMonthOnly(max ?? ""), [max]);

  return (
    <div className={cn("relative", className)}>
      <input
        type="month"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        min={min}
        max={max}
        placeholder={placeholder}
        className={cn(
          "min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 pr-11 text-sm text-[var(--ccr-text)]",
          "disabled:cursor-default disabled:opacity-80",
          inputClassName,
        )}
        {...inputProps}
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Open month picker"
            className={cn(
              "absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md",
              "border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-muted)]",
              "hover:border-[var(--ccr-primary)] disabled:opacity-70",
              calendarButtonClassName,
            )}
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>

        <PopoverContent align="end" side="bottom" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selected}
            month={selected}
            onSelect={(date) => {
              onChange(toMonthOnly(date));
              setOpen(false);
            }}
            disabled={(date) => {
              const monthDate = new Date(date.getFullYear(), date.getMonth(), 1);
              if (minDate && monthDate < new Date(minDate.getFullYear(), minDate.getMonth(), 1)) {
                return true;
              }
              if (maxDate && monthDate > new Date(maxDate.getFullYear(), maxDate.getMonth(), 1)) {
                return true;
              }
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
