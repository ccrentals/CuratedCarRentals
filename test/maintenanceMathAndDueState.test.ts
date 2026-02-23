import assert from "node:assert/strict";
import test from "node:test";

import {
  computeMaintenanceRecordTotal,
  getMaintenanceDueState,
} from "@/lib/vehicles/maintenance";

test("maintenance SSoT: computes canonical total from labor + parts + tax", () => {
  const total = computeMaintenanceRecordTotal({
    laborCostCents: 15000,
    partsCostCents: 6000,
    taxCostCents: 3150,
  });

  assert.equal(total, 24150);
});

test("maintenance SSoT: due state marks overdue when date passed", () => {
  const dueState = getMaintenanceDueState(
    {
      status: "SCHEDULED",
      next_due_date: "2026-02-01",
    },
    new Date("2026-02-20T12:00:00.000Z"),
    null,
    { dueSoonDays: 14, dueSoonKm: 500 },
  );

  assert.equal(dueState, "OVERDUE");
});

test("maintenance SSoT: due state marks due soon when odometer threshold is near", () => {
  const dueState = getMaintenanceDueState(
    {
      status: "IN_PROGRESS",
      next_due_date: "2026-03-15",
      next_due_odometer_km: 20500,
    },
    new Date("2026-03-01T09:00:00.000Z"),
    20220,
    { dueSoonDays: 14, dueSoonKm: 500 },
  );

  assert.equal(dueState, "DUE_SOON");
});

test("maintenance SSoT: terminal states return completed/cancelled", () => {
  const completed = getMaintenanceDueState(
    { status: "COMPLETED", next_due_date: "2026-04-01" },
    new Date("2026-03-20T00:00:00.000Z"),
  );
  const cancelled = getMaintenanceDueState(
    { status: "CANCELLED", next_due_date: "2026-04-01" },
    new Date("2026-03-20T00:00:00.000Z"),
  );

  assert.equal(completed, "COMPLETED");
  assert.equal(cancelled, "CANCELLED");
});
