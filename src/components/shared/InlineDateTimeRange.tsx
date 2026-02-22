import { DateRangeArrow } from "@/components/shared/DateRangeArrow";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { cn } from "@/lib/utils";

type InlineDateTimeRangeProps = {
  startLabel: string;
  endLabel: string;
  className?: string;
  textClassName?: string;
};

export function InlineDateTimeRange({
  startLabel,
  endLabel,
  className,
  textClassName,
}: InlineDateTimeRangeProps) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <DateTimeInline value={startLabel} className={textClassName} />
      <DateRangeArrow size={15} className="mx-1.5" />
      <DateTimeInline value={endLabel} className={textClassName} />
    </span>
  );
}
