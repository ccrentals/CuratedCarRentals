import Link from "next/link";

import { LoadMorePaginationControls } from "@/components/admin/LoadMorePaginationControls";
import { MaintenanceFilters } from "@/components/admin/MaintenanceFilters";
import { SortableTh } from "@/components/admin/SortableTh";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import {
  applySortToSearchParams,
  nextSort,
  readSortFromSearchParams,
  type SortDir,
} from "@/components/admin/tableSort";
import { dbQuery } from "@/lib/db";
import { formatJmd } from "@/lib/money";
import { normalizeMaintenanceSearchTerm } from "@/lib/maintenance/normalize";
import { normalizePageSize, parsePositiveIntParam } from "@/lib/pagination/sharedPagination";
import {
  listUpcomingMaintenance,
  type MaintenanceDueState,
  type MaintenanceRecordCategory,
  type MaintenanceRecordStatus,
  type UpcomingMaintenanceItem,
} from "@/lib/vehicles/maintenance";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const SORT_COLUMNS = ["vehicle", "item", "status", "date", "total"] as const;
type SortBy = (typeof SORT_COLUMNS)[number];

type DueScope = "all" | "overdue" | "due_soon" | "upcoming" | "completed";

const DUE_SCOPE_LABELS: Record<DueScope, string> = {
  all: "All",
  overdue: "Overdue",
  due_soon: "Due Soon",
  upcoming: "Upcoming",
  completed: "Completed",
};

type StatusOption = "all" | MaintenanceRecordStatus;
type CategoryOption = "all" | MaintenanceRecordCategory;

function normalizeSort(queryParams: URLSearchParams): { sortBy: SortBy; sortDir: SortDir } {
  const sort = readSortFromSearchParams(queryParams, {
    allowedSortBy: SORT_COLUMNS,
    defaultSortBy: "date",
    defaultSortDir: "asc",
  });
  return {
    sortBy: (sort.sortBy as SortBy | undefined) ?? "date",
    sortDir: (sort.sortDir as SortDir | undefined) ?? "asc",
  };
}

function normalizeScope(value: string | undefined): DueScope {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "overdue") return "overdue";
  if (normalized === "due_soon") return "due_soon";
  if (normalized === "upcoming") return "upcoming";
  if (normalized === "completed") return "completed";
  return "all";
}

function normalizeStatus(value: string | undefined): StatusOption {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (
    normalized === "SCHEDULED" ||
    normalized === "IN_PROGRESS" ||
    normalized === "COMPLETED" ||
    normalized === "CANCELLED"
  ) {
    return normalized;
  }
  return "all";
}

function normalizeCategory(value: string | undefined): CategoryOption {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (
    normalized === "SERVICE" ||
    normalized === "REPAIR" ||
    normalized === "INSPECTION" ||
    normalized === "REGISTRATION" ||
    normalized === "INSURANCE" ||
    normalized === "TIRE" ||
    normalized === "BRAKE" ||
    normalized === "BATTERY" ||
    normalized === "OTHER"
  ) {
    return normalized;
  }
  return "all";
}

function scopeToDueState(scope: DueScope): MaintenanceDueState[] {
  if (scope === "overdue") return ["OVERDUE"];
  if (scope === "due_soon") return ["DUE_SOON"];
  if (scope === "upcoming") return ["UPCOMING"];
  if (scope === "completed") return ["COMPLETED"];
  return [];
}

function dueStateTone(state: MaintenanceDueState) {
  if (state === "OVERDUE") {
    return "border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] text-[var(--ccr-status-danger-text)]";
  }
  if (state === "DUE_SOON") {
    return "border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] text-[var(--ccr-status-warning-text)]";
  }
  if (state === "UPCOMING") {
    return "border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
  }
  if (state === "COMPLETED") {
    return "border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]";
  }
  return "border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]";
}

function dueStateLabel(state: MaintenanceDueState) {
  if (state === "DUE_SOON") return "Due Soon";
  if (state === "OVERDUE") return "Overdue";
  if (state === "UPCOMING") return "Upcoming";
  if (state === "COMPLETED") return "Completed";
  return "Cancelled";
}

function statusLabel(status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "IN_PROGRESS") return "In Progress";
  if (normalized === "SCHEDULED") return "Scheduled";
  if (normalized === "COMPLETED") return "Completed";
  if (normalized === "CANCELLED") return "Cancelled";
  return normalized;
}

function dateForSort(item: UpcomingMaintenanceItem) {
  return item.nextDueDate ?? item.scheduledDate ?? item.serviceDate ?? "";
}

function rowDateLabel(item: UpcomingMaintenanceItem) {
  return item.nextDueDate ?? item.scheduledDate ?? item.serviceDate;
}

