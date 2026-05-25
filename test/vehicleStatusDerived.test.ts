import assert from "node:assert/strict";
import test from "node:test";

import { deriveBookingPhase, deriveVehicleStatus, getStartOfToday } from "@/lib/vehicles/vehicleStatus";

const NOW = new Date("2026-02-23T15:30:00.000Z");

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

test("derive booking phase: overdue unpicked booking is PICKUP_OVERDUE", () => {
  const booking = {
    status: "CONFIRMED",
    start_at: addHours(NOW, -5),
    end_at: addHours(NOW, 10),
  };

  assert.equal(deriveBookingPhase(booking, NOW), "PICKUP_OVERDUE");
});

test("derive booking phase: future booking is UPCOMING", () => {
  const booking = {
    status: "CONFIRMED",
    start_at: addHours(getStartOfToday(NOW), 24),
    end_at: addHours(getStartOfToday(NOW), 48),
  };

  assert.equal(deriveBookingPhase(booking, NOW), "UPCOMING");
});

test("derive vehicle status: active picked-up booking takes precedence", () => {
  const status = deriveVehicleStatus(
    { status: "AVAILABLE" },
    NOW,
    {
      needsCleaning: true,
      bookings: [
        {
          status: "PICKED_UP",
          start_at: addHours(NOW, -2),
          end_at: addHours(NOW, 6),
        },
      ],
    },
  );

  assert.equal(status, "ON_RENT");
});

test("derive vehicle status: DIRTY from profile flag", () => {
  const status = deriveVehicleStatus(
    { status: "AVAILABLE" },
    NOW,
    {
      needsCleaning: true,
      bookings: [],
      blockouts: [],
    },
  );

  assert.equal(status, "DIRTY");
});

test("derive vehicle status: UPCOMING when next booking exists", () => {
  const startOfToday = getStartOfToday(NOW);
  const status = deriveVehicleStatus(
    { status: "AVAILABLE" },
    NOW,
    {
      bookings: [
        {
          status: "PENDING_PAYMENT",
          start_at: addHours(startOfToday, 20),
          end_at: addHours(startOfToday, 44),
        },
      ],
    },
  );

  assert.equal(status, "UPCOMING");
});

test("derive vehicle status: AVAILABLE when no current blockers", () => {
  const status = deriveVehicleStatus(
    { status: "AVAILABLE" },
    NOW,
    {
      bookings: [
        {
          status: "CANCELLED",
          start_at: addHours(NOW, -2),
          end_at: addHours(NOW, 2),
        },
      ],
      blockouts: [],
    },
  );

  assert.equal(status, "AVAILABLE");
});
