import assert from "node:assert/strict";
import test from "node:test";

import { computeNextDue, isDateDueSoon } from "@/lib/maintenance/due";

test("maintenance due computation: computes next due date and odometer", () => {
  const due = computeNextDue({
    intervalDays: 180,
    intervalOdometer: 8000,
    lastServiceDate: "2026-01-15",
    lastServiceOdometer: 45200,
  });

  assert.equal(due.nextDueDate, "2026-07-14");
  assert.equal(due.nextDueOdometer, 53200);
});

test("maintenance due computation: handles missing baselines", () => {
  const due = computeNextDue({
    intervalDays: 180,
    intervalOdometer: 8000,
    lastServiceDate: null,
    lastServiceOdometer: null,
  });

  assert.equal(due.nextDueDate, null);
  assert.equal(due.nextDueOdometer, null);
});

test("maintenance due computation: due soon window check", () => {
  const now = new Date("2026-02-23T12:00:00.000Z");

  assert.equal(
    isDateDueSoon({
      nextDueDate: "2026-02-28",
      now,
      leadDays: 7,
    }),
    true,
  );

  assert.equal(
    isDateDueSoon({
      nextDueDate: "2026-03-10",
      now,
      leadDays: 7,
    }),
    false,
  );
});

