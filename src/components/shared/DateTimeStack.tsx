import { fmtDateNoSeconds } from "@/lib/dateFormat";
import { cn } from "@/lib/utils";

type DateTimeStackProps = {
  value: Date | string | number | null | undefined;
  className?: string;
  dateClassName?: string;
  timeClassName?: string;
  title?: string;
};

type DateTimeParts = {
  dateText: string;
  timeText: string | null;
};

function coerceDisplayLabel(value: Date | string | number) {
  if (value instanceof Date || typeof value === "number") {
    return fmtDateNoSeconds(value);
  }

  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return fmtDateNoSeconds(parsed);
  }

  return raw;
}

function splitDateTimeLabel(label: string): DateTimeParts | null {
  const normalized = String(label ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const commaIndex = normalized.indexOf(",");
  if (commaIndex >= 0) {
    const dateText = normalized.slice(0, commaIndex).trim();
    const timeText = normalized.slice(commaIndex + 1).trim();
    return {
      dateText,
      timeText: timeText || null,
    };
  }

  const dateAndTimeMatch = normalized.match(/^(.*?)(\d{1,2}:\d{2}\s?[AP]M)$/i);
  if (dateAndTimeMatch) {
    return {
      dateText: dateAndTimeMatch[1].trim().replace(/[,\s]+$/, ""),
      timeText: dateAndTimeMatch[2].replace(/\s+/g, " ").trim(),
    };
  }

  return {
    dateText: normalized.replace(/[,\s]+$/, ""),
    timeText: null,
  };
}

export function DateTimeStack({
  value,
  className,
  dateClassName,
  timeClassName,
  title,
}: DateTimeStackProps) {
  if (value === null || value === undefined || value === "") {
    return <span className={cn("inline-block", className)}>—</span>;
  }

  const displayLabel = coerceDisplayLabel(value);
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
