import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminVehicleFinanceGet,
  handleAdminVehicleFinancePatch,
} from "@/app/api/admin/vehicles/[id]/finance/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

function adminSession() {
  return {
    userId: "99999999-9999-4999-8999-999999999999",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

test("vehicle finance API: GET requires auth", async () => {
  const response = await handleAdminVehicleFinanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/finance`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      getDefaults: async () => ({
        depreciationMethod: "STRAIGHT_LINE",
        usefulLifeMonths: 60,
        residualPercent: 20,
      }),
      getFinance: async () => null,
      upsertFinance: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 401);
});

test("vehicle finance API: PATCH requires CSRF", async () => {
  const response = await handleAdminVehicleFinancePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/finance`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseCostCents: 100_000, depreciationMethod: "STRAIGHT_LINE" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => false,
      getDefaults: async () => ({
        depreciationMethod: "STRAIGHT_LINE",
        usefulLifeMonths: 60,
        residualPercent: 20,
      }),
      getFinance: async () => null,
      upsertFinance: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 403);
});

test("vehicle finance API: GET returns profile fields including active flag", async () => {
  const response = await handleAdminVehicleFinanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/finance`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getDefaults: async () => ({
        depreciationMethod: "STRAIGHT_LINE",
        usefulLifeMonths: 60,
        residualPercent: 20,
      }),
      getFinance: async () => ({
        vehicle_id: VEHICLE_ID,
        purchase_date: "2026-01-10",
        purchase_cost_cents: 120000000,
        residual_value_cents: 20000000,
        odometer_at_purchase: 42000,
        useful_life_months: 60,
        depreciation_method: "STRAIGHT_LINE",
        is_active: true,
        notes: null,
        created_at: "2026-02-23T10:00:00.000Z",
        updated_at: "2026-02-23T10:00:00.000Z",
      }),
      upsertFinance: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    finance: { odometerAtPurchase: number | null; isActive: boolean };
  };
  assert.equal(body.ok, true);
  assert.equal(body.finance.odometerAtPurchase, 42000);
  assert.equal(body.finance.isActive, true);
});

test("vehicle finance API: PATCH stores normalized values", async () => {
  let capturedPayload: Record<string, unknown> | null = null;

  const response = await handleAdminVehicleFinancePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/finance`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        purchaseDate: "2026-01-10",
        purchaseCostCents: "120000000",
        residualValueCents: "20000000",
        odometerAtPurchase: "42000",
        usefulLifeMonths: "60",
        depreciationMethod: "STRAIGHT_LINE",
        isActive: true,
        notes: "Primary fleet purchase",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getDefaults: async () => ({
        depreciationMethod: "STRAIGHT_LINE",
        usefulLifeMonths: 60,
        residualPercent: 20,
      }),
      getFinance: async () => null,
      upsertFinance: async (_vehicleId, payload) => {
        capturedPayload = payload as unknown as Record<string, unknown>;
        return {
          vehicle_id: VEHICLE_ID,
          purchase_date: payload.purchaseDate,
          purchase_cost_cents: payload.purchaseCostCents,
          residual_value_cents: payload.residualValueCents,
          odometer_at_purchase: payload.odometerAtPurchase,
          useful_life_months: payload.usefulLifeMonths,
          depreciation_method: payload.depreciationMethod,
          is_active: payload.isActive,
          notes: payload.notes,
          created_at: "2026-02-23T10:00:00.000Z",
          updated_at: "2026-02-23T10:00:00.000Z",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.ok(capturedPayload);
  const saved = capturedPayload as {
    purchaseDate?: unknown;
    purchaseCostCents?: unknown;
    residualValueCents?: unknown;
    odometerAtPurchase?: unknown;
    usefulLifeMonths?: unknown;
    depreciationMethod?: unknown;
    isActive?: unknown;
  };
  assert.equal(saved.purchaseDate, "2026-01-10");
  assert.equal(saved.purchaseCostCents, 120000000);
  assert.equal(saved.residualValueCents, 20000000);
  assert.equal(saved.odometerAtPurchase, 42000);
  assert.equal(saved.usefulLifeMonths, 60);
  assert.equal(saved.depreciationMethod, "STRAIGHT_LINE");
  assert.equal(saved.isActive, true);

  const body = (await response.json()) as {
    ok: boolean;
    incompleteReason: string | null;
    metrics: {
      monthlyDepreciationCents: number;
      monthsElapsed: number;
      monthsRemaining: number;
    } | null;
  };
  assert.equal(body.ok, true);
  assert.equal(body.incompleteReason, null);
  assert.equal(body.metrics?.monthlyDepreciationCents, 1666666);
  assert.equal(typeof body.metrics?.monthsElapsed, "number");
  assert.equal(typeof body.metrics?.monthsRemaining, "number");
});

test("vehicle finance API: PATCH rejects residual above purchase", async () => {
  const response = await handleAdminVehicleFinancePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/finance`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        purchaseCostCents: 100_000,
        residualValueCents: 200_000,
        depreciationMethod: "STRAIGHT_LINE",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getDefaults: async () => ({
        depreciationMethod: "STRAIGHT_LINE",
        usefulLifeMonths: 60,
        residualPercent: 20,
      }),
      getFinance: async () => null,
      upsertFinance: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 400);
});

test("vehicle finance API: PATCH rejects non-positive useful life months", async () => {
  const response = await handleAdminVehicleFinancePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/finance`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        purchaseCostCents: 100_000,
        residualValueCents: 50_000,
        usefulLifeMonths: 0,
        depreciationMethod: "STRAIGHT_LINE",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getDefaults: async () => ({
        depreciationMethod: "STRAIGHT_LINE",
        usefulLifeMonths: 60,
        residualPercent: 20,
      }),
      getFinance: async () => null,
      upsertFinance: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 400);
});

test("vehicle finance API: PATCH supports inactive profile state", async () => {
  const response = await handleAdminVehicleFinancePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/finance`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        purchaseDate: "2026-01-10",
        purchaseCostCents: "120000000",
        residualValueCents: "20000000",
        usefulLifeMonths: "60",
        depreciationMethod: "STRAIGHT_LINE",
        isActive: false,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getDefaults: async () => ({
        depreciationMethod: "STRAIGHT_LINE",
        usefulLifeMonths: 60,
        residualPercent: 20,
      }),
      getFinance: async () => null,
      upsertFinance: async (_vehicleId, payload) => ({
        vehicle_id: VEHICLE_ID,
        purchase_date: payload.purchaseDate,
        purchase_cost_cents: payload.purchaseCostCents,
        residual_value_cents: payload.residualValueCents,
        odometer_at_purchase: payload.odometerAtPurchase,
        useful_life_months: payload.usefulLifeMonths,
        depreciation_method: payload.depreciationMethod,
        is_active: payload.isActive,
        notes: payload.notes,
        created_at: "2026-02-23T10:00:00.000Z",
        updated_at: "2026-02-23T10:00:00.000Z",
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    incompleteReason: string | null;
    metrics: unknown;
  };
  assert.equal(body.ok, true);
  assert.equal(body.metrics, null);
  assert.equal(body.incompleteReason, "Depreciation profile is inactive.");
});
