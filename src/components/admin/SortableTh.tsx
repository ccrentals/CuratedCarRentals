"use client";

import Link from "next/link";

import {
  ariaSortValue,
  nextSort,
  type SortDir,
  type SortState,
} from "@/components/admin/tableSort";

function ChevronsUpDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}

function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

type SortableThProps = {
  label: string;
  columnKey: string;
  sort: SortState;
  onChange?: (next: SortState) => void;
  href?: string;
  className?: string;
  title?: string;
  defaultDirection?: SortDir;
};

export function SortableTh({
  label,
  columnKey,
  sort,
  onChange,
  href,
  className = "px-4 py-3",
  title,
  defaultDirection = "asc",
}: SortableThProps) {
  const isActive = sort.sortBy === columnKey;
  const sortDir = isActive ? sort.sortDir ?? defaultDirection : undefined;
  const iconClass = `h-[16px] w-[16px] ${
    isActive ? "text-[var(--ccr-text)]" : "text-[var(--ccr-muted)]"
  }`;
  const commonControlClass =
    "inline-flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] transition hover:text-[var(--ccr-text)]";
  const next = nextSort(sort, columnKey, defaultDirection);

  return (
    <th className={className} aria-sort={ariaSortValue(sort, columnKey)}>
      {onChange ? (
        <button
          type="button"
          title={title ?? label}
          onClick={() => onChange(next)}
          className={commonControlClass}
          aria-label={`Sort by ${label}`}
        >
          <span>{label}</span>
          {isActive ? (
            sortDir === "desc" ? (
              <ChevronDownIcon className={iconClass} />
            ) : (
              <ChevronUpIcon className={iconClass} />
            )
          ) : (
            <ChevronsUpDownIcon className={iconClass} />
          )}
        </button>
      ) : href ? (
        <Link href={href} title={title ?? label} className={commonControlClass} aria-label={`Sort by ${label}`}>
          <span>{label}</span>
          {isActive ? (
            sortDir === "desc" ? (
              <ChevronDownIcon className={iconClass} />
            ) : (
              <ChevronUpIcon className={iconClass} />
            )
          ) : (
            <ChevronsUpDownIcon className={iconClass} />
          )}
        </Link>
      ) : (
        <span className={commonControlClass}>{label}</span>
      )}
    </th>
  );
}

