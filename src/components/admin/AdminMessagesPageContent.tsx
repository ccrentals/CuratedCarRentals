import Link from "next/link";

import { isStaffRole } from "@/lib/auth/roles";
import { getSessionFromRequest } from "@/lib/auth/session";
import { MessagesInboxTable } from "@/components/admin/MessagesInboxTable";
import { PaginationSummaryNav } from "@/components/admin/PaginationSummaryNav";
import { readSortFromSearchParams, type SortDir } from "@/components/admin/tableSort";
import {
  ADMIN_MESSAGE_SORT_COLUMNS,
  ADMIN_MESSAGE_SOURCE_OPTIONS,
  fetchAdminMessagesPage,
  isContactMessagesMissingTableError,
  normalizeAdminMessageSortBy,
  normalizeAdminMessageSortDir,
  normalizeAdminMessageSourceFilter,
  normalizeContactMessageStatusFilter,
} from "@/lib/messages/adminMessages";
import { normalizePageSize, parsePositiveIntParam } from "@/lib/pagination/sharedPagination";

type MessageSortBy = (typeof ADMIN_MESSAGE_SORT_COLUMNS)[number];
type MessageSortDir = SortDir;
type SearchParams = Record<string, string | string[] | undefined>;
type ViewMode = "inbox" | "trash";

type AdminMessagesPageContentProps = {
  searchParams: SearchParams;
  viewMode: ViewMode;
};

function setStringParam(params: URLSearchParams, key: string, value: string | null) {
  if (value) {
    params.set(key, value);
  }
}

