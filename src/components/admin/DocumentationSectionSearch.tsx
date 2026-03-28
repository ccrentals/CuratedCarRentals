"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DocumentationSearchEntry,
  DocumentationSectionLink,
} from "@/lib/documentation/catalog";

type DocumentationSectionSearchProps = {
  initialQuery: string;
  sections: readonly DocumentationSectionLink[];
  searchEntries: readonly DocumentationSearchEntry[];
};

function excerptForQuery(text: string, query: string, fallback: string, maxLength = 180) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  if (!query) {
    return compact.length > maxLength ? `${compact.slice(0, maxLength).trimEnd()}...` : compact;
  }

  const normalizedText = compact.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const matchIndex = normalizedText.indexOf(normalizedQuery);

  if (matchIndex < 0) {
    return fallback || (compact.length > maxLength ? `${compact.slice(0, maxLength).trimEnd()}...` : compact);
  }

  const start = Math.max(0, matchIndex - Math.floor(maxLength / 3));
  const end = Math.min(compact.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < compact.length ? "..." : "";
  return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

function resultTypeLabel(type: DocumentationSearchEntry["type"]) {
  if (type === "notes") return "Notes";
  if (type === "topic") return "Topic";
  return "Section";
}

export function DocumentationSectionSearch({
  initialQuery,
  sections,
  searchEntries,
}: DocumentationSectionSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);

  const queryParam = searchParams.get("q") ?? initialQuery;
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    if (queryParam !== query) {
      setQuery(queryParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParam]);

  const updateQueryParam = useCallback(
    (nextQuery: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextQuery) {
        params.set("q", nextQuery);
      } else {
        params.delete("q");
      }

      const next = params.toString();
      const nextUrl = next ? `${pathname}?${next}` : pathname;
      const current = searchParams.toString();
      const currentUrl = current ? `${pathname}?${current}` : pathname;

      if (nextUrl !== currentUrl) {
        router.replace(nextUrl, { scroll: false });
      }
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = query.trim();
      const current = searchParams.get("q") ?? "";
      if (trimmed === current) return;
      updateQueryParam(trimmed);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query, searchParams, updateQueryParam]);

  const filteredResults = useMemo(() => {
    if (!normalizedQuery) return [];

    return searchEntries.filter((entry) =>
      entry.searchText.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, searchEntries]);

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[260px] flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Search documentation
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sections, topics, and notes"
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm font-medium normal-case tracking-normal text-[var(--ccr-text)] outline-none transition focus:border-[var(--ccr-accent-strong)]"
            />
          </label>
          {normalizedQuery ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)] transition hover:bg-[var(--ccr-bg)]"
            >
              Clear
            </button>
          ) : null}
        </div>
        {normalizedQuery ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            <span>{filteredResults.length} result{filteredResults.length === 1 ? "" : "s"}</span>
            <span aria-hidden="true">•</span>
            <span>Searching sections, topics, and notes</span>
          </div>
        ) : null}
      </div>

      {normalizedQuery ? (
        filteredResults.length ? (
          <div className="space-y-3">
            {filteredResults.map((entry) => (
              <Link
                key={entry.id}
                href={entry.href}
                className="block rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 transition hover:bg-[var(--ccr-surface-soft)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      {resultTypeLabel(entry.type)}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      {entry.sectionLabel}
                    </span>
                  </div>
                  <span className="rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Open
                  </span>
                </div>
                <h3 className="mt-3 text-base font-bold text-[var(--ccr-text)]">{entry.title}</h3>
                <p className="mt-2 text-sm text-[var(--ccr-muted)]">
                  {excerptForQuery(entry.snippetSource, normalizedQuery, entry.snippet)}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-6 text-sm text-[var(--ccr-muted)]">
            No documentation matches this search. Try terms like{" "}
            <span className="font-semibold text-[var(--ccr-text)]">security</span>,{" "}
            <span className="font-semibold text-[var(--ccr-text)]">csrf</span>,{" "}
            <span className="font-semibold text-[var(--ccr-text)]">webhook</span>, or{" "}
            <span className="font-semibold text-[var(--ccr-text)]">notes</span>.
          </div>
        )
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="group rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 transition hover:bg-[var(--ccr-surface-soft)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-[var(--ccr-text)]">{section.label}</h3>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">{section.description}</p>
                </div>
                <span className="mt-0.5 rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)] group-hover:text-[var(--ccr-text)]">
                  Open
                </span>
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[var(--ccr-muted)]">
                {section.topics.map((topic) => (
                  <li key={topic}>{topic}</li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
