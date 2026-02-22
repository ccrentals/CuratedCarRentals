import { ArrowBigRightDash } from "lucide-react";

type DateRangeArrowProps = {
  size?: number;
  className?: string;
};

export function DateRangeArrow({ size = 16, className = "" }: DateRangeArrowProps) {
  return (
    <span
      className={`mx-2 inline-flex shrink-0 items-center align-middle text-[var(--ccr-muted)] ${className}`}
      aria-hidden="true"
    >
      <ArrowBigRightDash size={size} aria-hidden="true" />
    </span>
  );
}

