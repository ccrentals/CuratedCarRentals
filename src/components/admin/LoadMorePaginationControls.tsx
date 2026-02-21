"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PaginationSummary } from "@/components/admin/PaginationSummaryNav";
import { buildLoadedPaginationProgress, STANDARD_PAGE_SIZE_OPTIONS } from "@/lib/pagination/sharedPagination";

type LoadMorePaginationControlsProps = {
  pageSize: number;
  loadedCount: number;
  totalCount: number;
  rowsParam?: string;
  visibleParam?: string;
  noMoreLabel?: string;
};

export function LoadMorePaginationControls({
  pageSize,
  loadedCount,
  totalCount,
  rowsParam = "rows",
  visibleParam = "visible",
  noMoreLabel = "No more records",
}: LoadMorePaginationControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pagination = buildLoadedPaginationProgress(loadedCount, totalCount, pageSize);
  const hasMore = loadedCount < totalCount;

  const replaceParams = (nextParams: URLSearchParams) => {
    const next = nextParams.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const handleRowsChange = (nextValue: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(rowsParam, nextValue);
    params.set(visibleParam, nextValue);
    replaceParams(params);
  };

  const handleLoadMore = () => {
    if (!hasMore) return;
    const params = new URLSearchParams(searchParams.toString());
    const nextVisible = Math.min(totalCount, loadedCount + pageSize);
    params.set(visibleParam, String(nextVisible));
    replaceParams(params);
  };

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--ccr-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
        Rows per page
        <select
          value={String(pageSize)}
          onChange={(event) => handleRowsChange(event.target.value)}
          className="cursor-pointer rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
        >
          {STANDARD_PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={String(size)}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        <PaginationSummary
          from={pagination.from}
          to={pagination.to}
          totalCount={totalCount}
          page={pagination.page}
          totalPages={pagination.totalPages}
          className="mt-0 shrink-0 flex-nowrap justify-end gap-3 whitespace-nowrap"
        />
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={!hasMore || totalCount === 0}
          className="cursor-pointer rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {hasMore ? "Load more" : noMoreLabel}
        </button>
      </div>
    </div>
  );
}
