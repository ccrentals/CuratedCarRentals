import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminVehicleChecklistGet } from "@/app/api/admin/vehicles/[id]/checklist/route";
import { handleVehicleMaintenanceGet } from "@/app/api/admin/vehicles/[id]/maintenance/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

function adminSession() {
  return {
    userId: "admin-user-id",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

test("vehicle checklist foundation smoke: GET returns ok payload", async () => {
  const response = await handleAdminVehicleChecklistGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/checklist`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listItems: async () => [],
      createItem: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as { ok?: boolean; items?: unknown[] };
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.items, []);
});

test("vehicle maintenance foundation smoke: GET returns ok payload", async () => {
  const response = await handleVehicleMaintenanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getDueConfig: async () => ({ dueSoonDays: 14, dueSoonKm: 500 }),
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

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok?: boolean;
    items?: unknown[];
    summary?: { totalMaintenanceCostCents?: number };
  };
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.items, []);
  assert.equal(payload.summary?.totalMaintenanceCostCents, 0);
});
