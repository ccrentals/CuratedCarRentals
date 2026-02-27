import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { config as loadEnv } from "dotenv";

import { handleVehicleMaintenanceGet } from "@/app/api/admin/vehicles/[id]/maintenance/route";
import { dbQuery } from "@/lib/db";

loadEnv({ path: ".env.local" });
loadEnv();

type CreatedVehicle = {
  id: string;
};

type CreatedMaintenance = {
  id: string;
  public_id: string;
};

function requireDatabaseOrSkip(t: TestContext) {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not set; skipping DB-backed maintenance public id tests.");
  }
}

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: Date.now() + 60_000,
    issuedAt: Date.now(),
  };
}

async function insertVehicle(runTag: string) {
  const result = await dbQuery<CreatedVehicle>(
    "insert into vehicles (make, model, year, seat_count, daily_rate_cents, deposit_cents, status, image_urls_json, features_json) values ($1, $2, $3, $4, $5, $6, 'AVAILABLE', $7::jsonb, $8::jsonb) returning id",
    [
      `Maintenance ID Make ${runTag}`,
      `Maintenance ID Model ${runTag}`,
      2034,
      5,
      13000,
      80000,
      JSON.stringify([]),
      JSON.stringify({ source: "test", runTag }),
    ],
  );
  return result.rows[0].id;
}

async function insertMaintenanceRecord(input: { vehicleId: string; runTag: string }) {
  const result = await dbQuery<CreatedMaintenance>(
    "insert into vehicle_maintenance_records (vehicle_id, status, category, title, scheduled_date, priority, currency) values ($1::uuid, 'SCHEDULED', 'SERVICE', $2, $3::date, 'NORMAL', 'JMD') returning id, public_id",
    [input.vehicleId, `Public ID maintenance ${input.runTag}`, "2037-04-01"],
  );
  return result.rows[0];
}

async function cleanup(input: { maintenanceIds: string[]; vehicleIds: string[] }) {
  if (input.maintenanceIds.length > 0) {
    await dbQuery("delete from vehicle_maintenance_records where id = any($1::uuid[])", [
      input.maintenanceIds,
    ]);
  }
  if (input.vehicleIds.length > 0) {
    await dbQuery("delete from vehicles where id = any($1::uuid[])", [input.vehicleIds]);
  }
}

test("maintenance insert auto-generates ME public_id", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `me-public-id-${randomUUID().slice(0, 8)}`;
  const maintenanceIds: string[] = [];
  const vehicleIds: string[] = [];

  try {
    const vehicleId = await insertVehicle(runTag);
    vehicleIds.push(vehicleId);

    const record = await insertMaintenanceRecord({ vehicleId, runTag });
    maintenanceIds.push(record.id);

    assert.match(record.public_id, /^ME\d{6,}$/);
  } finally {
    await cleanup({ maintenanceIds, vehicleIds });
  }
});

test("vehicle maintenance API list returns maintenance public_id", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `me-public-id-api-${randomUUID().slice(0, 8)}`;
  const maintenanceIds: string[] = [];
  const vehicleIds: string[] = [];

  try {
    const vehicleId = await insertVehicle(runTag);
    vehicleIds.push(vehicleId);

    const record = await insertMaintenanceRecord({ vehicleId, runTag });
    maintenanceIds.push(record.id);

    let capturedQuery: string | null = null;
    const response = await handleVehicleMaintenanceGet(
      new Request(
        `http://localhost/api/admin/vehicles/${vehicleId}/maintenance?q=${encodeURIComponent(record.public_id)}`,
      ),
      { params: Promise.resolve({ id: vehicleId }) },
      {
        getSession: async () => adminSession(),
        requireCsrfCheck: async () => true,
        getDueConfig: async () => ({ dueSoonDays: 14, dueSoonKm: 500 }),
        listRecords: async (_vehicleId, filters) => {
          capturedQuery = filters.query;
          return {
            rows: [
              {
                id: record.id,
                public_id: record.public_id,
                vehicle_id: vehicleId,
                status: "SCHEDULED",
                category: "SERVICE",
                title: `Public ID maintenance ${runTag}`,
                description: null,
                vendor_name: null,
                vendor_contact: null,
                reference_number: null,
                service_date: null,
                scheduled_date: "2037-04-01",
                completed_date: null,
                odometer_km: null,
                next_due_date: null,
                next_due_odometer_km: null,
                reminder_lead_days: 7,
                labor_cost_cents: 0,
                parts_cost_cents: 0,
                tax_cost_cents: 0,
                estimated_cost_cents: null,
                actual_cost_cents: null,
                total_cost_cents: 0,
                linked_expense_id: null,
                linked_repair_order_id: null,
                currency: "JMD",
                priority: "NORMAL",
                created_by_user_id: null,
                completed_by_user_id: null,
                created_at: "2037-03-01T00:00:00.000Z",
                updated_at: "2037-03-01T00:00:00.000Z",
                archived_at: null,
                current_odometer_km: null,
                linked_blockout_id: null,
                linked_blockout_start_at: null,
                linked_blockout_end_at: null,
                linked_blockout_reason: null,
                linked_blockout_source: null,
              },
            ],
            total: 1,
          };
        },
        createRecord: async () => null,
        summarize: async () => ({
          totalMaintenanceCostCents: 0,
          lastServiceDate: null,
          nextDueDate: null,
          overdueCount: 0,
          openScheduledCount: 1,
        }),
      },
    );

    assert.equal(response.status, 200);
    assert.equal(capturedQuery, record.public_id);
    const payload = (await response.json()) as {
      rows?: Array<{ id: string; publicId?: string }>;
    };
    const row = payload.rows?.find((item) => item.id === record.id);
    assert.ok(row);
    assert.equal(row?.publicId, record.public_id);
  } finally {
    await cleanup({ maintenanceIds, vehicleIds });
  }
});
