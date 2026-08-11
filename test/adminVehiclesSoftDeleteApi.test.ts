import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminVehicleDelete } from "@/app/api/admin/vehicles/[id]/implementation";
import { handleAdminVehiclesGet } from "@/app/api/admin/vehicles/implementation";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

function adminSession() {
  return {
    userId: "admin-user-id",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function allowRateLimit() {
  return {
    count: 1,
    limit: 20,
    allowed: true,
    remaining: 19,
    resetAt: "2026-03-14T12:10:00.000Z",
    retryAfterSeconds: 600,
  };
}

test("deleting vehicle with active/upcoming bookings returns 409", async () => {
  let softDeleteCalled = false;
  const response = await handleAdminVehicleDelete(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => allowRateLimit(),
      findVehicleById: async () => ({ id: VEHICLE_ID, deleted_at: null }),
      countBlockingBookings: async () => 1,
      softDeleteVehicle: async () => {
        softDeleteCalled = true;
        return true;
      },
      writeDeleteAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 409);
  assert.equal(softDeleteCalled, false);
});

test("soft-deleted vehicle is hidden from default list and visible in archived list", async () => {
  const rows: Array<{
    id: string;
    public_id: string;
    make: string;
    model: string;
    year: number;
    seat_count: number | null;
    daily_rate_cents: number;
    deposit_cents: number;
    status: string;
    created_at: string;
    deleted_at: string | null;
  }> = [
    {
      id: VEHICLE_ID,
      public_id: "VE000999",
      make: "Toyota",
      model: "Yaris",
      year: 2024,
      seat_count: 5,
      daily_rate_cents: 10_000,
      deposit_cents: 3_000,
      status: "AVAILABLE",
      created_at: "2026-02-27T12:00:00.000Z",
      deleted_at: null,
    },
  ];

  const deleteResponse = await handleAdminVehicleDelete(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => allowRateLimit(),
      findVehicleById: async (vehicleId) => rows.find((row) => row.id === vehicleId) ?? null,
      countBlockingBookings: async () => 0,
      softDeleteVehicle: async (vehicleId) => {
        const target = rows.find((row) => row.id === vehicleId);
        if (!target || target.deleted_at) return false;
        target.deleted_at = "2026-02-27T13:00:00.000Z";
        return true;
      },
      writeDeleteAudit: async () => undefined,
    },
  );
  assert.equal(deleteResponse.status, 200);
  assert.equal(typeof rows[0]?.deleted_at, "string");

  const activeListResponse = await handleAdminVehiclesGet(
    new Request("http://localhost/api/admin/vehicles"),
    {
      getSession: async () => adminSession(),
      listVehicles: async ({ includeDeleted }) =>
        rows.filter((row) => (includeDeleted ? row.deleted_at !== null : row.deleted_at === null)),
    },
  );
  assert.equal(activeListResponse.status, 200);
  const activeListJson = (await activeListResponse.json()) as { vehicles?: Array<{ id: string }> };
  assert.equal(activeListJson.vehicles?.length, 0);

  const archivedListResponse = await handleAdminVehiclesGet(
    new Request("http://localhost/api/admin/vehicles?includeDeleted=1"),
    {
      getSession: async () => adminSession(),
      listVehicles: async ({ includeDeleted }) =>
        rows.filter((row) => (includeDeleted ? row.deleted_at !== null : row.deleted_at === null)),
    },
  );
  assert.equal(archivedListResponse.status, 200);
  const archivedListJson = (await archivedListResponse.json()) as { vehicles?: Array<{ id: string }> };
  assert.equal(archivedListJson.vehicles?.length, 1);
  assert.equal(archivedListJson.vehicles?.[0]?.id, VEHICLE_ID);
});
