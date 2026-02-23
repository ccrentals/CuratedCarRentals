import assert from "node:assert/strict";
import test from "node:test";

import {
  handleVehicleMaintenanceGet,
  handleVehicleMaintenancePost,
} from "@/app/api/admin/vehicles/[id]/maintenance/route";
import {
  handleVehicleMaintenanceRecordDelete,
  handleVehicleMaintenanceRecordPatch,
} from "@/app/api/admin/vehicles/[id]/maintenance/[recordId]/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";

function adminSession() {
  return {
    userId: "99999999-9999-4999-8999-999999999999",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function maintenanceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    vehicle_id: VEHICLE_ID,
    status: "SCHEDULED",
    category: "SERVICE",
    title: "Oil change",
    description: null,
    vendor_name: null,
    vendor_contact: null,
    reference_number: null,
    service_date: null,
    scheduled_date: "2026-03-10",
    odometer_km: 22000,
    next_due_date: "2026-03-15",
    next_due_odometer_km: 26000,
    labor_cost_cents: 11000,
    parts_cost_cents: 4200,
    tax_cost_cents: 2280,
    total_cost_cents: 17480,
    currency: "JMD",
    priority: "NORMAL",
    created_by_user_id: "99999999-9999-4999-8999-999999999999",
    completed_by_user_id: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    archived_at: null,
    current_odometer_km: 22000,
    ...overrides,
  };
}

test("admin vehicle maintenance API: GET requires auth", async () => {
  const response = await handleVehicleMaintenanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      listRecords: async () => [],
      createRecord: async () => null,
      summarize: async () => ({
        totalMaintenanceCostCents: 0,
        lastServiceDate: null,
        nextDueDate: null,
        overdueCount: 0,
        openScheduledCount: 0,
      }),
    },
  );

  assert.equal(response.status, 401);
});

test("admin vehicle maintenance API: POST validates scheduled/service date", async () => {
  const response = await handleVehicleMaintenancePost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        title: "Brake inspection",
        status: "SCHEDULED",
        category: "BRAKE",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listRecords: async () => [],
      createRecord: async () => null,
      summarize: async () => ({
        totalMaintenanceCostCents: 0,
        lastServiceDate: null,
        nextDueDate: null,
        overdueCount: 0,
        openScheduledCount: 0,
      }),
    },
  );

  assert.equal(response.status, 400);
});

test("admin vehicle maintenance API: POST computes canonical total from parts", async () => {
  let capturedTotal = 0;
  const response = await handleVehicleMaintenancePost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        status: "SCHEDULED",
        category: "SERVICE",
        title: "Oil change",
        scheduledDate: "2026-03-10",
        laborCostCents: 10000,
        partsCostCents: 5000,
        taxCostCents: 2250,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listRecords: async () => [],
      createRecord: async (_vehicleId, input) => {
        capturedTotal = input.totalCostCents;
        return maintenanceRow({ total_cost_cents: input.totalCostCents });
      },
      summarize: async () => ({
        totalMaintenanceCostCents: 0,
        lastServiceDate: null,
        nextDueDate: null,
        overdueCount: 0,
        openScheduledCount: 0,
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedTotal, 17250);
});

test("admin vehicle maintenance API: GET filters by dueState query", async () => {
  const response = await handleVehicleMaintenanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance?dueState=OVERDUE`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listRecords: async () => [maintenanceRow({ next_due_date: "2026-02-01" })],
      createRecord: async () => null,
      summarize: async () => ({
        totalMaintenanceCostCents: 17480,
        lastServiceDate: "2026-01-20",
        nextDueDate: "2026-02-01",
        overdueCount: 1,
        openScheduledCount: 1,
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok?: boolean; items?: Array<{ dueState?: string }> };
  assert.equal(body.ok, true);
  assert.equal(body.items?.length, 1);
  assert.equal(body.items?.[0]?.dueState, "OVERDUE");
});

test("admin maintenance record API: PATCH updates a record", async () => {
  const response = await handleVehicleMaintenanceRecordPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        title: "Updated oil change",
        laborCostCents: 12000,
        partsCostCents: 5200,
        taxCostCents: 2580,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getRecord: async () => maintenanceRow(),
      updateRecord: async (_vehicleId, _recordId, patch) =>
        maintenanceRow({
          title: patch.title ?? "Updated oil change",
          labor_cost_cents: patch.laborCostCents ?? 12000,
          parts_cost_cents: patch.partsCostCents ?? 5200,
          tax_cost_cents: patch.taxCostCents ?? 2580,
          total_cost_cents: 19780,
        }),
      archiveRecord: async () => true,
    },
  );

  assert.equal(response.status, 200);
});

test("admin maintenance record API: DELETE archives record", async () => {
  const response = await handleVehicleMaintenanceRecordDelete(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getRecord: async () => maintenanceRow(),
      updateRecord: async () => maintenanceRow(),
      archiveRecord: async () => true,
    },
  );

  assert.equal(response.status, 200);
});
