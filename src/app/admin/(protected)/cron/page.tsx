import Link from "next/link";

import { CronRunButtons } from "@/components/admin/CronRunButtons";
import { PaginationSummaryNav } from "@/components/admin/PaginationSummaryNav";
import { SortableTh } from "@/components/admin/SortableTh";
import { nextSort, normalizeSortDir, type SortDir } from "@/components/admin/tableSort";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { buttonStyles } from "@/components/ui/Button";
import { canAccessDeveloperAdminTools } from "@/lib/auth/adminCapabilities";
import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { summarizeReminderEvent } from "@/lib/cron/reminderEventSummary";
import { loadRecentReminderRuns } from "@/lib/cron/reminderRuns";
import { REMINDER_EVENT_LABELS, REMINDER_EVENT_TYPES, type ReminderEventType } from "@/lib/cron/reminderTypes";

type AuditRow = {
  action: string;
  entity_id: string | null;
  booking_public_id: string | null;
  details_json: unknown;
  created_at: string;
};

const EVENT_TYPE_LIST = [...REMINDER_EVENT_TYPES];
const REMINDER_EVENTS_PAGE_SIZE = 20;
const EVENT_SORT_COLUMNS = ["event", "booking", "sentAt"] as const;
type EventSortBy = (typeof EVENT_SORT_COLUMNS)[number];
type EventSortState = {
  sortBy: EventSortBy;
  sortDir: SortDir;
};

function firstQueryParam(input: string | string[] | undefined) {
  return Array.isArray(input) ? input[0] : input;
}

