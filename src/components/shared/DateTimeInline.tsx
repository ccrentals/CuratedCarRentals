import { cn } from "@/lib/utils";

import { coerceDateTimeLabel, type DateTimeInput } from "@/components/shared/dateTimeDisplay";

type DateTimeInlineProps = {
  value: DateTimeInput;
  className?: string;
  title?: string;
};

export function DateTimeInline({ value, className, title }: DateTimeInlineProps) {
  if (value === null || value === undefined || value === "") {
    return <span className={cn("inline-block", className)}>—</span>;
  }

  const displayLabel = coerceDateTimeLabel(value);
  if (!displayLabel) {
    return <span className={cn("inline-block", className)}>—</span>;
  }

  return (
    <span className={cn("inline-block", className)} title={title}>
      {displayLabel}
    </span>
  );
}