function buildQueryString(params: URLSearchParams) {
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function AdminMessagesPageContent({
  searchParams,
  viewMode,
}: AdminMessagesPageContentProps) {
  const session = await getSessionFromRequest();
  const canView = isStaffRole(session?.role);
  const canManage = canView;
  const canDeletePermanent = canManage;

  const basePath = viewMode === "trash" ? "/admin/messages/trash" : "/admin/messages";
  const toggleHrefBase = viewMode === "trash" ? "/admin/messages" : "/admin/messages/trash";
  const toggleLabel = viewMode === "trash" ? "Messages" : "Trash";
  const isTrashView = viewMode === "trash";

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">
          {isTrashView ? "Trash" : "Messages"}
        </h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") search.set(key, value);
  }

  const q = typeof searchParams.q === "string" ? searchParams.q.trim() : "";
  const requestedStatus = normalizeContactMessageStatusFilter(
    typeof searchParams.status === "string" ? searchParams.status : undefined,
  );
  const status = isTrashView ? "ARCHIVED" : requestedStatus === "ARCHIVED" ? null : requestedStatus;
  const source = normalizeAdminMessageSourceFilter(
    typeof searchParams.source === "string" ? searchParams.source : undefined,
  );
  const sortState = readSortFromSearchParams(search, {
    allowedSortBy: ADMIN_MESSAGE_SORT_COLUMNS,
    defaultSortBy: "received",
    defaultSortDir: "desc",
  });
  const sortBy: MessageSortBy = normalizeAdminMessageSortBy(sortState.sortBy) ?? "received";
  const sortDir: MessageSortDir = normalizeAdminMessageSortDir(sortState.sortDir) ?? "desc";
  const rowsPerPage = normalizePageSize(
    typeof searchParams.rows === "string" ? searchParams.rows : undefined,
  );
  const requestedPage = parsePositiveIntParam(searchParams.page) ?? 1;

  let totalCount = 0;
  let rows = [] as Awaited<ReturnType<typeof fetchAdminMessagesPage>>["items"];
  let tableReady = true;
  let page = Math.max(1, requestedPage);

  try {
    const firstPage = await fetchAdminMessagesPage({
      status,
      source,
      q,
      sortBy,
      sortDir,
      limit: rowsPerPage,
      offset: (requestedPage - 1) * rowsPerPage,
    });
    totalCount = firstPage.totalCount;
    const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
    page = Math.min(Math.max(1, requestedPage), totalPages);

    if (page === requestedPage) {
      rows = firstPage.items;
    } else {
      const clampedPage = await fetchAdminMessagesPage({
        status,
        source,
        q,
        sortBy,
        sortDir,
        limit: rowsPerPage,
        offset: (page - 1) * rowsPerPage,
      });
      rows = clampedPage.items;
    }
  } catch (error) {
    if (isContactMessagesMissingTableError(error)) {
      tableReady = false;
    } else {
      throw error;
    }
  }

  const commonParams = new URLSearchParams();
  if (!isTrashView && status) {
    commonParams.set("status", status);
  }
  setStringParam(commonParams, "source", source);
  setStringParam(commonParams, "q", q || null);
  setStringParam(commonParams, "sortBy", sortBy);
  setStringParam(commonParams, "sortDir", sortDir);
  if (rowsPerPage !== 10) {
    commonParams.set("rows", String(rowsPerPage));
  }

  const toggleParams = new URLSearchParams();
  setStringParam(toggleParams, "source", source);
  setStringParam(toggleParams, "q", q || null);
  setStringParam(toggleParams, "sortBy", sortBy);
  setStringParam(toggleParams, "sortDir", sortDir);
  if (rowsPerPage !== 10) {
    toggleParams.set("rows", String(rowsPerPage));
  }
  const toggleHref = `${toggleHrefBase}${buildQueryString(toggleParams)}`;

  const exportParams = new URLSearchParams(commonParams);
  exportParams.delete("rows");
  if (isTrashView) {
    exportParams.set("status", "TRASH");
  }
  const exportHref = exportParams.toString()
    ? `/api/admin/messages/export?${exportParams.toString()}`
    : "/api/admin/messages/export";

  const pageHref = (nextPage: number) => {
    const query = new URLSearchParams(commonParams);
    if (nextPage > 1) {
      query.set("page", String(nextPage));
    }
    const qs = query.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const currentPath = pageHref(page);
  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
  const from = totalCount === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const to = Math.min(page * rowsPerPage, totalCount);
  const searchLabelClass = isTrashView
    ? "sm:col-span-3 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]"
    : "sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">
            {isTrashView ? "Trash" : "Messages"}
          </h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            {isTrashView
              ? "Trashed inbox items are kept here until you restore or permanently delete them."
              : "Shared inbox for contact inquiries and internal operational alerts."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={toggleHref}
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            {toggleLabel}
          </Link>
          <Link
            href={exportHref}
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Export CSV
          </Link>
        </div>
      </div>

      <div className="mt-2">
        <Link
          href={basePath}
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Reset
        </Link>
      </div>

      <form className="mt-5 grid gap-3 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 sm:grid-cols-4">
        <input type="hidden" name="sortBy" value={sortBy} />
        <input type="hidden" name="sortDir" value={sortDir} />
        {!isTrashView ? (
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Inbox State
            <select
              name="status"
              defaultValue={status ?? ""}
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="">All</option>
              <option value="NEW">New</option>
              <option value="READ">Read</option>
            </select>
          </label>
        ) : null}
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Source
          <select
            name="source"
            defaultValue={source ?? ""}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="">All</option>
            {ADMIN_MESSAGE_SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={searchLabelClass}>
          Search
          <input
            name="q"
            defaultValue={q}
            placeholder="Name, email, message, source, booking ID"
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Rows
          <select
            name="rows"
            defaultValue={String(rowsPerPage)}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="10">10</option>
            <option value="30">30</option>
            <option value="50">50</option>
          </select>
        </label>
        <div className="sm:col-span-4 flex justify-end gap-2">
          <button
            type="submit"
            className="rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Apply filters
          </button>
        </div>
      </form>

      {!tableReady ? (
        <div className="mt-6 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">Messages table is not installed.</p>
          <p className="mt-1 text-xs text-amber-100/80">
            Apply migrations to enable the messages inbox.
          </p>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
          {rows.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-semibold text-[var(--ccr-text)]">
                {isTrashView ? "No trashed messages." : "No inbox messages in this view."}
              </p>
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">
                {isTrashView
                  ? "Messages you trash will appear here until restored or permanently deleted."
                  : "Contact form submissions and internal operational alerts will appear here."}
              </p>
            </div>
          ) : (
            <MessagesInboxTable
              rows={rows}
              currentPath={currentPath}
              canManage={canManage}
              canDeletePermanent={canDeletePermanent}
              currentStatusFilter={status}
            />
          )}

          {totalCount > 0 ? (
            <div className="px-4 pb-4">
              <PaginationSummaryNav
                from={from}
                to={to}
                totalCount={totalCount}
                page={page}
                totalPages={totalPages}
                hasPrev={page > 1}
                hasNext={page < totalPages}
                prevHref={pageHref(Math.max(1, page - 1))}
                nextHref={pageHref(Math.min(totalPages, page + 1))}
                className="mt-4"
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
