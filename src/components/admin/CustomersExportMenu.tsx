"use client";

import { useMemo, useState } from "react";

type CustomersExportMenuProps = {
  q: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

type ExportType = "csv" | "excel" | "pdf";

const EXPORT_OPTIONS: Array<{ type: ExportType; label: string }> = [
  { type: "csv", label: "Export CSV" },
  { type: "excel", label: "Export Excel" },
  { type: "pdf", label: "Export PDF" },
];

export function CustomersExportMenu({ q, sortBy, sortDir }: CustomersExportMenuProps) {
  const [open, setOpen] = useState(false);

  const exportHref = useMemo(() => {
    return (type: ExportType) => {
      const params = new URLSearchParams();
      params.set("export", type);
      if (q) params.set("q", q);
      if (sortBy) params.set("sortBy", sortBy);
      if (sortDir) params.set("sortDir", sortDir);
      return `/api/admin/customers?${params.toString()}`;
    };
  }, [q, sortBy, sortDir]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] sm:w-auto"
      >
        Export
        <svg
          viewBox="0 0 20 20"
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 7l5 6 5-6" />
        </svg>
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close export menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-2 w-40 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-1 shadow-lg">
            {EXPORT_OPTIONS.map((option) => (
              <a
                key={option.type}
                href={exportHref(option.type)}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]"
              >
                {option.label}
              </a>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