function parsePositiveInt(input: string | undefined, fallback: number) {
  const parsed = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function normalizeEventSort(
  query: Record<string, string | string[] | undefined>,
): EventSortState {
  const sortByValue = firstQueryParam(query.eventsSortBy);
  const sortBy = EVENT_SORT_COLUMNS.includes(sortByValue as EventSortBy)
    ? (sortByValue as EventSortBy)
    : "sentAt";
  const sortDir = normalizeSortDir(firstQueryParam(query.eventsSortDir)) ?? "desc";
  return { sortBy, sortDir };
}

function buildCronHref(
  query: Record<string, string | string[] | undefined>,
  updates: Record<string, string | null | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "page") continue;
    const first = firstQueryParam(value);
    if (typeof first === "string" && first.trim()) {
      params.set(key, first);
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (!value) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  const search = params.toString();
  return search ? `/admin/cron?${search}` : "/admin/cron";
}

function runStatusPillClass(status: string) {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "FAILED") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (normalized === "CANCELLED") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function sourcePillClass(source: string) {
  const normalized = String(source ?? "").trim().toLowerCase();
  if (normalized === "diagnostic") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (normalized === "manual") {
    return "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-accent)]";
  }
  return "border-[var(--ccr-border)] bg-[var(--ccr-bg)] text-[var(--ccr-muted)]";
}

function formatRunCounts(input: {
  attemptedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  cancelledCount: number;
}) {
  const parts = [`Attempted ${input.attemptedCount}`];
  if (input.sentCount > 0) parts.push(`Sent ${input.sentCount}`);
  if (input.failedCount > 0) parts.push(`Failed ${input.failedCount}`);
  if (input.skippedCount > 0) parts.push(`Skipped ${input.skippedCount}`);
  if (input.cancelledCount > 0) parts.push(`Cancelled ${input.cancelledCount}`);
  return parts.join(" · ");
}

export default async function AdminCronPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionFromRequest();
  if (!canAccessDeveloperAdminTools(session?.role)) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">Cron Status</h1>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            Only DEVELOPER users can run cron jobs or inspect reminder diagnostics.
          </p>
        </section>
      </div>
    );
  }

  const query = await searchParams;
  const cronConfigured = Boolean(process.env.CRON_SECRET);
  const recentRuns = await loadRecentReminderRuns(10);
  const eventsSort = normalizeEventSort(query);
  const requestedPage = parsePositiveInt(
    firstQueryParam(query.eventsPage) ?? firstQueryParam(query.page),
    1,
  );
  const orderByClause =
    eventsSort.sortBy === "event"
      ? `a.action ${eventsSort.sortDir}, a.created_at desc, coalesce(b.public_id, a.entity_id::text, '') asc`
      : eventsSort.sortBy === "booking"
        ? `coalesce(b.public_id, a.entity_id::text, '') ${eventsSort.sortDir}, a.created_at desc, a.action asc`
        : `a.created_at ${eventsSort.sortDir}, a.action asc, coalesce(b.public_id, a.entity_id::text, '') asc`;

  const totalCountResult = await dbQuery<{ total_count: number }>(
    "select count(*)::int as total_count from audit_logs where entity_type = 'booking' and action = any($1::text[])",
    [EVENT_TYPE_LIST],
  );
  const totalCount = Number(totalCountResult.rows[0]?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / REMINDER_EVENTS_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * REMINDER_EVENTS_PAGE_SIZE;

  const auditRows = await dbQuery<AuditRow>(
    `select a.action, a.entity_id, b.public_id as booking_public_id, a.details_json, a.created_at
       from audit_logs a
       left join bookings b on b.id = a.entity_id
      where a.entity_type = 'booking' and a.action = any($1::text[])
      order by ${orderByClause}
      limit $2::int offset $3::int`,
    [EVENT_TYPE_LIST, REMINDER_EVENTS_PAGE_SIZE, offset],
  );

  const rows = auditRows.rows as AuditRow[];
  const hasPrevPage = page > 1;
  const hasNextPage = page < totalPages;
  const pageFrom = totalCount > 0 ? offset + 1 : 0;
  const pageTo = totalCount > 0 ? offset + rows.length : 0;
  const prevHref = buildCronHref(query, {
    eventsPage: String(Math.max(1, page - 1)),
  });
  const nextHref = buildCronHref(query, {
    eventsPage: String(Math.min(totalPages, page + 1)),
  });
  const buildEventsSortHref = (columnKey: EventSortBy, defaultDirection: SortDir = "asc") => {
    const next = nextSort(eventsSort, columnKey, defaultDirection);
    return buildCronHref(query, {
      eventsSortBy: next.sortBy ?? null,
      eventsSortDir: next.sortDir ?? null,
      eventsPage: null,
    });
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Cron Status</h1>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            Scheduled reminders for pickup, balance due, and note emails.
          </p>
        </div>
        <Link
          href="/admin/payments"
          className={buttonStyles({ variant: "secondary", size: "sm" })}
        >
          View Payments
        </Link>
      </div>

      {!cronConfigured ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          CRON_SECRET is not configured. Scheduled reminders will not run until it is set.
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ccr-text)]">Schedules</h2>
              <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                Manual run controls stay on-page for quick reminder checks and diagnostics.
              </p>
            </div>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-[var(--ccr-text)]">
            <li>
              Pickup reminders: <span className="font-semibold">12:00 daily</span>
            </li>
            <li>
              Balance reminders: <span className="font-semibold">13:00 daily</span>
            </li>
            <li>
              Note emails: <span className="font-semibold">Every 15 minutes</span>
            </li>
            <li>
              Maintenance reminders: <span className="font-semibold">14:00 daily</span>
            </li>
          </ul>
          <CronRunButtons />
        </div>

        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ccr-text)]">Last Runs</h2>
              <p className="mt-1 text-sm text-[var(--ccr-muted)]">Latest 10 cron executions.</p>
            </div>
          </div>
          {recentRuns.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">No run history yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--ccr-border)] text-sm text-[var(--ccr-text)]">
              {recentRuns.map((run) => {
                const displayTimestamp = run.finishedAt || run.startedAt;
                return (
                  <li key={`${run.eventType}-${run.createdAt}`} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[var(--ccr-text)]">
                            {REMINDER_EVENT_LABELS[run.eventType]}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${runStatusPillClass(run.status)}`}
                          >
                            {run.status.toLowerCase()}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${sourcePillClass(run.source)}`}
                          >
                            {run.source}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                          {formatRunCounts(run)}
                        </p>
                        {run.errorSummary ? (
                          <p className="mt-1 text-xs text-red-600">{run.errorSummary}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-xs text-[var(--ccr-muted)]">
                        <DateTimeInline value={displayTimestamp} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ccr-text)]">Recent Reminder Events</h2>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">
              Sort by event, booking, or sent time to scan the latest reminder activity faster.
            </p>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ccr-muted)]">No reminder events logged yet.</p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                  <tr>
                    <SortableTh
                      className="px-3 py-2"
                      label="Event"
                      columnKey="event"
                      sort={eventsSort}
                      href={buildEventsSortHref("event", "asc")}
                    />
                    <SortableTh
                      className="px-3 py-2"
                      label="Booking"
                      columnKey="booking"
                      sort={eventsSort}
                      href={buildEventsSortHref("booking", "asc")}
                    />
                    <th className="px-3 py-2">Summary</th>
                    <SortableTh
                      className="px-3 py-2"
                      label="Sent"
                      columnKey="sentAt"
                      sort={eventsSort}
                      href={buildEventsSortHref("sentAt", "desc")}
                      defaultDirection="desc"
                    />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr
                      key={`${row.action}-${row.created_at}-${row.entity_id || "none"}-${rowIndex}`}
                      className="border-b border-[var(--ccr-border)] last:border-b-0"
                    >
                      <td className="px-3 py-2 text-[var(--ccr-text)]">
                        {REMINDER_EVENT_LABELS[row.action as ReminderEventType] ?? row.action}
                      </td>
                      <td className="px-3 py-2 text-[var(--ccr-text)]">
                        {row.entity_id ? (
                          <Link
                            href={`/admin/bookings/${row.entity_id}`}
                            className="font-semibold text-[var(--ccr-accent)] hover:underline"
                          >
                            {row.booking_public_id || row.entity_id.slice(0, 8)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--ccr-muted)]">
                        {(() => {
                          const summary = summarizeReminderEvent(row.action, row.details_json);
                          return (
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-[var(--ccr-text)]">{summary.primary}</p>
                              {summary.badges.length > 0 || summary.secondary.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {summary.badges.map((badge) => (
                                    <span
                                      key={`${row.action}-${row.created_at}-${badge}`}
                                      className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700"
                                    >
                                      {badge}
                                    </span>
                                  ))}
                                  {summary.secondary.map((item) => (
                                    <span
                                      key={`${row.action}-${row.created_at}-${item}`}
                                      className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-2 py-0.5 text-[11px] text-[var(--ccr-muted)]"
                                    >
                                      {item}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              {summary.error ? (
                                <p className="text-[11px] font-medium text-red-600">{summary.error}</p>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-[var(--ccr-muted)]">
                        <TableDateTime value={row.created_at} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationSummaryNav
              from={pageFrom}
              to={pageTo}
              totalCount={totalCount}
              page={page}
              totalPages={totalPages}
              hasPrev={hasPrevPage}
              hasNext={hasNextPage}
              prevHref={prevHref}
              nextHref={nextHref}
            />
          </>
        )}
      </div>
    </div>
  );
}
