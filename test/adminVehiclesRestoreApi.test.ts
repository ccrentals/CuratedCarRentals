import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminVehicleRestore } from "@/app/api/admin/vehicles/[id]/implementation";

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

test("restoring an archived vehicle clears deleted_at", async () => {
  let restoreCalled = false;
  const response = await handleAdminVehicleRestore(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ action: "restore", csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => allowRateLimit(),
      findVehicleById: async () => ({ id: VEHICLE_ID, deleted_at: "2026-04-02T08:00:00.000Z" }),
      restoreVehicle: async () => {
        restoreCalled = true;
        return true;
      },
      writeRestoreAudit: async () => undefined,
    },
    { action: "restore", csrfToken: "token" },
  );

  assert.equal(response.status, 200);
  assert.equal(restoreCalled, true);
  assert.deepEqual(await response.json(), { ok: true });
});

test("restoring an active vehicle is a no-op", async () => {
  let restoreCalled = false;
  const response = await handleAdminVehicleRestore(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ action: "restore", csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => allowRateLimit(),
      findVehicleById: async () => ({ id: VEHICLE_ID, deleted_at: null }),
      restoreVehicle: async () => {
        restoreCalled = true;
        return true;
      },
      writeRestoreAudit: async () => undefined,
    },
    { action: "restore", csrfToken: "token" },
  );

  assert.equal(response.status, 200);
  assert.equal(restoreCalled, false);
  assert.deepEqual(await response.json(), { ok: true, alreadyRestored: true });
});
