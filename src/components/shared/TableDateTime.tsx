import { cn } from "@/lib/utils";

import {
  coerceDateTimeLabel,
  splitDateTimeLabel,
  type DateTimeDisplayPreset,
  type DateTimeInput,
} from "@/components/shared/dateTimeDisplay";

type TableDateTimeProps = {
  value: DateTimeInput;
  className?: string;
  dateClassName?: string;
  timeClassName?: string;
  title?: string;
  preset?: DateTimeDisplayPreset;
};

export function TableDateTime({
  value,
  className,
  dateClassName,
  timeClassName,
  title,
  preset = "local",
}: TableDateTimeProps) {
  if (value === null || value === undefined || value === "") {
    return <span className={cn("inline-block", className)}>—</span>;
  }

  const displayLabel = coerceDateTimeLabel(value, preset);
  const parts = splitDateTimeLabel(displayLabel);

  if (!parts || !parts.dateText) {
    return <span className={cn("inline-block", className)}>—</span>;
  }

  return (
    <span className={cn("inline-flex min-w-0 flex-col leading-5", className)} title={title}>
      <span className={cn("block", dateClassName)}>{parts.dateText}</span>
      {parts.timeText ? (
        <span className={cn("block whitespace-nowrap", timeClassName)}>{parts.timeText}</span>
      ) : null}
    </span>
  );
}
