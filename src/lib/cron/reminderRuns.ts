import { writeAuditLog } from "@/lib/audit";
import { dbQuery } from "@/lib/db";
import {
  CRON_RUN_AUDIT_ACTION,
  isReminderEventType,
  REMINDER_EVENT_TYPES,
  type ReminderEventType,
  type ReminderRunStatus,
} from "@/lib/cron/reminderTypes";

type ReminderRunCounts = {
  attemptedCount?: number;
  sentCount?: number;
  failedCount?: number;
  cancelledCount?: number;
  skippedCount?: number;
};

export type ReminderRunInput = ReminderRunCounts & {
  eventType: ReminderEventType;
  status: ReminderRunStatus;
  startedAt: string | Date;
  finishedAt?: string | Date;
  errorSummary?: string | null;
  source?: "cron" | "manual" | "diagnostic" | "system";
};

export type ReminderRunRecord = {
  eventType: ReminderEventType;
  status: ReminderRunStatus;
  startedAt: string;
  finishedAt: string;
  attemptedCount: number;
  sentCount: number;
  failedCount: number;
  cancelledCount: number;
  skippedCount: number;
  errorSummary: string | null;
  source: string;
  createdAt: string;
};

type ReminderRunRow = {
  created_at: string;
  details_json: unknown;
};

function asIsoString(value: string | Date | undefined, fallback: string) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function toNonNegativeInt(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.floor(num);
}

function normalizeRunStatus(value: unknown): ReminderRunStatus {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "FAILED") return "FAILED";
  if (normalized === "CANCELLED") return "CANCELLED";
  return "SUCCESS";
}

function truncateErrorSummary(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 280 ? `${trimmed.slice(0, 280)}...` : trimmed;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function writeReminderRun(input: ReminderRunInput) {
  const startedAt = asIsoString(input.startedAt, new Date().toISOString());
  const finishedAt = asIsoString(input.finishedAt, startedAt);

  await writeAuditLog({
    action: CRON_RUN_AUDIT_ACTION,
    entityType: "cron_run",
    details: {
      event_type: input.eventType,
      status: input.status,
      started_at: startedAt,
      finished_at: finishedAt,
      attempted_count: toNonNegativeInt(input.attemptedCount),
      sent_count: toNonNegativeInt(input.sentCount),
      failed_count: toNonNegativeInt(input.failedCount),
      cancelled_count: toNonNegativeInt(input.cancelledCount),
      skipped_count: toNonNegativeInt(input.skippedCount),
      error_summary: truncateErrorSummary(input.errorSummary),
      source: input.source ?? "system",
    },
  });
}

export function parseReminderRunRow(row: ReminderRunRow): ReminderRunRecord | null {
  const details = asObject(row.details_json);
  if (!details) return null;

  const eventType = details.event_type;
  if (!isReminderEventType(eventType)) return null;

  const createdAt = asIsoString(row.created_at, new Date().toISOString());
  const startedAt = asIsoString(
    typeof details.started_at === "string" ? details.started_at : undefined,
    createdAt,
  );
  const finishedAt = asIsoString(
    typeof details.finished_at === "string" ? details.finished_at : undefined,
    startedAt,
  );

  return {
    eventType,
    status: normalizeRunStatus(details.status),
    startedAt,
    finishedAt,
    attemptedCount: toNonNegativeInt(details.attempted_count),
    sentCount: toNonNegativeInt(details.sent_count),
    failedCount: toNonNegativeInt(details.failed_count),
    cancelledCount: toNonNegativeInt(details.cancelled_count),
    skippedCount: toNonNegativeInt(details.skipped_count),
    errorSummary: truncateErrorSummary(details.error_summary),
    source: typeof details.source === "string" && details.source.trim() ? details.source : "system",
    createdAt,
  };
}

export function latestReminderRunsByEventType(rows: ReminderRunRow[]) {
  const latest: Partial<Record<ReminderEventType, ReminderRunRecord>> = {};

  for (const row of rows) {
    const parsed = parseReminderRunRow(row);
    if (!parsed) continue;

    const existing = latest[parsed.eventType];
    if (!existing || new Date(parsed.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latest[parsed.eventType] = parsed;
    }
  }

  return latest;
}

export async function loadLatestReminderRuns() {
  const result = await dbQuery<ReminderRunRow>(
    "select created_at, details_json from audit_logs where action = $1 and entity_type = 'cron_run' and coalesce(details_json->>'event_type', '') = any($2::text[]) order by created_at desc limit 400",
    [CRON_RUN_AUDIT_ACTION, [...REMINDER_EVENT_TYPES]],
  );
  return latestReminderRunsByEventType(result.rows);
}
