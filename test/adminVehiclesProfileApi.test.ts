import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminVehicleProfileGet,
  handleAdminVehicleProfilePatch,
} from "@/app/api/admin/vehicles/[id]/profile/route";

test("admin vehicle profile API: GET requires auth", async () => {
  const response = await handleAdminVehicleProfileGet(
    new Request("http://localhost/api/admin/vehicles/11111111-1111-4111-8111-111111111111/profile"),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      getProfile: async () => null,
      upsertProfile: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 401);
});

test("admin vehicle profile API: PATCH requires CSRF", async () => {
  const response = await handleAdminVehicleProfilePatch(
    new Request("http://localhost/api/admin/vehicles/11111111-1111-4111-8111-111111111111/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vin: "VIN123" }),
    }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      requireCsrfCheck: async () => false,
      getProfile: async () => null,
      upsertProfile: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 403);
});

test("admin vehicle profile API: PATCH upserts normalized payload", async () => {
  let capturedPayload: Record<string, unknown> | null = null;

  const response = await handleAdminVehicleProfilePatch(
    new Request("http://localhost/api/admin/vehicles/11111111-1111-4111-8111-111111111111/profile", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        vin: "  VIN-ABC-123  ",
        license_plate: " 1234AB ",
        vehicle_type: "SUV",
        vehicle_class: "Premium",
        year: "2024",
        color: "Blue",
        current_location_label: "Airport Lot",
        odometer_value: "50123",
        odometer_unit: "KM",
        fuel_level_value: "68",
        available_from: "2026-03-01",
        available_until: "2026-03-15",
        entry_date: "2026-02-20",
        exit_date: "2026-04-20",
        notes: "Recent service completed",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      requireCsrfCheck: async () => true,
      getProfile: async () => null,
      upsertProfile: async (_vehicleId, payload) => {
        capturedPayload = payload as unknown as Record<string, unknown>;
        return {
          vehicle_id: "11111111-1111-4111-8111-111111111111",
          vin: payload.vin,
          license_plate: payload.license_plate,
          vehicle_type: payload.vehicle_type,
          vehicle_class: payload.vehicle_class,
          year: payload.year,
          color: payload.color,
          current_location_label: payload.current_location_label,
          odometer_value: payload.odometer_value,
          odometer_unit: payload.odometer_unit,
          fuel_level_value: payload.fuel_level_value,
          available_from: payload.available_from,
          available_until: payload.available_until,
          entry_date: payload.entry_date,
          exit_date: payload.exit_date,
          notes: payload.notes,
          created_at: "2026-02-20T12:00:00.000Z",
          updated_at: "2026-02-20T12:00:00.000Z",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.ok(capturedPayload);
  const saved = capturedPayload as {
    vin?: unknown;
    license_plate?: unknown;
    current_location_label?: unknown;
    odometer_value?: unknown;
    fuel_level_value?: unknown;
  };
  assert.equal(saved.vin, "VIN-ABC-123");
  assert.equal(saved.license_plate, "1234AB");
  assert.equal(saved.current_location_label, "Airport Lot");
  assert.equal(saved.odometer_value, 50123);
  assert.equal(saved.fuel_level_value, 68);
});

test("admin vehicle profile API: PATCH rejects invalid fuel level", async () => {
  const response = await handleAdminVehicleProfilePatch(
    new Request("http://localhost/api/admin/vehicles/11111111-1111-4111-8111-111111111111/profile", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ fuel_level_value: 120, csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      requireCsrfCheck: async () => true,
      getProfile: async () => null,
      upsertProfile: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 400);
});
