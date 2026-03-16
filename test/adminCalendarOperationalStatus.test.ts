import assert from "node:assert/strict";
import test from "node:test";

import {
  CALENDAR_BOOKING_STATUS_OPTIONS,
  buildCalendarBookingStatusClauses,
  sanitizeCalendarVehicleId,
} from "@/lib/bookings/adminCalendar";

test("admin calendar status helper: always excludes cancelled and overridden bookings", () => {
  const result = buildCalendarBookingStatusClauses({
    statusParam: "confirmed",
    paramStartIndex: 3,
    bookingAlias: "b",
  });

  assert.deepEqual(result.clauses, [
    "b.status not in ('CANCELLED', 'OVERRIDDEN')",
    "b.status = $3",
  ]);
  assert.deepEqual(result.values, ["CONFIRMED"]);
  assert.equal(result.nextParamIndex, 4);
  assert.equal(result.selectedStatus, "confirmed");
});

test("admin calendar status helper: ignores stale cancelled and overridden status params", () => {
  for (const statusParam of ["cancelled", "CANCELLED", "overridden"]) {
    const result = buildCalendarBookingStatusClauses({
      statusParam,
      paramStartIndex: 5,
      bookingAlias: "b",
    });

    assert.deepEqual(result.clauses, ["b.status not in ('CANCELLED', 'OVERRIDDEN')"]);
    assert.deepEqual(result.values, []);
    assert.equal(result.nextParamIndex, 5);
    assert.equal(result.selectedStatus, "all");
  }
});

test("admin calendar status options: cancelled is no longer exposed in the UI contract", () => {
  assert.deepEqual(
    CALENDAR_BOOKING_STATUS_OPTIONS.map((option) => option.value),
    ["all", "pending_payment", "confirmed", "returned"],
  );
  assert.equal(
    CALENDAR_BOOKING_STATUS_OPTIONS.some((option) => option.value === "cancelled"),
    false,
  );
});

test("admin calendar vehicle helper: drops stale vehicle ids that are no longer in the active options", () => {
  const vehicles = [
    { id: "vehicle-active-1", make: "Toyota", model: "Yaris" },
    { id: "vehicle-active-2", make: "Honda", model: "Fit" },
  ];

  assert.equal(sanitizeCalendarVehicleId("vehicle-active-2", vehicles), "vehicle-active-2");
  assert.equal(sanitizeCalendarVehicleId("vehicle-deleted-old", vehicles), undefined);
  assert.equal(sanitizeCalendarVehicleId(undefined, vehicles), undefined);
});
