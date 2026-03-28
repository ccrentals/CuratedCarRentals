import assert from "node:assert/strict";
import test from "node:test";

import { summarizeReminderEvent } from "@/lib/cron/reminderEventSummary";
import { REMINDER_EVENTS } from "@/lib/cron/reminderTypes";

test("summarizeReminderEvent: formats pickup reminder payloads into readable summary text", () => {
  const summary = summarizeReminderEvent(REMINDER_EVENTS.PICKUP_SENT, {
    pickup_date: "2026-03-22",
    balance_due: 580000,
  });

  assert.equal(summary.primary, "Pickup reminder for 2026-03-22");
  assert.deepEqual(summary.badges, []);
  assert.ok(summary.secondary.includes("Pickup 2026-03-22"));
  assert.ok(summary.secondary.includes("Balance $580,000.00"));
  assert.equal(summary.error, null);
});

test("summarizeReminderEvent: formats balance reminders with subtype and failure error", () => {
  const summary = summarizeReminderEvent(REMINDER_EVENTS.BALANCE_FAILED, {
    dropoff_date: "2026-03-23",
    reminder_type: "late_dropoff",
    balance_due: 950000,
    error: "delivery failed",
  });

  assert.equal(summary.primary, "Late Dropoff reminder for 2026-03-23");
  assert.ok(summary.secondary.includes("Dropoff 2026-03-23"));
  assert.ok(summary.secondary.includes("Balance $950,000.00"));
  assert.ok(summary.secondary.includes("Late Dropoff"));
  assert.equal(summary.error, "delivery failed");
});

test("summarizeReminderEvent: parses JSON provider errors into readable message text", () => {
  const summary = summarizeReminderEvent(REMINDER_EVENTS.PICKUP_FAILED, {
    pickup_date: "2026-02-28",
    balance_due: 35000,
    error:
      '{"statusCode":403,"name":"validation_error","message":"You can only send testing emails to your own email address."}',
  });

  assert.equal(summary.primary, "Pickup reminder for 2026-02-28");
  assert.equal(
    summary.error,
    "Validation Error (403): You can only send testing emails to your own email address.",
  );
});

test("summarizeReminderEvent: formats scheduled note events with targets", () => {
  const summary = summarizeReminderEvent(REMINDER_EVENTS.NOTE_SENT, {
    scheduled_for: "2026-03-22T14:30:00.000Z",
    targets: ["customer", "internal"],
  });

  assert.match(summary.primary, /^Scheduled note for /);
  assert.ok(summary.secondary.some((item) => item.startsWith("Scheduled ")));
  assert.ok(summary.secondary.includes("Targets customer, internal"));
  assert.equal(summary.error, null);
});

test("summarizeReminderEvent: flags simulated events with diagnostic context", () => {
  const summary = summarizeReminderEvent(REMINDER_EVENTS.NOTE_FAILED, {
    simulated: true,
    mode: "all",
    run_status: "FAILED",
    customer_name: "Jane Doe",
    vehicle: "Toyota Yaris",
    start_date: "2026-03-21",
    end_date: "2026-03-23",
  });

  assert.ok(summary.badges.includes("Simulated"));
  assert.ok(summary.secondary.includes("Jane Doe"));
  assert.ok(summary.secondary.includes("Toyota Yaris"));
  assert.ok(summary.secondary.includes("Pickup 2026-03-21"));
  assert.ok(summary.secondary.includes("Dropoff 2026-03-23"));
  assert.ok(summary.secondary.includes("Mode all"));
  assert.ok(summary.secondary.includes("Run failed"));
});

test("summarizeReminderEvent: falls back to compact unknown payload output", () => {
  const summary = summarizeReminderEvent("BOOKING_UNKNOWN_EVENT", {
    reason: "No structured formatter",
    attempt: 2,
  });

  assert.equal(summary.primary, "reason: No structured formatter");
  assert.ok(summary.secondary.includes("attempt: 2"));
});
