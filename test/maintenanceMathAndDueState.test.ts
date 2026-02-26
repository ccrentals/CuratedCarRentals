import assert from "node:assert/strict";
import test from "node:test";

import {
  computeMaintenanceRecordTotal,
  getMaintenanceDueState,
  summarizeMaintenanceRows,
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

test("maintenance SSoT: due state marks upcoming when outside due-soon windows", () => {
  const dueState = getMaintenanceDueState(
    {
      status: "SCHEDULED",
      next_due_date: "2026-05-01",
      next_due_odometer_km: 25000,
    },
    new Date("2026-03-01T09:00:00.000Z"),
    20000,
    { dueSoonDays: 14, dueSoonKm: 500 },
  );

  assert.equal(dueState, "UPCOMING");
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

test("maintenance SSoT: summary metrics aggregate totals and due states", () => {
  const summary = summarizeMaintenanceRows(
    [
      {
        status: "COMPLETED",
        service_date: "2026-02-10",
        scheduled_date: "2026-02-10",
        next_due_date: "2026-04-10",
        next_due_odometer_km: 25000,
        labor_cost_cents: 10000,
        parts_cost_cents: 5000,
        tax_cost_cents: 2000,
        total_cost_cents: null,
        current_odometer_km: 24000,
      },
      {
        status: "SCHEDULED",
        service_date: null,
        scheduled_date: "2026-02-12",
        next_due_date: "2026-02-01",
        next_due_odometer_km: 24500,
        labor_cost_cents: 0,
        parts_cost_cents: 0,
        tax_cost_cents: 0,
        total_cost_cents: 0,
        current_odometer_km: 25000,
      },
    ],
    {
      now: new Date("2026-02-20T12:00:00.000Z"),
      dueSoonDays: 14,
      dueSoonKm: 500,
    },
  );

  assert.equal(summary.totalMaintenanceCostCents, 17000);
  assert.equal(summary.lastServiceDate, "2026-02-10");
  assert.equal(summary.nextDueDate, "2026-02-01");
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.openScheduledCount, 1);
});
