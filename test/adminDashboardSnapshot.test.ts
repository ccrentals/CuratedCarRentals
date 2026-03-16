import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeActiveFleetSnapshot,
  type ActiveFleetVehicleSnapshot,
} from "@/lib/vehicles/adminFleetSnapshot";

function makeVehicle(
  input: Partial<ActiveFleetVehicleSnapshot> & {
    id: string;
    created_at: string;
    derived_status: ActiveFleetVehicleSnapshot["derived_status"];
  },
): ActiveFleetVehicleSnapshot {
  return {
    id: input.id,
    public_id: input.public_id ?? `VE-${input.id}`,
    make: input.make ?? "Toyota",
    model: input.model ?? "Yaris",
    year: input.year ?? 2020,
    daily_rate_cents: input.daily_rate_cents ?? 5800,
    deposit_cents: input.deposit_cents ?? 1740,
    status: input.status ?? "AVAILABLE",
    needs_cleaning: input.needs_cleaning ?? false,
    created_at: input.created_at,
    updated_at: input.updated_at ?? input.created_at,
    deleted_at: input.deleted_at ?? null,
    derived_status: input.derived_status,
  };
}

test("dashboard fleet summary excludes deleted vehicles and counts derived availability", () => {
  const summary = summarizeActiveFleetSnapshot([
    makeVehicle({
      id: "available-1",
      created_at: "2026-03-10T10:00:00.000Z",
      derived_status: "AVAILABLE",
      status: "AVAILABLE",
    }),
    makeVehicle({
      id: "on-rent-1",
      created_at: "2026-03-11T10:00:00.000Z",
      derived_status: "ON_RENT",
      status: "AVAILABLE",
    }),
    makeVehicle({
      id: "dirty-1",
      created_at: "2026-03-12T10:00:00.000Z",
      derived_status: "DIRTY",
      status: "MAINTENANCE",
    }),
    makeVehicle({
      id: "deleted-available",
      created_at: "2026-03-13T10:00:00.000Z",
      derived_status: "AVAILABLE",
      status: "AVAILABLE",
      deleted_at: "2026-03-14T10:00:00.000Z",
    }),
  ]);

  assert.equal(summary.totalVehicles, 3);
  assert.equal(summary.availableVehicles, 1);
  assert.equal(summary.maintenanceVehicles, 1);
});

test("dashboard fleet summary recent vehicles stay active-only and newest-first", () => {
  const summary = summarizeActiveFleetSnapshot(
    [
      makeVehicle({
        id: "older-active",
        created_at: "2026-03-10T10:00:00.000Z",
        derived_status: "AVAILABLE",
      }),
      makeVehicle({
        id: "deleted-newer",
        created_at: "2026-03-14T10:00:00.000Z",
        derived_status: "AVAILABLE",
        deleted_at: "2026-03-15T10:00:00.000Z",
      }),
      makeVehicle({
        id: "newest-active",
        created_at: "2026-03-13T10:00:00.000Z",
        derived_status: "UPCOMING",
      }),
    ],
    5,
  );

  assert.deepEqual(
    summary.recentVehicles.map((vehicle) => vehicle.id),
    ["newest-active", "older-active"],
  );
});
