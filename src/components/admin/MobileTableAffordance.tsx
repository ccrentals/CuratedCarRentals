import type { ReactNode } from "react";

type MobileTableAffordanceProps = {
  children: ReactNode;
  className?: string;
  helperText?: string;
  fadeColorClassName?: string;
};

export function MobileTableAffordance({
  children,
  className = "",
  helperText = "Swipe to see more ->",
  fadeColorClassName = "from-[var(--ccr-surface)]",
}: MobileTableAffordanceProps) {
  return (
    <div className={className}>
      <p className="px-1 pb-2 text-[11px] font-semibold tracking-wide text-[var(--ccr-muted)] md:hidden">
        {helperText}
      </p>
      <div className="relative">
        <div className="overflow-x-auto">{children}</div>
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l ${fadeColorClassName} to-transparent md:hidden`}
        />
      </div>
    </div>
  );
}
