import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminPromoCodesPost } from "@/app/api/admin/promo-codes/route";
import { handleAdminPromoCodePatch } from "@/app/api/admin/promo-codes/[id]/route";
import { handleAdminVehiclePost } from "@/app/api/admin/vehicles/route";
import {
  handleAdminVehicleDelete,
  handleAdminVehiclePatch,
  handleAdminVehicleRestore,
} from "@/app/api/admin/vehicles/[id]/route";
import { handleVehicleMaintenancePost } from "@/app/api/admin/vehicles/[id]/maintenance/route";
import {
  handleVehicleMaintenanceRecordDelete,
  handleVehicleMaintenanceRecordPatch,
} from "@/app/api/admin/vehicles/[id]/maintenance/[recordId]/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";

function adminRoleAuth() {
  return {
    ok: true as const,
    actor: {
      userId: "admin-user-id",
      role: "ADMIN",
      appRole: "ADMIN",
    },
  };
}

function deniedRateLimit(limit = 20) {
  return {
    count: limit + 1,
    limit,
    allowed: false,
    remaining: 0,
    resetAt: "2026-05-25T18:10:00.000Z",
    retryAfterSeconds: 600,
  };
}

test("admin promo codes POST: rate limits repeated promo creation attempts", async () => {
  const response = await handleAdminPromoCodesPost(
    new Request("http://localhost/api/admin/promo-codes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ code: "SAVE10", discountValue: 10, csrfToken: "token" }),
    }),
    {
      requireAdmin: async () => adminRoleAuth(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      query: async () => {
        throw new Error("should not reach database");
      },
      writeAudit: async () => undefined,
      log: () => undefined,
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
});

test("admin promo codes PATCH: rate limits repeated promo updates", async () => {
  const response = await handleAdminPromoCodePatch(
    new Request(`http://localhost/api/admin/promo-codes/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ code: "SAVE10", discountValue: 10, csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      requireAdmin: async () => adminRoleAuth(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      query: async () => {
        throw new Error("should not reach database");
      },
      writeAudit: async () => undefined,
      log: () => undefined,
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
});

test("admin vehicle POST: rate limits repeated vehicle creation attempts", async () => {
  const response = await handleAdminVehiclePost(
    new Request("http://localhost/api/admin/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        make: "Subaru",
        model: "Impreza",
        year: 2020,
        daily_rate_jmd: 7200,
        deposit_jmd: 7000,
        csrfToken: "token",
      }),
    }),
    {
      authorize: async () => adminRoleAuth(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      connect: async () => {
        throw new Error("should not reach database");
      },
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
});

test("admin vehicle PATCH: rate limits repeated vehicle updates", async () => {
  const response = await handleAdminVehiclePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ status: "AVAILABLE", csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      authorize: async () => adminRoleAuth(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      connect: async () => {
        throw new Error("should not reach database");
      },
      writeAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
});

test("admin vehicle restore: rate limits repeated restore attempts", async () => {
  const response = await handleAdminVehicleRestore(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ action: "restore", csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => ({ userId: "admin-user-id", role: "ADMIN" }),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      findVehicleById: async () => null,
      restoreVehicle: async () => false,
      writeRestoreAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
});

test("admin vehicle delete: rate limits repeated delete attempts", async () => {
  const response = await handleAdminVehicleDelete(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => ({ userId: "admin-user-id", role: "ADMIN" }),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      findVehicleById: async () => null,
      countBlockingBookings: async () => 0,
      softDeleteVehicle: async () => false,
      writeDeleteAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
});

test("admin vehicle maintenance POST: rate limits repeated maintenance creation", async () => {
  const response = await handleVehicleMaintenancePost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        title: "Oil change",
        category: "SERVICE",
        scheduledDate: "2026-05-25",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => ({ userId: "admin-user-id", role: "ADMIN" }),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      listRecords: async () => [],
      createRecord: async () => null,
      getRecord: async () => null,
      archiveRecord: async () => false,
      updateRecord: async () => null,
      summarize: async () => ({ activeCount: 0, overdueCount: 0, dueSoonCount: 0, totalOpenCostCents: 0 }),
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
});

test("admin vehicle maintenance PATCH: rate limits repeated maintenance updates", async () => {
  const response = await handleVehicleMaintenanceRecordPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ title: "Updated title", csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => ({ userId: "admin-user-id", role: "ADMIN" }),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      getRecord: async () => null,
      updateRecord: async () => null,
      archiveRecord: async () => false,
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
});

test("admin vehicle maintenance DELETE: rate limits repeated maintenance deletes", async () => {
  const response = await handleVehicleMaintenanceRecordDelete(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => ({ userId: "admin-user-id", role: "ADMIN" }),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => deniedRateLimit(),
      getRecord: async () => null,
      updateRecord: async () => null,
      archiveRecord: async () => false,
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
});
