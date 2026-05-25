import Link from "next/link";

import { PaginationSummaryNav } from "@/components/admin/PaginationSummaryNav";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { applySortToSearchParams, ariaSortValue, nextSort, readSortFromSearchParams } from "@/components/admin/tableSort";
import { isAdminRole } from "@/lib/auth/roles";
import { getSessionFromRequest } from "@/lib/auth/session";
import { fetchAdminEmailsPage, ADMIN_EMAIL_SORT_COLUMNS } from "@/lib/notifications/adminEmails";

type SearchParams = Record<string, string | string[] | undefined>;

function normalizeTextParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function buildHref(basePath: string, params: URLSearchParams) {
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function formatAdminEmailLabel(value: string | null | undefined) {
  if (!value) return "—";

  const normalized = value.replace(/[_.]+/g, " ").trim().toLowerCase();
  if (!normalized) return "—";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function statusBadgeClass(status: string) {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "SENT") {
    return "border border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  }
  if (normalized === "BOUNCED" || normalized === "DELIVERY_ISSUE") {
    return "border border-amber-400/40 bg-amber-500/10 text-amber-200";
  }
  if (normalized === "FAILED") {
    return "border border-red-400/40 bg-red-500/10 text-red-200";
  }
  if (normalized === "SKIPPED") {
    return "border border-slate-400/40 bg-slate-500/10 text-slate-200";
  }
  return "border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]";
}

function summaryCard(label: string, value: number, tone?: string) {
  return (
    <div className={`rounded-2xl border p-4 ${tone ?? "border-[var(--ccr-border)] bg-[var(--ccr-surface)]"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">{label}</p>
      <p className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">{value}</p>
    </div>
  );
}

export async function AdminEmailsPageContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSessionFromRequest();
  const canView = isAdminRole(session?.role);
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Emails</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  const q = normalizeTextParam(searchParams.q);
  const status = normalizeTextParam(searchParams.status);
  const emailType = normalizeTextParam(searchParams.emailType);
  const entityType = normalizeTextParam(searchParams.entityType);
  const triggerSource = normalizeTextParam(searchParams.triggerSource);
  const dateFrom = normalizeTextParam(searchParams.dateFrom);
  const dateTo = normalizeTextParam(searchParams.dateTo);
  const rows = normalizeTextParam(searchParams.rows);
  const pageValue = normalizeTextParam(searchParams.page);

  const currentParams = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string" && value.trim()) currentParams.set(key, value);
  }

  const sort = readSortFromSearchParams(currentParams, {
    allowedSortBy: ADMIN_EMAIL_SORT_COLUMNS,
    defaultSortBy: "lastEvent",
    defaultSortDir: "desc",
  });

  const page = await fetchAdminEmailsPage({
    status: status || null,
    emailType: emailType || null,
    entityType: entityType || null,
    triggerSource: triggerSource || null,
    q: q || null,
    sortBy: sort.sortBy,
    sortDir: sort.sortDir,
    limit: rows || null,
    page: pageValue || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
  });

  const sortHref = (columnKey: (typeof ADMIN_EMAIL_SORT_COLUMNS)[number]) => {
    const next = nextSort(sort, columnKey, columnKey === "created" || columnKey === "lastEvent" ? "desc" : "asc");
    return buildHref("/admin/emails", applySortToSearchParams(currentParams, next));
  };

  const pageHref = (nextPage: number) => {
    const params = new URLSearchParams(currentParams);
    if (nextPage > 1) params.set("page", String(nextPage));
    else params.delete("page");
    return buildHref("/admin/emails", params);
  };

  const currentHref = pageHref(page.page);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Monitoring</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Emails</h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Outbound email delivery history, delivery issues, and resend controls.
          </p>
        </div>
        <Link
          href="/admin/emails"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Reset
        </Link>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCard("Total", page.summary.total)}
        {summaryCard("Failed", page.summary.failed, "border border-red-400/40 bg-red-500/10")}
        {summaryCard("Bounced / Issues", page.summary.bouncedOrIssue, "border border-amber-400/40 bg-amber-500/10")}
        {summaryCard("Pending / Unknown", page.summary.pendingOrUnknown, "border border-slate-400/40 bg-slate-500/10")}
      </div>

      <form className="mt-5 grid gap-3 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 sm:grid-cols-2 xl:grid-cols-4">
        <input type="hidden" name="sortBy" value={sort.sortBy ?? "lastEvent"} />
        <input type="hidden" name="sortDir" value={sort.sortDir ?? "desc"} />

        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Status
          <input name="status" defaultValue={status} className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Email Type
          <input name="emailType" defaultValue={emailType} className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Entity Type
          <input name="entityType" defaultValue={entityType} className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Trigger Source
          <input name="triggerSource" defaultValue={triggerSource} className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] sm:col-span-2 xl:col-span-2">
          Search
          <input name="q" defaultValue={q} placeholder="Recipient, subject, reference, provider message ID" className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Date From
          <input type="date" name="dateFrom" defaultValue={dateFrom} className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Date To
          <input type="date" name="dateTo" defaultValue={dateTo} className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Rows
          <input type="number" min="1" max="100" name="rows" defaultValue={rows || "20"} className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]" />
        </label>
        <div className="flex items-end">
          <button type="submit" className="rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-accent)] px-4 py-2 text-sm font-semibold text-[var(--ccr-bg)]">
            Apply Filters
          </button>
        </div>
      </form>

      <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--ccr-border)] text-sm">
            <thead className="bg-[var(--ccr-surface-soft)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">
                  <Link href={sortHref("lastEvent")} aria-sort={ariaSortValue(sort, "lastEvent")}>
                    Last Event
                  </Link>
                </th>
                <th className="px-4 py-3">
                  <Link href={sortHref("recipient")} aria-sort={ariaSortValue(sort, "recipient")}>
                    Recipient
                  </Link>
                </th>
                <th className="px-4 py-3">
                  <Link href={sortHref("emailType")} aria-sort={ariaSortValue(sort, "emailType")}>
                    Email Type
                  </Link>
                </th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Provider Message</th>
                <th className="px-4 py-3">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ccr-border)]">
              {page.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-[var(--ccr-muted)]">
                    No emails found for the current filters.
                  </td>
                </tr>
              ) : (
                page.items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">
                      <DateTimeInline value={item.lastEventAt ?? item.sentAt ?? item.createdAt} preset="admin" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[var(--ccr-text)]">{item.recipientName || "—"}</div>
                      <div className="text-xs text-[var(--ccr-muted)]">{item.recipientEmail || "Legacy / unavailable"}</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">
                      <Link href={`/admin/emails/${encodeURIComponent(item.id)}?back=${encodeURIComponent(currentHref)}`} className="font-semibold text-[var(--ccr-accent)] underline-offset-2 hover:underline">
                        {formatAdminEmailLabel(item.emailType)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">
                      <div>{item.entityPublicId || item.relatedTransactionId || "—"}</div>
                      <div className="text-xs text-[var(--ccr-muted)]">
                        {formatAdminEmailLabel(item.relatedTransactionType || item.entityType)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">
                      {formatAdminEmailLabel(item.triggerSource)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--ccr-muted)]">{item.providerMessageId || "—"}</td>
                    <td className="px-4 py-3 text-xs text-[var(--ccr-muted)]">{item.lastError || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationSummaryNav
        className="mt-4"
        from={page.from}
        to={page.to}
        totalCount={page.totalCount}
        page={page.page}
        totalPages={page.totalPages}
        hasPrev={page.hasPrev}
        hasNext={page.hasNext}
        prevHref={pageHref(Math.max(1, page.page - 1))}
        nextHref={pageHref(Math.min(page.totalPages, page.page + 1))}
      />
    </div>
  );
}
