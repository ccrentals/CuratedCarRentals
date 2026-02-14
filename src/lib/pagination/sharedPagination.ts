export const STANDARD_PAGE_SIZE_OPTIONS = [10, 30, 50] as const;

export type StandardPageSize = (typeof STANDARD_PAGE_SIZE_OPTIONS)[number];

export function parsePositiveIntParam(value: string | string[] | undefined) {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function normalizePageSize(
  value: unknown,
  options: readonly number[] = STANDARD_PAGE_SIZE_OPTIONS,
  fallback = 10,
) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && options.includes(numeric)) {
    return numeric;
  }
  return fallback;
}

export type PaginationSlice<T> = {
  rows: T[];
  page: number;
  totalPages: number;
  totalCount: number;
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
};

export type PaginationProgress = {
  from: number;
  to: number;
  page: number;
  totalPages: number;
};

export function paginateRows<T>(
  rows: T[],
  pageValue: string | string[] | undefined,
  pageSize: number,
): PaginationSlice<T> {
  const totalCount = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const requested = parsePositiveIntParam(pageValue) ?? 1;
  const page = Math.min(Math.max(1, requested), totalPages);
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalCount);

  return {
    rows: rows.slice(startIndex, endIndex),
    page,
    totalPages,
    totalCount,
    from: totalCount === 0 ? 0 : startIndex + 1,
    to: endIndex,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

export function buildLoadedPaginationProgress(
  loadedCount: number,
  totalCount: number,
  pageSize: number,
): PaginationProgress {
  const safeLoaded = Number.isFinite(loadedCount) ? Math.max(0, Math.floor(loadedCount)) : 0;
  const safeTotal = Number.isFinite(totalCount) ? Math.max(0, Math.floor(totalCount)) : 0;
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 10;
  const clampedTo = Math.min(safeLoaded, safeTotal);
  const from = clampedTo > 0 ? 1 : 0;
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const page = Math.min(totalPages, Math.max(1, Math.ceil(clampedTo / safePageSize)));

  return {
    from,
    to: clampedTo,
    page,
    totalPages,
  };
}
