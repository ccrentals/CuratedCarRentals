import Link from "next/link";
import type { ReactNode } from "react";

type PaginationSummaryProps = {
  from: number;
  to: number;
  totalCount: number;
  page: number;
  totalPages: number;
  className?: string;
  rightContent?: ReactNode;
};

type PaginationSummaryNavProps = {
  from: number;
  to: number;
  totalCount: number;
  page: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevHref: string;
  nextHref: string;
  className?: string;
};

export function PaginationSummary({
  from,
  to,
  totalCount,
  page,
  totalPages,
  className,
  rightContent,
}: PaginationSummaryProps) {
  if (totalCount < 1) return null;

  return (
    <div
      className={`mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ccr-muted)] ${className ?? ""}`.trim()}
    >
      <span>
        Showing {from}-{to} of {totalCount}
      </span>
      {rightContent ?? (
        <span className="font-semibold text-[var(--ccr-text)]">
          Page {page} of {totalPages}
        </span>
      )}
    </div>
  );
}

export function PaginationSummaryNav({
  from,
  to,
  totalCount,
  page,
  totalPages,
  hasPrev,
  hasNext,
  prevHref,
  nextHref,
  className,
}: PaginationSummaryNavProps) {
  return (
    <PaginationSummary
      from={from}
      to={to}
      totalCount={totalCount}
      page={page}
      totalPages={totalPages}
      className={className}
      rightContent={
        <div className="flex items-center gap-2">
          <Link
            href={prevHref}
            className={`rounded-lg border px-2 py-1 font-semibold ${
              hasPrev
                ? "border-[var(--ccr-border)] text-[var(--ccr-text)]"
                : "pointer-events-none border-[var(--ccr-border)]/40 text-[var(--ccr-muted)]/60"
            }`}
          >
            Prev
          </Link>
          <span className="font-semibold text-[var(--ccr-text)]">
            Page {page} of {totalPages}
          </span>
          <Link
            href={nextHref}
            className={`rounded-lg border px-2 py-1 font-semibold ${
              hasNext
                ? "border-[var(--ccr-border)] text-[var(--ccr-text)]"
                : "pointer-events-none border-[var(--ccr-border)]/40 text-[var(--ccr-muted)]/60"
            }`}
          >
            Next
          </Link>
        </div>
      }
    />
  );
}
