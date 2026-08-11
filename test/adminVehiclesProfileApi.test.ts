import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminVehicleProfileGet,
  handleAdminVehicleProfilePatch,
} from "@/app/api/admin/vehicles/[id]/profile/implementation";

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
        seat_count: "5",
        current_location_label: "Airport Lot",
        odometer_value: "50123",
        odometer_unit: "KM",
        fuel_level_value: "68",
        available_from: "2026-03-01",
        available_until: "2026-03-15",
        entry_date: "2026-02-20",
        exit_date: "2026-04-20",
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
          seat_count: payload.seat_count,
          current_location_label: payload.current_location_label,
          odometer_value: payload.odometer_value,
          odometer_unit: payload.odometer_unit,
          fuel_level_value: payload.fuel_level_value,
          available_from: payload.available_from,
          available_until: payload.available_until,
          entry_date: payload.entry_date,
          exit_date: payload.exit_date,
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
    seat_count?: unknown;
    odometer_value?: unknown;
    fuel_level_value?: unknown;
  };
  assert.equal(saved.vin, "VIN-ABC-123");
  assert.equal(saved.license_plate, "1234AB");
  assert.equal(saved.current_location_label, "Airport Lot");
  assert.equal(saved.seat_count, 5);
  assert.equal(saved.odometer_value, 50123);
  assert.equal(saved.fuel_level_value, 68);
});

test("admin vehicle profile API: overview persistence save then load", async () => {
  let storedProfile: {
    vehicle_id: string;
    vin: string | null;
    license_plate: string | null;
    vehicle_type: string | null;
    vehicle_class: string | null;
    year: number | null;
    color: string | null;
    seat_count: number | null;
    current_location_label: string | null;
    odometer_value: number | null;
    odometer_unit: string | null;
    fuel_level_value: number | null;
    available_from: string | null;
    available_until: string | null;
    entry_date: string | null;
    exit_date: string | null;
    created_at: string;
    updated_at: string;
  } | null = null;
  const vehicleId = "11111111-1111-4111-8111-111111111111";

  const patchResponse = await handleAdminVehicleProfilePatch(
    new Request(`http://localhost/api/admin/vehicles/${vehicleId}/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        vin: "1HGCM82633A004352",
        license_plate: "1234AB",
        vehicle_type: "SEDAN",
        vehicle_class: "STANDARD",
        year: 2020,
        color: "Black",
        seat_count: 7,
        current_location_label: "Airport lot",
        odometer_value: 50222,
        odometer_unit: "KM",
        fuel_level_value: 67,
        available_from: "2026-03-01",
        available_until: "2026-03-20",
        entry_date: "2026-02-10",
        exit_date: "2026-04-01",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: vehicleId }) },
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      requireCsrfCheck: async () => true,
      getProfile: async () => storedProfile,
      upsertProfile: async (id, payload) => {
        storedProfile = {
          vehicle_id: id,
          vin: payload.vin,
          license_plate: payload.license_plate,
          vehicle_type: payload.vehicle_type,
          vehicle_class: payload.vehicle_class,
          year: payload.year,
          color: payload.color,
          seat_count: payload.seat_count,
          current_location_label: payload.current_location_label,
          odometer_value: payload.odometer_value,
          odometer_unit: payload.odometer_unit,
          fuel_level_value: payload.fuel_level_value,
          available_from: payload.available_from,
          available_until: payload.available_until,
          entry_date: payload.entry_date,
          exit_date: payload.exit_date,
          created_at: "2026-02-20T12:00:00.000Z",
          updated_at: "2026-02-20T12:00:00.000Z",
        };
        return storedProfile;
      },
    },
  );

  assert.equal(patchResponse.status, 200);

  const getResponse = await handleAdminVehicleProfileGet(
    new Request(`http://localhost/api/admin/vehicles/${vehicleId}/profile`),
    { params: Promise.resolve({ id: vehicleId }) },
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      requireCsrfCheck: async () => true,
      getProfile: async () => storedProfile,
      upsertProfile: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(getResponse.status, 200);
  const payload = (await getResponse.json()) as {
    ok?: boolean;
    profile?: {
      vin?: string | null;
      license_plate?: string | null;
      current_location_label?: string | null;
      seat_count?: number | null;
    };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.profile?.vin, "1HGCM82633A004352");
  assert.equal(payload.profile?.license_plate, "1234AB");
  assert.equal(payload.profile?.current_location_label, "Airport lot");
  assert.equal(payload.profile?.seat_count, 7);
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

test("admin vehicle profile API: PATCH rejects invalid seat count values", async () => {
  const inputs = [0, -1, 2.5];

  for (const seatValue of inputs) {
    const response = await handleAdminVehicleProfilePatch(
      new Request("http://localhost/api/admin/vehicles/11111111-1111-4111-8111-111111111111/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": "token",
        },
        body: JSON.stringify({ seat_count: seatValue, csrfToken: "token" }),
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
  }
});

test("admin vehicle profile API: PATCH accepts null seat count", async () => {
  let capturedPayload: Record<string, unknown> | null = null;

  const response = await handleAdminVehicleProfilePatch(
    new Request("http://localhost/api/admin/vehicles/11111111-1111-4111-8111-111111111111/profile", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ seat_count: "", csrfToken: "token" }),
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
          seat_count: payload.seat_count,
          current_location_label: payload.current_location_label,
          odometer_value: payload.odometer_value,
          odometer_unit: payload.odometer_unit,
          fuel_level_value: payload.fuel_level_value,
          available_from: payload.available_from,
          available_until: payload.available_until,
          entry_date: payload.entry_date,
          exit_date: payload.exit_date,
          created_at: "2026-02-20T12:00:00.000Z",
          updated_at: "2026-02-20T12:00:00.000Z",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  if (!capturedPayload) {
    assert.fail("Expected payload to be captured");
  }
  const payload = capturedPayload as Record<string, unknown>;
  assert.ok(Object.prototype.hasOwnProperty.call(payload, "seat_count"));
  assert.equal(payload.seat_count, null);
});
