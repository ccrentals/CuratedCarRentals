import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminVehiclePricingRulesDelete,
  handleAdminVehiclePricingRulesGet,
  handleAdminVehiclePricingRulesPatch,
} from "@/app/api/admin/vehicles/[id]/pricing-rules/route";
import type { VehiclePricingProfile } from "@/lib/bookings/pricingRules";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

function adminSession() {
  return {
    userId: "99999999-9999-4999-8999-999999999999",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function defaultProfile(): VehiclePricingProfile {
  return {
    vehicleId: VEHICLE_ID,
    vehicleLabel: "Test Vehicle",
    vehicleClass: "SUV",
    defaultDailyRateCents: 15000,
    defaultDepositCents: 250000,
    defaultsApplied: true,
    rules: {
      id: null,
      vehicleId: VEHICLE_ID,
      baseDailyRateCents: null,
      baseDepositCents: null,
      weekendDailyRateCents: null,
      dateRangeOverrides: [],
      deliveryEnabled: false,
      deliveryFeeCents: 0,
      deliveryZones: [],
      currency: "JMD",
      isActive: true,
      createdAt: null,
      updatedAt: null,
    },
  };
}

test("vehicle pricing rules API: GET requires auth", async () => {
  const response = await handleAdminVehiclePricingRulesGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/pricing-rules`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      vehicleExists: async () => true,
      getProfile: async () => defaultProfile(),
      deleteRules: async () => {},
      saveRules: async () => defaultProfile().rules,
    },
  );

  assert.equal(response.status, 401);
});

test("vehicle pricing rules API: GET validates vehicle id", async () => {
  const response = await handleAdminVehiclePricingRulesGet(
    new Request("http://localhost/api/admin/vehicles/not-a-uuid/pricing-rules"),
    { params: Promise.resolve({ id: "not-a-uuid" }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      vehicleExists: async () => true,
      getProfile: async () => defaultProfile(),
      deleteRules: async () => {},
      saveRules: async () => defaultProfile().rules,
    },
  );

  assert.equal(response.status, 400);
});

test("vehicle pricing rules API: GET returns defaults when none exists", async () => {
  const response = await handleAdminVehiclePricingRulesGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/pricing-rules`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      vehicleExists: async () => true,
      getProfile: async () => defaultProfile(),
      deleteRules: async () => {},
      saveRules: async () => defaultProfile().rules,
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    defaultsApplied: boolean;
    rules: { deliveryEnabled: boolean; deliveryFeeCents: number };
  };
  assert.equal(body.ok, true);
  assert.equal(body.defaultsApplied, true);
  assert.equal(body.rules.deliveryEnabled, false);
  assert.equal(body.rules.deliveryFeeCents, 0);
});

test("vehicle pricing rules API: PATCH requires CSRF", async () => {
  const response = await handleAdminVehiclePricingRulesPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/pricing-rules`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseDailyRateCents: 17000 }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => false,
      vehicleExists: async () => true,
      getProfile: async () => defaultProfile(),
      deleteRules: async () => {},
      saveRules: async () => defaultProfile().rules,
    },
  );

  assert.equal(response.status, 403);
});

test("vehicle pricing rules API: PATCH validates date ranges", async () => {
  const response = await handleAdminVehiclePricingRulesPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/pricing-rules`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        dateRangeOverrides: [
          {
            start: "2026-12-10",
            end: "2026-12-01",
            dailyRateCents: 24000,
          },
        ],
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      vehicleExists: async () => true,
      getProfile: async () => defaultProfile(),
      deleteRules: async () => {},
      saveRules: async () => defaultProfile().rules,
    },
  );

  assert.equal(response.status, 400);
});

test("vehicle pricing rules API: PATCH persists normalized values", async () => {
  let capturedPatch: Record<string, unknown> | null = null;

  const response = await handleAdminVehiclePricingRulesPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/pricing-rules`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        baseDailyRateCents: "17000",
        baseDepositCents: "280000",
        weekendDailyRateCents: "19500",
        dateRangeOverrides: [
          {
            start: "2026-12-01",
            end: "2026-12-20",
            dailyRateCents: "22500",
            depositCents: "300000",
          },
        ],
        deliveryEnabled: true,
        deliveryFeeCents: "5000",
        deliveryZones: [
          { label: "Montego Bay", feeCents: "6500" },
          { label: "Ocho Rios", feeCents: "7000" },
        ],
        currency: "jmd",
        isActive: true,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      vehicleExists: async () => true,
      getProfile: async () => defaultProfile(),
      deleteRules: async () => {},
      saveRules: async (_vehicleId, patch) => {
        capturedPatch = patch as unknown as Record<string, unknown>;
        return {
          id: "22222222-2222-4222-8222-222222222222",
          vehicleId: VEHICLE_ID,
          ...patch,
          createdAt: "2026-02-26T00:00:00.000Z",
          updatedAt: "2026-02-26T00:00:00.000Z",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.ok(capturedPatch);
  const patch = capturedPatch as Record<string, unknown>;
  assert.equal(patch.baseDailyRateCents, null);
  assert.equal(patch.baseDepositCents, null);
  assert.equal(patch.weekendDailyRateCents, 19500);
  assert.equal(patch.deliveryEnabled, true);
  assert.equal(patch.deliveryFeeCents, 5000);
  assert.equal(patch.currency, "JMD");

  const body = (await response.json()) as {
    ok: boolean;
    defaultsApplied: boolean;
    rules: {
      baseDailyRateCents: number | null;
      baseDepositCents: number | null;
      weekendDailyRateCents: number | null;
      deliveryEnabled: boolean;
      deliveryFeeCents: number;
      currency: string;
      dateRangeOverrides: Array<{ start: string; end: string; dailyRateCents: number }>;
      deliveryZones: Array<{ label: string; feeCents: number }>;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.defaultsApplied, false);
  assert.equal(body.rules.baseDailyRateCents, null);
  assert.equal(body.rules.baseDepositCents, null);
  assert.equal(body.rules.weekendDailyRateCents, 19500);
  assert.equal(body.rules.deliveryEnabled, true);
  assert.equal(body.rules.deliveryFeeCents, 5000);
  assert.equal(body.rules.currency, "JMD");
  assert.equal(body.rules.dateRangeOverrides.length, 1);
  assert.equal(body.rules.deliveryZones.length, 2);
});

test("vehicle pricing rules API: DELETE restores defaults", async () => {
  let deletedVehicleId: string | null = null;

  const response = await handleAdminVehiclePricingRulesDelete(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/pricing-rules`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      vehicleExists: async () => true,
      getProfile: async () => defaultProfile(),
      deleteRules: async (vehicleId) => {
        deletedVehicleId = vehicleId;
      },
      saveRules: async () => defaultProfile().rules,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(deletedVehicleId, VEHICLE_ID);

  const body = (await response.json()) as {
    ok: boolean;
    defaultsApplied: boolean;
    rules: { weekendDailyRateCents: number | null; deliveryEnabled: boolean; deliveryFeeCents: number };
  };

  assert.equal(body.ok, true);
  assert.equal(body.defaultsApplied, true);
  assert.equal(body.rules.weekendDailyRateCents, null);
  assert.equal(body.rules.deliveryEnabled, false);
  assert.equal(body.rules.deliveryFeeCents, 0);
});
