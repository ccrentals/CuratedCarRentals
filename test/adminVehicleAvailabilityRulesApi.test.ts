import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminVehicleAvailabilityRulesGet,
  handleAdminVehicleAvailabilityRulesPatch,
} from "@/app/api/admin/vehicles/[id]/availability-rules/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

function adminSession() {
  return {
    userId: "99999999-9999-4999-8999-999999999999",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function defaultRules() {
  return {
    id: null,
    vehicleId: VEHICLE_ID,
    advanceNoticeHours: 0,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    allowedPickupStartHour: null,
    allowedPickupEndHour: null,
    allowedDropoffStartHour: null,
    allowedDropoffEndHour: null,
    isActive: true,
    createdAt: null,
    updatedAt: null,
  };
}

test("vehicle availability rules API: GET requires auth", async () => {
  const response = await handleAdminVehicleAvailabilityRulesGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/availability-rules`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      vehicleExists: async () => true,
      getRules: async () => ({ rules: defaultRules(), defaultsApplied: true }),
      saveRules: async () => defaultRules(),
    },
  );

  assert.equal(response.status, 401);
});

test("vehicle availability rules API: GET validates vehicle id", async () => {
  const response = await handleAdminVehicleAvailabilityRulesGet(
    new Request("http://localhost/api/admin/vehicles/not-a-uuid/availability-rules"),
    { params: Promise.resolve({ id: "not-a-uuid" }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      vehicleExists: async () => true,
      getRules: async () => ({ rules: defaultRules(), defaultsApplied: true }),
      saveRules: async () => defaultRules(),
    },
  );

  assert.equal(response.status, 400);
});

test("vehicle availability rules API: GET returns 404 when vehicle missing", async () => {
  const response = await handleAdminVehicleAvailabilityRulesGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/availability-rules`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      vehicleExists: async () => false,
      getRules: async () => ({ rules: defaultRules(), defaultsApplied: true }),
      saveRules: async () => defaultRules(),
    },
  );

  assert.equal(response.status, 404);
});

test("vehicle availability rules API: GET returns defaults when no record exists", async () => {
  const response = await handleAdminVehicleAvailabilityRulesGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/availability-rules`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      vehicleExists: async () => true,
      getRules: async () => ({
        rules: defaultRules(),
        defaultsApplied: true,
      }),
      saveRules: async () => defaultRules(),
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    defaultsApplied: boolean;
    rules: { advanceNoticeHours: number; isActive: boolean };
  };
  assert.equal(body.ok, true);
  assert.equal(body.defaultsApplied, true);
  assert.equal(body.rules.advanceNoticeHours, 0);
  assert.equal(body.rules.isActive, true);
});

test("vehicle availability rules API: PATCH requires CSRF", async () => {
  const response = await handleAdminVehicleAvailabilityRulesPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/availability-rules`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ advanceNoticeHours: 4 }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => false,
      vehicleExists: async () => true,
      getRules: async () => ({ rules: defaultRules(), defaultsApplied: true }),
      saveRules: async () => defaultRules(),
    },
  );

  assert.equal(response.status, 403);
});

test("vehicle availability rules API: PATCH validates invalid ranges", async () => {
  const response = await handleAdminVehicleAvailabilityRulesPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/availability-rules`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        allowedPickupStartHour: 20,
        allowedPickupEndHour: 10,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      vehicleExists: async () => true,
      getRules: async () => ({ rules: defaultRules(), defaultsApplied: true }),
      saveRules: async () => defaultRules(),
    },
  );

  assert.equal(response.status, 400);
});

test("vehicle availability rules API: PATCH persists and returns saved values", async () => {
  let capturedPatch: Record<string, unknown> | null = null;

  const response = await handleAdminVehicleAvailabilityRulesPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/availability-rules`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        advanceNoticeHours: "6",
        bufferBeforeMinutes: "30",
        bufferAfterMinutes: "20",
        allowedPickupStartHour: "8",
        allowedPickupEndHour: "18",
        allowedDropoffStartHour: "9",
        allowedDropoffEndHour: "21",
        isActive: true,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      vehicleExists: async () => true,
      getRules: async () => ({ rules: defaultRules(), defaultsApplied: true }),
      saveRules: async (_vehicleId, patch) => {
        capturedPatch = patch as unknown as Record<string, unknown>;
        return {
          ...defaultRules(),
          id: "22222222-2222-4222-8222-222222222222",
          advanceNoticeHours: patch.advanceNoticeHours,
          bufferBeforeMinutes: patch.bufferBeforeMinutes,
          bufferAfterMinutes: patch.bufferAfterMinutes,
          allowedPickupStartHour: patch.allowedPickupStartHour,
          allowedPickupEndHour: patch.allowedPickupEndHour,
          allowedDropoffStartHour: patch.allowedDropoffStartHour,
          allowedDropoffEndHour: patch.allowedDropoffEndHour,
          isActive: patch.isActive,
          createdAt: "2026-02-26T00:00:00.000Z",
          updatedAt: "2026-02-26T00:00:00.000Z",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.ok(capturedPatch);
  const savedPatch = capturedPatch as Record<string, unknown>;
  assert.equal(savedPatch.advanceNoticeHours, 6);
  assert.equal(savedPatch.bufferBeforeMinutes, 30);
  assert.equal(savedPatch.bufferAfterMinutes, 20);
  assert.equal(savedPatch.allowedPickupStartHour, 8);
  assert.equal(savedPatch.allowedPickupEndHour, 18);
  assert.equal(savedPatch.allowedDropoffStartHour, 9);
  assert.equal(savedPatch.allowedDropoffEndHour, 21);

  const body = (await response.json()) as {
    ok: boolean;
    defaultsApplied: boolean;
    rules: {
      advanceNoticeHours: number;
      bufferBeforeMinutes: number;
      bufferAfterMinutes: number;
      allowedPickupStartHour: number | null;
      allowedPickupEndHour: number | null;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.defaultsApplied, false);
  assert.equal(body.rules.advanceNoticeHours, 6);
  assert.equal(body.rules.bufferBeforeMinutes, 30);
  assert.equal(body.rules.bufferAfterMinutes, 20);
  assert.equal(body.rules.allowedPickupStartHour, 8);
  assert.equal(body.rules.allowedPickupEndHour, 18);
});
