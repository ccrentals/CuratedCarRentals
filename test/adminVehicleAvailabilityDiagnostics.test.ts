import assert from "node:assert/strict";
import test from "node:test";

import { handleAvailabilityDiagnosticsGet } from "@/app/api/admin/vehicles/availability-diagnostics/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

test("vehicle availability diagnostics requires operations access", async () => {
  const response = await handleAvailabilityDiagnosticsGet(
    new Request("http://localhost/api/admin/vehicles/availability-diagnostics"),
    {
      authorize: async () => new Response("Unauthorized", { status: 401 }),
      loadVehicles: async () => [],
      evaluate: async () => [],
    },
  );
  assert.equal(response.status, 401);
});

test("vehicle availability diagnostics validates the rental window", async () => {
  const response = await handleAvailabilityDiagnosticsGet(
    new Request(
      "http://localhost/api/admin/vehicles/availability-diagnostics?pickupDate=2026-06-13&pickupTime=15:00&dropoffDate=2026-06-13&dropoffTime=14:00",
    ),
    {
      authorize: async () => null,
      loadVehicles: async () => [],
      evaluate: async () => [],
    },
  );
  assert.equal(response.status, 400);
});

test("vehicle availability diagnostics returns structured conflict links", async () => {
  const response = await handleAvailabilityDiagnosticsGet(
    new Request(
      "http://localhost/api/admin/vehicles/availability-diagnostics?pickupDate=2026-06-13&pickupTime=15:00&dropoffDate=2026-06-15&dropoffTime=15:00",
    ),
    {
      authorize: async () => null,
      loadVehicles: async () => [{
        id: VEHICLE_ID,
        publicId: "VE000001",
        make: "Subaru",
        model: "Impreza",
        publicVisible: true,
        dailyRateCents: 700000,
      }],
      evaluate: async (vehicles) => [{
        vehicle: vehicles[0],
        available: false,
        publicEligible: true,
        reasonCode: "BOOKING_CONFLICT",
        reason: "Overlaps booking BK000025.",
        conflict: {
          type: "BOOKING",
          id: "22222222-2222-4222-8222-222222222222",
          publicId: "BK000025",
          status: "PICKED_UP",
          startAt: "2026-06-12T17:00:00.000Z",
          endAt: "2026-06-19T17:00:00.000Z",
        },
        normalized: {
          startAt: "2026-06-13T20:00:00.000Z",
          endAt: "2026-06-15T20:00:00.000Z",
          effectiveStartAt: "2026-06-13T20:00:00.000Z",
          effectiveEndAt: "2026-06-15T20:00:00.000Z",
        },
      }],
    },
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    rows: Array<{ reasonCode: string; conflictLink: string }>;
  };
  assert.equal(payload.rows[0]?.reasonCode, "BOOKING_CONFLICT");
  assert.equal(
    payload.rows[0]?.conflictLink,
    "/admin/bookings/22222222-2222-4222-8222-222222222222",
  );
});
