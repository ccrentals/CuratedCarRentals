"use client";

import { useMemo } from "react";

import { AdminDatePicker } from "@/components/admin/date/AdminDatePicker";
import { cn } from "@/lib/utils";

type AdminDateTimePickerProps = {
  value: string;
  onChange: (nextValue: string) => void;
  disabled?: boolean;
  className?: string;
};

function splitDateTime(value: string) {
  const normalized = value.trim();
  if (!normalized) return { date: "", time: "" };
  const [datePart, timePart = ""] = normalized.split("T");
  return { date: datePart ?? "", time: (timePart ?? "").slice(0, 5) };
}

function joinDateTime(date: string, time: string) {
  if (!date) return "";
  const safeTime = (time || "00:00").slice(0, 5);
  return `${date}T${safeTime}`;
}

export function AdminDateTimePicker({ value, onChange, disabled, className }: AdminDateTimePickerProps) {
  const parts = useMemo(() => splitDateTime(value), [value]);

  return (
    <div className={cn("grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]", className)}>
      <AdminDatePicker
        value={parts.date}
        onChange={(nextDate) => onChange(joinDateTime(nextDate, parts.time))}
        disabled={disabled}
      />
      <input
        type="time"
        step={60}
        value={parts.time}
        disabled={disabled}
        onChange={(event) => onChange(joinDateTime(parts.date, event.target.value))}
        className="min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:cursor-default disabled:opacity-80"
      />
    </div>
  );
}
