import assert from "node:assert/strict";
import test from "node:test";

import { createBlockout, listBlockouts } from "@/lib/blockouts/shared";

test("blockouts shared service: create blockout uses source-of-truth table", async () => {
  let capturedSql = "";
  let capturedValues: unknown[] = [];

  const created = await createBlockout(
    {
      vehicleId: "11111111-1111-4111-8111-111111111111",
      startAtIso: "2026-02-24T08:00:00.000Z",
      endAtIso: "2026-02-24T18:00:00.000Z",
      reason: "Maintenance",
      notes: "Brake service",
      createdByUserId: "22222222-2222-4222-8222-222222222222",
    },
    {
      query: async <T>(text: string, values?: unknown[]) => {
        capturedSql = text;
        capturedValues = values ?? [];
        return {
          rows: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              vehicle_id: "11111111-1111-4111-8111-111111111111",
              start_at: "2026-02-24T08:00:00.000Z",
              end_at: "2026-02-24T18:00:00.000Z",
              reason: "Maintenance",
              notes: "Brake service",
              created_by: "22222222-2222-4222-8222-222222222222",
              created_at: "2026-02-24T07:00:00.000Z",
              updated_at: "2026-02-24T07:00:00.000Z",
            } as T,
          ],
          rowCount: 1,
        };
      },
    },
  );

  assert.match(capturedSql, /insert into blockouts/i);
  assert.equal(capturedValues[0], "11111111-1111-4111-8111-111111111111");
  assert.equal(created?.reason, "Maintenance");
});

test("blockouts shared service: list supports range + vehicle linkage filters", async () => {
  let capturedSql = "";
  let capturedValues: unknown[] = [];

  const rows = await listBlockouts(
    {
      rangeStartIso: "2026-02-01T00:00:00.000Z",
      rangeEndIso: "2026-02-28T23:59:59.999Z",
      vehicleId: "11111111-1111-4111-8111-111111111111",
    },
    {
      query: async <T>(text: string, values?: unknown[]) => {
        capturedSql = text;
        capturedValues = values ?? [];
        return {
          rows: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              vehicle_id: "11111111-1111-4111-8111-111111111111",
              start_at: "2026-02-24T08:00:00.000Z",
              end_at: "2026-02-24T18:00:00.000Z",
              reason: "Maintenance",
              notes: "Brake service",
              created_at: "2026-02-24T07:00:00.000Z",
              updated_at: "2026-02-24T07:00:00.000Z",
              vehicle_make: "Honda",
              vehicle_model: "Fit",
            } as T,
          ],
          rowCount: 1,
        };
      },
    },
  );

  assert.match(capturedSql, /from blockouts/i);
  assert.equal(capturedValues.length, 3);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.vehicle_id, "11111111-1111-4111-8111-111111111111");
});
