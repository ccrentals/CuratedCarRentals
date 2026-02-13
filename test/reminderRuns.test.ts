import assert from "node:assert/strict";
import test from "node:test";

import {
  REMINDER_EVENT_LABELS,
  REMINDER_EVENT_TYPES,
  isReminderEventType,
} from "@/lib/cron/reminderTypes";
import {
  latestReminderRunsByEventType,
  parseReminderRunRow,
} from "@/lib/cron/reminderRuns";

test("reminder event inventory: labels exist for every canonical event type", () => {
  for (const eventType of REMINDER_EVENT_TYPES) {
    assert.equal(isReminderEventType(eventType), true);
    assert.equal(typeof REMINDER_EVENT_LABELS[eventType], "string");
    assert.notEqual(REMINDER_EVENT_LABELS[eventType].trim(), "");
  }

  assert.equal(isReminderEventType("BOOKING_UNKNOWN_EVENT"), false);
});

test("parseReminderRunRow: parses structured run row with UTC timestamps and counts", () => {
  const row = parseReminderRunRow({
    created_at: "2026-02-13T14:00:00.000Z",
    details_json: {
      event_type: "BOOKING_PICKUP_REMINDER_SENT",
      status: "SUCCESS",
      started_at: "2026-02-13T13:59:59.000Z",
      finished_at: "2026-02-13T14:00:00.000Z",
      attempted_count: 3,
      sent_count: 2,
      failed_count: 1,
      cancelled_count: 0,
      skipped_count: 4,
      error_summary: null,
      source: "cron",
    },
  });

  assert.ok(row);
  assert.equal(row?.eventType, "BOOKING_PICKUP_REMINDER_SENT");
  assert.equal(row?.status, "SUCCESS");
  assert.equal(row?.startedAt, "2026-02-13T13:59:59.000Z");
  assert.equal(row?.finishedAt, "2026-02-13T14:00:00.000Z");
  assert.equal(row?.attemptedCount, 3);
  assert.equal(row?.sentCount, 2);
  assert.equal(row?.failedCount, 1);
  assert.equal(row?.skippedCount, 4);
  assert.equal(row?.source, "cron");
});

test("latestReminderRunsByEventType: returns most recent row per event type", () => {
  const rows = [
    {
      created_at: "2026-02-13T14:00:00.000Z",
      details_json: {
        event_type: "BOOKING_NOTE_EMAIL_SENT",
        status: "SUCCESS",
        finished_at: "2026-02-13T14:00:00.000Z",
      },
    },
    {
      created_at: "2026-02-13T15:00:00.000Z",
      details_json: {
        event_type: "BOOKING_NOTE_EMAIL_SENT",
        status: "SUCCESS",
        finished_at: "2026-02-13T15:00:00.000Z",
      },
    },
    {
      created_at: "2026-02-13T14:30:00.000Z",
      details_json: {
        event_type: "BOOKING_NOTE_EMAIL_FAILED",
        status: "FAILED",
        finished_at: "2026-02-13T14:30:00.000Z",
      },
    },
    {
      created_at: "2026-02-13T14:45:00.000Z",
      details_json: {
        event_type: "INVALID_EVENT_TYPE",
        status: "SUCCESS",
      },
    },
  ];

  const latest = latestReminderRunsByEventType(rows);
  assert.equal(latest.BOOKING_NOTE_EMAIL_SENT?.createdAt, "2026-02-13T15:00:00.000Z");
  assert.equal(latest.BOOKING_NOTE_EMAIL_FAILED?.status, "FAILED");
  assert.equal(Object.prototype.hasOwnProperty.call(latest, "INVALID_EVENT_TYPE"), false);
});

test("latestReminderRunsByEventType: can represent one run row for every canonical event type", () => {
  const now = "2026-02-13T16:00:00.000Z";
  const rows = REMINDER_EVENT_TYPES.map((eventType, index) => ({
    created_at: new Date(Date.parse(now) + index * 1000).toISOString(),
    details_json: {
      event_type: eventType,
      status: eventType.endsWith("_FAILED")
        ? "FAILED"
        : eventType.endsWith("_CANCELLED")
          ? "CANCELLED"
          : "SUCCESS",
      finished_at: new Date(Date.parse(now) + index * 1000).toISOString(),
      attempted_count: 1,
      sent_count: eventType.endsWith("_SENT") ? 1 : 0,
      failed_count: eventType.endsWith("_FAILED") ? 1 : 0,
      cancelled_count: eventType.endsWith("_CANCELLED") ? 1 : 0,
    },
  }));

  const latest = latestReminderRunsByEventType(rows);
  for (const eventType of REMINDER_EVENT_TYPES) {
    assert.ok(latest[eventType], `expected latest run for ${eventType}`);
    assert.equal(latest[eventType]?.eventType, eventType);
  }
});
