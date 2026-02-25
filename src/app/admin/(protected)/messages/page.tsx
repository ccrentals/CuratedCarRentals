import Link from "next/link";
import { isAdminRole, isStaffRole } from "@/lib/auth/roles";

import { MessagesInboxTable } from "@/components/admin/MessagesInboxTable";
import { PaginationSummaryNav } from "@/components/admin/PaginationSummaryNav";
import { readSortFromSearchParams, type SortDir } from "@/components/admin/tableSort";
import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import {
  ADMIN_MESSAGE_SORT_COLUMNS,
  isContactMessagesMissingTableError,
  normalizeAdminMessageSortBy,
  normalizeAdminMessageSortDir,
  normalizeContactMessageStatusFilter,
} from "@/lib/messages/adminMessages";
import { normalizePageSize, parsePositiveIntParam } from "@/lib/pagination/sharedPagination";

type MessageListRow = {
  id: string;
  created_at: string;
  name: string;
  email: string;
  message: string;
  status: string;
  source: string | null;
};

type MessageSortBy = (typeof ADMIN_MESSAGE_SORT_COLUMNS)[number];
type MessageSortDir = SortDir;

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionFromRequest();
  const canView = isStaffRole(session?.role);
  const canManage = canView;
  const canRunRetention = isAdminRole(session?.role);

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Messages</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") search.set(key, value);
  }
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const status = normalizeContactMessageStatusFilter(
    typeof params.status === "string" ? params.status : undefined,
  );
  const sortState = readSortFromSearchParams(search, {
    allowedSortBy: ADMIN_MESSAGE_SORT_COLUMNS,
    defaultSortBy: "received",
    defaultSortDir: "desc",
  });
  const sortBy: MessageSortBy = normalizeAdminMessageSortBy(sortState.sortBy) ?? "received";
  const sortDir: MessageSortDir = normalizeAdminMessageSortDir(sortState.sortDir) ?? "desc";
  const directionSql = sortDir === "asc" ? "asc" : "desc";
  const orderBySql =
    sortBy === "name"
      ? `order by lower(name) ${directionSql}, id::text ${directionSql}`
      : sortBy === "email"
        ? `order by lower(email) ${directionSql}, id::text ${directionSql}`
        : sortBy === "status"
          ? `order by upper(status) ${directionSql}, id::text ${directionSql}`
          : `order by created_at ${directionSql}, id::text ${directionSql}`;
  const rowsPerPage = normalizePageSize(
    typeof params.rows === "string" ? params.rows : undefined,
  );
  const requestedPage = parsePositiveIntParam(params.page) ?? 1;

  const filters: string[] = [];
  const values: Array<string | number> = [];
  let index = 1;

  if (status) {
    filters.push(`status = $${index}`);
    values.push(status);
    index += 1;
  }

  if (q) {
    filters.push(`(name ilike $${index} or email ilike $${index} or message ilike $${index})`);
    values.push(`%${q}%`);
    index += 1;
  }

  const whereSql = filters.length > 0 ? ` where ${filters.join(" and ")}` : "";

  let totalCount = 0;
  let rows: MessageListRow[] = [];
  let tableReady = true;

  try {
    const countResult = await dbQuery<{ total_count: unknown }>(
      `select count(*)::int as total_count from contact_messages${whereSql}`,
      values,
    );
    totalCount = Number(countResult.rows[0]?.total_count ?? 0);

    const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
    const page = Math.min(Math.max(1, requestedPage), totalPages);
    const offset = (page - 1) * rowsPerPage;

    const pageValues = [...values, rowsPerPage, offset];
    rows = (
      await dbQuery<MessageListRow>(
        `select id, created_at, name, email, message, status, source from contact_messages${whereSql} ${orderBySql} limit $${
          pageValues.length - 1
        } offset $${pageValues.length}`,
        pageValues,
      )
    ).rows;
  } catch (error) {
    if (isContactMessagesMissingTableError(error)) {
      tableReady = false;
    } else {
      throw error;
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const from = totalCount === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const to = Math.min(page * rowsPerPage, totalCount);

  const baseParams = new URLSearchParams();
  if (status) baseParams.set("status", status);
  if (q) baseParams.set("q", q);
  if (sortBy) baseParams.set("sortBy", sortBy);
  if (sortDir) baseParams.set("sortDir", sortDir);
  if (rowsPerPage !== 10) baseParams.set("rows", String(rowsPerPage));
  const exportParams = new URLSearchParams(baseParams);
  exportParams.delete("rows");
  const exportHref = exportParams.toString()
    ? `/api/admin/messages/export?${exportParams.toString()}`
    : "/api/admin/messages/export";

  const pageHref = (nextPage: number) => {
    const query = new URLSearchParams(baseParams);
    if (nextPage > 1) {
      query.set("page", String(nextPage));
    }
    const qs = query.toString();
    return qs ? `/admin/messages?${qs}` : "/admin/messages";
  };

  const currentPath = pageHref(page);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Messages</h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Review contact inquiries and manage message status.
          </p>
        </div>
        <Link
          href={exportHref}
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Export CSV
        </Link>
      </div>

      <div className="mt-2">
        <Link
          href="/admin/messages"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Reset
        </Link>
      </div>

      <form className="mt-5 grid gap-3 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 sm:grid-cols-4">
        <input type="hidden" name="sortBy" value={sortBy} />
        <input type="hidden" name="sortDir" value={sortDir} />
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="">All</option>
            <option value="NEW">New</option>
            <option value="READ">Read</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </label>
        <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Search
          <input
            name="q"
            defaultValue={q}
            placeholder="Name, email, or message"
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
              <p className="text-sm font-semibold text-[var(--ccr-text)]">No messages yet.</p>
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">
                New inquiries from <code>/contact</code> will appear here.
              </p>
            </div>
          ) : (
            <MessagesInboxTable
              rows={rows.map((row) => ({
                id: row.id,
                createdAt: row.created_at,
                name: row.name,
                email: row.email,
                message: row.message,
                status: row.status,
                source: row.source,
              }))}
              currentPath={currentPath}
              canManage={canManage}
              canRunRetention={canRunRetention}
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
