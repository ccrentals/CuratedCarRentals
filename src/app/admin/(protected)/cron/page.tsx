import Link from "next/link";

import { CronRunButtons } from "@/components/admin/CronRunButtons";
import { DateTimeStack } from "@/components/shared/DateTimeStack";
import { dbQuery } from "@/lib/db";
import { loadLatestReminderRuns } from "@/lib/cron/reminderRuns";
import { REMINDER_EVENT_LABELS, REMINDER_EVENT_TYPES, type ReminderEventType } from "@/lib/cron/reminderTypes";

type AuditRow = {
  action: string;
  entity_id: string;
  details_json: unknown;
  created_at: string;
};

const EVENT_TYPE_LIST = [...REMINDER_EVENT_TYPES];

function toTitleLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseDetails(details: unknown): Array<{ key: string; value: string }> | null {
  if (!details) return null;
  if (typeof details === "string") {
    try {
      const parsed = JSON.parse(details) as unknown;
      return parseDetails(parsed);
    } catch {
      return [{ key: "Details", value: details }];
    }
  }

  if (Array.isArray(details)) {
    return [
      {
        key: "Details",
        value: details
          .map((item) => {
            if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
              return String(item);
            }
            return JSON.stringify(item);
          })
          .join(", "),
      },
    ];
  }

  if (typeof details === "object") {
    const entries = Object.entries(details as Record<string, unknown>);
    if (entries.length === 0) return null;
    return entries.map(([key, value]) => {
      if (value === null || value === undefined) {
        return { key: toTitleLabel(key), value: "—" };
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return { key: toTitleLabel(key), value: String(value) };
      }
      return { key: toTitleLabel(key), value: JSON.stringify(value, null, 2) };
    });
  }

  return [{ key: "Details", value: String(details) }];
}

export default async function AdminCronPage() {
  const cronConfigured = Boolean(process.env.CRON_SECRET);
  const latestRuns = await loadLatestReminderRuns();

  const auditRows = await dbQuery<AuditRow>(
    "select action, entity_id, details_json, created_at from audit_logs where entity_type = 'booking' and action = any($1::text[]) order by created_at desc limit 60",
    [EVENT_TYPE_LIST],
  );

  const rows = auditRows.rows as AuditRow[];
  const latestEventByAction = rows.reduce(
    (acc, row) => {
      if (!acc[row.action]) acc[row.action] = row;
      return acc;
    },
    {} as Record<string, AuditRow>,
  );

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
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
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
          <h2 className="text-lg font-semibold text-[var(--ccr-text)]">Schedules (UTC)</h2>
          <ul className="mt-3 space-y-2 text-sm text-[var(--ccr-text)]">
            <li>
              Pickup reminders: <span className="font-semibold">12:00 UTC daily</span>
            </li>
            <li>
              Balance reminders: <span className="font-semibold">13:00 UTC daily</span>
            </li>
            <li>
              Note emails: <span className="font-semibold">Every 15 minutes</span>
            </li>
          </ul>
          <CronRunButtons />
        </div>

        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <h2 className="text-lg font-semibold text-[var(--ccr-text)]">Last Runs</h2>
          <ul className="mt-3 space-y-2 text-sm text-[var(--ccr-text)]">
            {EVENT_TYPE_LIST.map((eventType: ReminderEventType) => {
              const run = latestRuns[eventType];
              const fallbackEvent = latestEventByAction[eventType];
              const displayTimestamp = run?.finishedAt || run?.startedAt || fallbackEvent?.created_at || null;
              return (
                <li key={eventType} className="flex items-center justify-between gap-3">
                  <span>{REMINDER_EVENT_LABELS[eventType]}</span>
                  <span className="text-xs text-[var(--ccr-muted)]">
                    {displayTimestamp ? <DateTimeStack value={displayTimestamp} /> : "No runs yet"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
        <h2 className="text-lg font-semibold text-[var(--ccr-text)]">Recent Reminder Events</h2>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ccr-muted)]">No reminder events logged yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                <tr>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Booking</th>
                  <th className="px-3 py-2">Details</th>
                  <th className="px-3 py-2">Sent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.action}-${row.created_at}`} className="border-b border-[var(--ccr-border)] last:border-b-0">
                    <td className="px-3 py-2 text-[var(--ccr-text)]">
                      {REMINDER_EVENT_LABELS[row.action as ReminderEventType] ?? row.action}
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">
                      {row.entity_id ? row.entity_id.slice(0, 8) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--ccr-muted)]">
                      {(() => {
                        const details = parseDetails(row.details_json);
                        if (!details || details.length === 0) return "—";
                        return (
                          <div className="space-y-1">
                            {details.map((item) => (
                              <div key={`${row.action}-${row.created_at}-${item.key}`}>
                                <span className="font-semibold text-[var(--ccr-text)]">{item.key}:</span>{" "}
                                {item.value.includes("\n") ? (
                                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--ccr-muted)]">
                                    {item.value}
                                  </pre>
                                ) : (
                                  item.value
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-muted)]">
                      <DateTimeStack value={row.created_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