function sortRows(rows: UpcomingMaintenanceItem[], sort: { sortBy: SortBy; sortDir: SortDir }) {
  const direction = sort.sortDir === "desc" ? -1 : 1;

  const sorted = [...rows].sort((left, right) => {
    let cmp = 0;

    if (sort.sortBy === "vehicle") {
      cmp = left.vehicleLabel.localeCompare(right.vehicleLabel, undefined, { sensitivity: "base" });
    } else if (sort.sortBy === "item") {
      cmp = `${left.title} ${left.category}`.localeCompare(`${right.title} ${right.category}`, undefined, {
        sensitivity: "base",
      });
    } else if (sort.sortBy === "status") {
      cmp = `${left.dueState} ${left.status}`.localeCompare(`${right.dueState} ${right.status}`);
    } else if (sort.sortBy === "total") {
      cmp = left.totalCostCents - right.totalCostCents;
    } else {
      cmp = dateForSort(left).localeCompare(dateForSort(right));
    }

    if (cmp !== 0) return cmp * direction;
    return left.id.localeCompare(right.id) * direction;
  });

  return sorted;
}

export default async function AdminMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") queryParams.set(key, value);
  }

  const q = normalizeMaintenanceSearchTerm(typeof params.q === "string" ? params.q : "");
  const scope = normalizeScope(typeof params.scope === "string" ? params.scope : undefined);
  const status = normalizeStatus(typeof params.status === "string" ? params.status : undefined);
  const category = normalizeCategory(typeof params.category === "string" ? params.category : undefined);
  const vehicleId =
    typeof params.vehicleId === "string" && params.vehicleId.trim() ? params.vehicleId.trim() : "";
  const from = typeof params.from === "string" && params.from.trim() ? params.from.trim() : "";
  const to = typeof params.to === "string" && params.to.trim() ? params.to.trim() : "";
  const onlyActive = params.onlyActive !== "0";
  const sort = normalizeSort(queryParams);

  const rowsPerPage = normalizePageSize(typeof params.rows === "string" ? params.rows : undefined);
  const requestedVisible = parsePositiveIntParam(params.visible);
  const visibleCount = Math.max(rowsPerPage, requestedVisible ?? rowsPerPage);

  let rows: UpcomingMaintenanceItem[] = [];
  let vehicleOptions: Array<{ id: string; label: string }> = [];
  let tableMissing = false;

  try {
    const list = await listUpcomingMaintenance({
      vehicleId: vehicleId || null,
      status: status === "all" ? [] : [status],
      category: category === "all" ? [] : [category],
      dueState: scopeToDueState(scope),
      dateFrom: from || null,
      dateTo: to || null,
      onlyActive,
    });

    rows = q
      ? list.filter((item) => {
          const haystack = `${item.vehicleLabel} ${item.title} ${item.category} ${item.status} ${item.dueState}`.toLowerCase();
          return haystack.includes(q.toLowerCase());
        })
      : list;

    const vehiclesResult = await dbQuery<{ id: string; make: string; model: string; year: number }>(
      "select id, make, model, year from vehicles order by year desc, lower(make) asc, lower(model) asc",
    );
    vehicleOptions = vehiclesResult.rows.map((row: { id: string; make: string; model: string; year: number }) => ({
      id: row.id,
      label: `${row.year} ${row.make} ${row.model}`,
    }));
  } catch (error) {
    if (!isVehicleExtensionsMissingTableError(error)) {
      throw error;
    }
    tableMissing = true;
  }

  const sortedRows = sortRows(rows, sort);
  const visibleRows = sortedRows.slice(0, visibleCount);

  const sortHref = (columnKey: SortBy, defaultDirection: SortDir) => {
    const next = nextSort(sort, columnKey, defaultDirection);
    const nextParams = applySortToSearchParams(queryParams, next);
    const queryString = nextParams.toString();
    return queryString ? `/admin/maintenance?${queryString}` : "/admin/maintenance";
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Maintenance</h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">Fleet-wide service history and upcoming maintenance.</p>
        </div>
        <Link
          href={`/api/admin/maintenance/export?${new URLSearchParams(
            queryParams.toString()
              ? `${queryParams.toString()}&format=pdf`
              : "format=pdf",
          ).toString()}`}
          className="inline-flex min-h-11 items-center rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Export PDF
        </Link>
      </div>

      <div className="mt-6 grid w-full grid-cols-2 gap-2 sm:flex sm:min-w-0 sm:flex-1 sm:flex-nowrap sm:items-center sm:overflow-x-auto sm:px-2 sm:py-1 sm:scroll-pl-2 sm:scroll-pr-2">
        {(Object.keys(DUE_SCOPE_LABELS) as DueScope[]).map((value) => {
          const active = scope === value;
          const next = new URLSearchParams(queryParams.toString());
          if (value === "all") {
            next.delete("scope");
          } else {
            next.set("scope", value);
          }
          const href = next.toString() ? `/admin/maintenance?${next.toString()}` : "/admin/maintenance";
          return (
            <Link
              key={value}
              href={href}
              className={`inline-flex min-h-11 items-center justify-center rounded-full border px-3 py-1.5 text-[11px] font-semibold leading-none transition sm:min-h-0 sm:px-4 sm:text-xs ${
                active
                  ? "border-[var(--ccr-primary)] bg-[var(--ccr-primary)] text-white ring-1 ring-[var(--ccr-accent)]"
                  : "border-[var(--ccr-border)] bg-transparent text-[var(--ccr-text)] hover:border-[var(--ccr-primary)]"
              }`}
            >
              {DUE_SCOPE_LABELS[value]}
            </Link>
          );
        })}
      </div>

      <MaintenanceFilters
        initialQuery={q}
        vehicleId={vehicleId}
        status={status}
        category={category}
        from={from}
        to={to}
        onlyActive={onlyActive}
        scope={scope}
        sortBy={sort.sortBy}
        sortDir={sort.sortDir}
        vehicleOptions={vehicleOptions}
      />

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {tableMissing ? (
          <div className="px-6 py-4 text-sm text-[var(--ccr-status-warning-text)]">
            Maintenance tables are not installed yet. Apply the latest migration to enable this page.
          </div>
        ) : null}

        {!tableMissing && sortedRows.length < 1 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            No maintenance records found.
          </div>
        ) : null}

        {!tableMissing && sortedRows.length > 0 ? (
          <>
            <div className="divide-y divide-[var(--ccr-border)] md:hidden">
              {visibleRows.map((item) => (
                <article key={item.id} className="space-y-3 px-4 py-4" data-testid="maintenance-mobile-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/admin/vehicles/${item.vehicleId}?tab=maintenance&recordId=${item.id}`}
                        className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                        title="Open vehicle"
                      >
                        {item.vehiclePublicId}
                      </Link>
                      <p className="font-semibold text-[var(--ccr-text)]">{item.vehicleLabel}</p>
                      <p className="text-xs text-[var(--ccr-muted)]">{item.title} · {item.category}</p>
                    </div>
                    <span
                      className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold ${dueStateTone(
                        item.dueState,
                      )}`}
                    >
                      {dueStateLabel(item.dueState)}
                    </span>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 text-xs text-[var(--ccr-muted)]">
                    <div>
                      <dt>Status</dt>
                      <dd className="text-sm text-[var(--ccr-text)]">{statusLabel(item.status)}</dd>
                    </div>
                    <div>
                      <dt>Total</dt>
                      <dd className="text-sm font-semibold text-[var(--ccr-text)]">{formatJmd(item.totalCostCents)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt>Due / Service Date</dt>
                      <dd className="text-sm text-[var(--ccr-text)]">{rowDateLabel(item) ?? "Not set"}</dd>
                    </div>
                  </dl>

                  <Link
                    href={`/admin/vehicles/${item.vehicleId}?tab=maintenance&recordId=${item.id}`}
                    className="inline-flex min-h-10 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                  >
                    View
                  </Link>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                  <tr>
                    <th className="px-4 py-3">Vehicle ID</th>
                    <SortableTh label="Vehicle" columnKey="vehicle" sort={sort} href={sortHref("vehicle", "asc")} />
                    <SortableTh label="Maintenance Item" columnKey="item" sort={sort} href={sortHref("item", "asc")} />
                    <SortableTh label="Status / Due" columnKey="status" sort={sort} href={sortHref("status", "asc")} />
                    <SortableTh label="Due / Service Date" columnKey="date" sort={sort} href={sortHref("date", "asc")} />
                    <SortableTh label="Total Cost" columnKey="total" sort={sort} href={sortHref("total", "desc")} />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((item) => (
                    <tr key={item.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        <Link
                          href={`/admin/vehicles/${item.vehicleId}?tab=maintenance&recordId=${item.id}`}
                          className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                          title="Open vehicle"
                        >
                          {item.vehiclePublicId}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        <Link
                          href={`/admin/vehicles/${item.vehicleId}?tab=maintenance&recordId=${item.id}`}
                          className="font-semibold text-[var(--ccr-text)]"
                        >
                          {item.vehicleLabel}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        <p className="font-semibold">{item.title}</p>
                        <p className="text-xs text-[var(--ccr-muted)]">{item.category}</p>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-muted)]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex min-h-7 items-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
                            {statusLabel(item.status)}
                          </span>
                          <span className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold ${dueStateTone(item.dueState)}`}>
                            {dueStateLabel(item.dueState)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        {rowDateLabel(item) ? <DateTimeInline value={`${rowDateLabel(item)}T00:00:00.000Z`} /> : "Not set"}
                      </td>
                      <td className="px-4 py-3 font-semibold text-[var(--ccr-text)]">{formatJmd(item.totalCostCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <LoadMorePaginationControls
              pageSize={rowsPerPage}
              loadedCount={visibleCount}
              totalCount={sortedRows.length}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}
