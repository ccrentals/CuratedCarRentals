import assert from "node:assert/strict";
import test from "node:test";

import {
  isMaintenanceCompleted,
  removeMaintenanceBlockoutByRecordId,
  syncMaintenanceBlockout,
  upsertMaintenanceBlockout,
} from "@/lib/vehicles/maintenanceBlockouts";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const MAINTENANCE_ID = "22222222-2222-4222-8222-222222222222";
const BLOCKOUT_ID = "33333333-3333-4333-8333-333333333333";

test("maintenance blockouts: creates linked blockout when none exists", async () => {
  const statements: string[] = [];

  const linked = await upsertMaintenanceBlockout(
    {
      vehicleId: VEHICLE_ID,
      maintenanceRecordId: MAINTENANCE_ID,
      title: "Brake service",
      scheduledDate: "2026-03-10",
      createdByUserId: "99999999-9999-4999-8999-999999999999",
    },
    {
      query: async <T>(text: string) => {
        statements.push(text);
        if (/select id, start_at, end_at, reason, notes, source from blockouts/i.test(text)) {
          return { rows: [] as T[], rowCount: 0 };
        }
        return {
          rows: [
            {
              id: BLOCKOUT_ID,
              start_at: "2026-03-10T00:00:00.000Z",
              end_at: "2026-03-11T00:00:00.000Z",
              reason: "Maintenance: Brake service",
              notes: null,
              source: "MAINTENANCE",
            } as T,
          ],
          rowCount: 1,
        };
      },
    },
  );

  assert.equal(linked?.id, BLOCKOUT_ID);
  assert.equal(linked?.source, "MAINTENANCE");
  assert.equal(statements.some((entry) => /insert into blockouts/i.test(entry)), true);
});

test("maintenance blockouts: updates existing linked blockout idempotently", async () => {
  const statements: string[] = [];

  const linked = await upsertMaintenanceBlockout(
    {
      vehicleId: VEHICLE_ID,
      maintenanceRecordId: MAINTENANCE_ID,
      title: "Brake service",
      startAt: "2026-03-10T08:00:00.000Z",
      endAt: "2026-03-10T18:00:00.000Z",
      reason: "Maintenance window",
      notes: "Work bay 2",
      createdByUserId: "99999999-9999-4999-8999-999999999999",
    },
    {
      query: async <T>(text: string) => {
        statements.push(text);
        if (/select id, start_at, end_at, reason, notes, source from blockouts/i.test(text)) {
          return {
            rows: [
              {
                id: BLOCKOUT_ID,
                start_at: "2026-03-10T00:00:00.000Z",
                end_at: "2026-03-11T00:00:00.000Z",
                reason: "Old",
                notes: null,
                source: "MAINTENANCE",
              } as T,
            ],
            rowCount: 1,
          };
        }
        return {
          rows: [
            {
              id: BLOCKOUT_ID,
              start_at: "2026-03-10T08:00:00.000Z",
              end_at: "2026-03-10T18:00:00.000Z",
              reason: "Maintenance window",
              notes: "Work bay 2",
              source: "MAINTENANCE",
            } as T,
          ],
          rowCount: 1,
        };
      },
    },
  );

  assert.equal(linked?.id, BLOCKOUT_ID);
  assert.equal(statements.some((entry) => /update blockouts/i.test(entry)), true);
  assert.equal(statements.some((entry) => /insert into blockouts/i.test(entry)), false);
});

test("maintenance blockouts: removes linked maintenance blockout by record id", async () => {
  const removed = await removeMaintenanceBlockoutByRecordId(MAINTENANCE_ID, {
    query: async <T>() => ({
      rows: [{ id: BLOCKOUT_ID } as T],
      rowCount: 1,
    }),
  });

  assert.equal(removed, 1);
});

test("maintenance blockouts: completion detection supports status or completed date", () => {
  assert.equal(isMaintenanceCompleted({ status: "COMPLETED" }), true);
  assert.equal(isMaintenanceCompleted({ completed_date: "2026-03-10" }), true);
  assert.equal(isMaintenanceCompleted({ status: "SCHEDULED", completedDate: null }), false);
});

test("maintenance blockouts: sync removes linked blockout when maintenance is completed", async () => {
  const statements: string[] = [];

  const result = await syncMaintenanceBlockout(
    {
      vehicleId: VEHICLE_ID,
      maintenanceRecordId: MAINTENANCE_ID,
      title: "Brake service",
      scheduledDate: "2026-03-10",
      status: "COMPLETED",
      ensureWhenOpen: true,
    },
    {
      query: async <T>(text: string) => {
        statements.push(text);
        return { rows: [{ id: BLOCKOUT_ID } as T], rowCount: 1 };
      },
    },
  );

  assert.equal(result.action, "removed");
  assert.equal(statements.some((entry) => /delete from blockouts/i.test(entry)), true);
  assert.equal(statements.some((entry) => /insert into blockouts/i.test(entry)), false);
});

test("maintenance blockouts: sync recreates/updates linked blockout for open maintenance", async () => {
  const statements: string[] = [];

  const result = await syncMaintenanceBlockout(
    {
      vehicleId: VEHICLE_ID,
      maintenanceRecordId: MAINTENANCE_ID,
      title: "Brake service",
      scheduledDate: "2026-03-10",
      status: "SCHEDULED",
      ensureWhenOpen: true,
    },
    {
      query: async <T>(text: string) => {
        statements.push(text);
        if (/select id, start_at, end_at, reason, notes, source from blockouts/i.test(text)) {
          return { rows: [] as T[], rowCount: 0 };
        }
        return {
          rows: [
            {
              id: BLOCKOUT_ID,
              start_at: "2026-03-10T00:00:00.000Z",
              end_at: "2026-03-11T00:00:00.000Z",
              reason: "Maintenance: Brake service",
              notes: null,
              source: "MAINTENANCE",
            } as T,
          ],
          rowCount: 1,
        };
      },
    },
  );

  assert.equal(result.action, "upserted");
  assert.equal(result.blockout?.id, BLOCKOUT_ID);
  assert.equal(statements.some((entry) => /insert into blockouts/i.test(entry)), true);
});

test("maintenance blockouts: date objects from database rows still produce blockouts", async () => {
  const result = await syncMaintenanceBlockout(
    {
      vehicleId: VEHICLE_ID,
      maintenanceRecordId: MAINTENANCE_ID,
      title: "Brake service",
      scheduledDate: new Date("2026-03-10T05:00:00.000Z"),
      status: "SCHEDULED",
      ensureWhenOpen: true,
    },
    {
      query: async <T>(text: string) => {
        if (/select id, start_at, end_at, reason, notes, source from blockouts/i.test(text)) {
          return { rows: [] as T[], rowCount: 0 };
        }
        return {
          rows: [
            {
              id: BLOCKOUT_ID,
              start_at: "2026-03-10T00:00:00.000Z",
              end_at: "2026-03-11T00:00:00.000Z",
              reason: "Maintenance: Brake service",
              notes: null,
              source: "MAINTENANCE",
            } as T,
          ],
          rowCount: 1,
        };
      },
    },
  );

  assert.equal(result.action, "upserted");
  assert.equal(result.blockout?.id, BLOCKOUT_ID);
});
