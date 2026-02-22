import { DateRangeArrow } from "@/components/shared/DateRangeArrow";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { cn } from "@/lib/utils";

type StackedDateTimeRangeProps = {
  startLabel: string;
  endLabel: string;
  className?: string;
  textClassName?: string;
};

export function StackedDateTimeRange({
  startLabel,
  endLabel,
  className,
  textClassName,
}: StackedDateTimeRangeProps) {
  return (
    <span
      className={cn(
        "inline-grid grid-cols-[max-content_auto_max-content] items-center gap-x-2",
        className,
      )}
    >
      <TableDateTime value={startLabel} className={textClassName} />
      <DateRangeArrow size={15} className="mx-0 self-center" />
      <TableDateTime value={endLabel} className={textClassName} />
    </span>
  );
}
