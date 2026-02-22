export type SortDir = "asc" | "desc";

export type SortState = {
  sortBy?: string;
  sortDir?: SortDir;
};

type ReadableSearchParams = {
  get(name: string): string | null;
  toString(): string;
};

type LegacySortMapping = {
  sortBy: string;
  sortDir?: SortDir;
};

type ReadSortOptions = {
  allowedSortBy?: readonly string[];
  defaultSortBy?: string;
  defaultSortDir?: SortDir;
  legacySortParam?: string;
  legacySortMap?: Record<string, LegacySortMapping>;
};

export function normalizeSortDir(value: unknown): SortDir | undefined {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "asc") return "asc";
  if (normalized === "desc") return "desc";
  return undefined;
}

function isAllowedSortBy(value: string | undefined, allowedSortBy?: readonly string[]) {
  if (!value) return false;
  if (!allowedSortBy || allowedSortBy.length === 0) return true;
  return allowedSortBy.includes(value);
}

export function readSortFromSearchParams(
  params: ReadableSearchParams,
  options?: ReadSortOptions,
): SortState {
  const defaultSortBy = options?.defaultSortBy;
  const defaultSortDir = options?.defaultSortDir ?? "asc";
  const allowedSortBy = options?.allowedSortBy;

  let sortBy = params.get("sortBy")?.trim() || undefined;
  let sortDir = normalizeSortDir(params.get("sortDir"));

  if (!sortBy && options?.legacySortParam) {
    const legacyRaw = params.get(options.legacySortParam)?.trim().toLowerCase();
    if (legacyRaw && options.legacySortMap?.[legacyRaw]) {
      const mapped = options.legacySortMap[legacyRaw];
      sortBy = mapped.sortBy;
      sortDir = mapped.sortDir ?? sortDir;
    }
  }

  if (!isAllowedSortBy(sortBy, allowedSortBy)) {
    sortBy = undefined;
    sortDir = undefined;
  }

  if (!sortBy && defaultSortBy) {
    sortBy = defaultSortBy;
  }

  if (!sortBy) {
    return {};
  }

  return {
    sortBy,
    sortDir: sortDir ?? defaultSortDir,
  };
}

export function nextSort(
  current: SortState,
  columnKey: string,
  defaultDirection: SortDir = "asc",
): SortState {
  if (current.sortBy !== columnKey) {
    return {
      sortBy: columnKey,
      sortDir: defaultDirection,
    };
  }

  return {
    sortBy: columnKey,
    sortDir: current.sortDir === "asc" ? "desc" : "asc",
  };
}

export function applySortToSearchParams(
  paramsInput: URLSearchParams | ReadableSearchParams,
  next: SortState,
) {
  const params = new URLSearchParams(paramsInput.toString());
  params.delete("page");
  params.delete("cursor");
  params.delete("sort");

  if (!next.sortBy) {
    params.delete("sortBy");
    params.delete("sortDir");
    return params;
  }

  params.set("sortBy", next.sortBy);
  params.set("sortDir", next.sortDir ?? "asc");
  return params;
}

export function ariaSortValue(
  current: SortState,
  columnKey: string,
): "none" | "ascending" | "descending" {
  if (current.sortBy !== columnKey) return "none";
  return current.sortDir === "desc" ? "descending" : "ascending";
}
