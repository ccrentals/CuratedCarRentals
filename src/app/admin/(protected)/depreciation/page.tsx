import Link from "next/link";

import { LoadMorePaginationControls } from "@/components/admin/LoadMorePaginationControls";
import { SortableTh } from "@/components/admin/SortableTh";
import {
  applySortToSearchParams,
  nextSort,
  readSortFromSearchParams,
  type SortDir,
} from "@/components/admin/tableSort";
import { formatJmdFromCents } from "@/lib/money";
import {
  normalizePageSize,
  parsePositiveIntParam,
} from "@/lib/pagination/sharedPagination";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";
import {
  DEPRECIATION_REPORT_SORT_COLUMNS,
  listDepreciationFilterOptions,
  listDepreciationReport,
  type DepreciationReportItem,
  type DepreciationReportSortBy,
} from "@/lib/vehicles/depreciationReport";

type SortState = {
  sortBy: DepreciationReportSortBy;
  sortDir: SortDir;
};

function normalizeSort(searchParams: URLSearchParams): SortState {
  const sort = readSortFromSearchParams(searchParams, {
    allowedSortBy: DEPRECIATION_REPORT_SORT_COLUMNS,
    defaultSortBy: "vehicle",
    defaultSortDir: "asc",
  });

  return {
    sortBy: (sort.sortBy as DepreciationReportSortBy | undefined) ?? "vehicle",
    sortDir: (sort.sortDir as SortDir | undefined) ?? "asc",
  };
}

function normalizeFilter(value: string | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, 80) : "";
}

