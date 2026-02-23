import assert from "node:assert/strict";
import test from "node:test";

import { deriveBookingPhase } from "@/lib/vehicles/vehicleStatus";

const NOW = new Date("2026-02-23T15:30:00.000Z");

test("calendar label phase: future booking is UPCOMING", () => {
  const phase = deriveBookingPhase(
    {
      status: "CONFIRMED",
      start_date: "2026-02-24",
      end_date: "2026-02-26",
    },
    NOW,
  );

  assert.equal(phase, "UPCOMING");
});

test("calendar label phase: active booking is ON_RENT", () => {
  const phase = deriveBookingPhase(
    {
      status: "ACTIVE",
      start_at: "2026-02-23T08:00:00.000Z",
      end_at: "2026-02-24T08:00:00.000Z",
      start_date: "2026-02-23",
      end_date: "2026-02-24",
    },
    NOW,
  );

  assert.equal(phase, "ON_RENT");
});

test("calendar label phase: cancelled booking is CANCELLED", () => {
  const phase = deriveBookingPhase(
    {
      status: "CANCELLED",
      start_date: "2026-02-24",
      end_date: "2026-02-24",
    },
    NOW,
  );

  assert.equal(phase, "CANCELLED");
});