function monthFieldValue(value: string) {
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

function metricsLabel(value: number | null, incompleteReason: string | null) {
  if (value !== null && Number.isFinite(value)) {
    return formatJmdFromCents(value);
  }
  if (incompleteReason) {
    return "Incomplete finance info";
  }
  return "—";
}

export default async function AdminDepreciationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") queryParams.set(key, value);
  }

  const asOfMonthParam = normalizeFilter(
    typeof params.asOfMonth === "string" ? params.asOfMonth : undefined,
  );
  const vehicleClass = normalizeFilter(
    typeof params.vehicleClass === "string" ? params.vehicleClass : undefined,
  );
  const vehicleType = normalizeFilter(
    typeof params.vehicleType === "string" ? params.vehicleType : undefined,
  );
  const sort = normalizeSort(queryParams);
  const rowsPerPage = normalizePageSize(
    typeof params.rows === "string" ? params.rows : undefined,
  );
  const requestedVisible = parsePositiveIntParam(params.visible);
  const visibleCount = Math.max(rowsPerPage, requestedVisible ?? rowsPerPage);

  let tableMissing = false;
  let reportItems: DepreciationReportItem[] = [];
  let asOfMonth = new Date().toISOString().slice(0, 10);
  let filterOptions: { vehicleClasses: string[]; vehicleTypes: string[] } = {
    vehicleClasses: [],
    vehicleTypes: [],
  };

  try {
    const [report, options] = await Promise.all([
      listDepreciationReport({
        asOfMonth: asOfMonthParam || null,
        vehicleClass: vehicleClass || null,
        vehicleType: vehicleType || null,
        sortBy: sort.sortBy,
        sortDir: sort.sortDir,
      }),
      listDepreciationFilterOptions(),
    ]);

    reportItems = report.items;
    asOfMonth = report.asOfMonth;
    filterOptions = options;
  } catch (error) {
    if (!isVehicleExtensionsMissingTableError(error)) {
      throw error;
    }
    tableMissing = true;
  }

  const visibleRows = reportItems.slice(0, visibleCount);

  const sortHref = (columnKey: DepreciationReportSortBy, defaultDirection: SortDir) => {
    const next = nextSort(sort, columnKey, defaultDirection);
    const nextParams = applySortToSearchParams(queryParams, next);
    const queryString = nextParams.toString();
    return queryString
      ? `/admin/depreciation?${queryString}`
      : "/admin/depreciation";
  };

  const exportParams = new URLSearchParams();
  exportParams.set("asOfMonth", asOfMonth);
  if (vehicleClass) exportParams.set("vehicleClass", vehicleClass);
  if (vehicleType) exportParams.set("vehicleType", vehicleType);
  exportParams.set("sortBy", sort.sortBy);
  exportParams.set("sortDir", sort.sortDir);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Admin
          </p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Depreciation</h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Track fleet purchase values, monthly depreciation, and current book value.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/api/admin/depreciation/export?${exportParams.toString()}`}
            className="min-h-11 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Export CSV
          </Link>
          <Link
            href="/admin/vehicles"
            className="min-h-11 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Vehicles
          </Link>
        </div>
      </div>

      <form className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            As Of Month
            <input
              type="month"
              name="asOfMonth"
              defaultValue={monthFieldValue(asOfMonth)}
              className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Vehicle Class
            <select
              name="vehicleClass"
              defaultValue={vehicleClass}
              className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="">All</option>
              {filterOptions.vehicleClasses.map((option) => (
                <option key={`class-${option}`} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Vehicle Type
            <select
              name="vehicleType"
              defaultValue={vehicleType}
              className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="">All</option>
              {filterOptions.vehicleTypes.map((option) => (
                <option key={`type-${option}`} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white"
          >
            Apply filters
          </button>
          <Link
            href="/admin/depreciation"
            className="min-h-11 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Reset
          </Link>
        </div>
      </form>

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {tableMissing ? (
          <div className="px-6 py-4 text-sm text-amber-100">
            Depreciation tables are not installed yet. Apply the latest migration.
          </div>
        ) : null}

        {!tableMissing && reportItems.length < 1 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            No vehicle finance records found.
          </div>
        ) : null}

        {!tableMissing && reportItems.length > 0 ? (
          <>
            <div className="divide-y divide-[var(--ccr-border)] md:hidden">
              {visibleRows.map((row) => (
                <article
                  key={`mobile-${row.vehicleId}`}
                  className="space-y-3 px-4 py-4"
                  data-testid="depreciation-mobile-card"
                >
                  <div>
                    <p className="font-semibold text-[var(--ccr-text)]">
                      {row.year} {row.make} {row.model}
                    </p>
                    <p className="text-xs text-[var(--ccr-muted)]">
                      {row.vehicleClass || "Unclassified"}
                      {row.vehicleType ? ` · ${row.vehicleType}` : ""}
                    </p>
                  </div>

                  <dl className="grid grid-cols-1 gap-2 text-xs text-[var(--ccr-muted)]">
                    <div>
                      <dt>Purchase Cost</dt>
                      <dd className="text-sm font-semibold text-[var(--ccr-text)]">
                        {row.purchaseCostCents === null
                          ? "—"
                          : formatJmdFromCents(row.purchaseCostCents)}
                      </dd>
                    </div>
                    <div>
                      <dt>Current Book Value</dt>
                      <dd className="text-sm font-semibold text-[var(--ccr-text)]">
                        {metricsLabel(row.bookValueCents, row.incompleteReason)}
                      </dd>
                    </div>
                    <div>
                      <dt>Accumulated Depreciation</dt>
                      <dd className="text-sm font-semibold text-[var(--ccr-text)]">
                        {metricsLabel(
                          row.accumulatedDepreciationCents,
                          row.incompleteReason,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Monthly Depreciation</dt>
                      <dd className="text-sm font-semibold text-[var(--ccr-text)]">
                        {metricsLabel(row.monthlyDepreciationCents, row.incompleteReason)}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex gap-2">
                    <Link
                      href={`/admin/vehicles/${row.vehicleId}?tab=depreciation`}
                      className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                    >
                      View
                    </Link>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                  <tr>
                    <SortableTh
                      label="Vehicle"
                      columnKey="vehicle"
                      sort={sort}
                      href={sortHref("vehicle", "asc")}
                    />
                    <SortableTh
                      label="Purchase Cost"
                      columnKey="purchaseCost"
                      sort={sort}
                      href={sortHref("purchaseCost", "desc")}
                    />
                    <SortableTh
                      label="Current Book Value"
                      columnKey="bookValue"
                      sort={sort}
                      href={sortHref("bookValue", "desc")}
                    />
                    <SortableTh
                      label="Accumulated Depreciation"
                      columnKey="accumulated"
                      sort={sort}
                      href={sortHref("accumulated", "desc")}
                    />
                    <SortableTh
                      label="Monthly Depreciation"
                      columnKey="monthly"
                      sort={sort}
                      href={sortHref("monthly", "desc")}
                    />
                  </tr>
                </thead>

                <tbody>
                  {visibleRows.map((row) => (
                    <tr
                      key={row.vehicleId}
                      className="border-b border-[var(--ccr-border)] last:border-b-0"
                    >
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        <Link
                          href={`/admin/vehicles/${row.vehicleId}?tab=depreciation`}
                          className="font-semibold text-[var(--ccr-text)]"
                        >
                          {row.year} {row.make} {row.model}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        {row.purchaseCostCents === null
                          ? "—"
                          : formatJmdFromCents(row.purchaseCostCents)}
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-muted)]">
                        {metricsLabel(row.bookValueCents, row.incompleteReason)}
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-muted)]">
                        {metricsLabel(row.accumulatedDepreciationCents, row.incompleteReason)}
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-muted)]">
                        {metricsLabel(row.monthlyDepreciationCents, row.incompleteReason)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <LoadMorePaginationControls
              pageSize={rowsPerPage}
              loadedCount={visibleRows.length}
              totalCount={reportItems.length}
              noMoreLabel="No more depreciation rows"
            />
          </>
        ) : null}
      </section>
    </div>
  );
}
