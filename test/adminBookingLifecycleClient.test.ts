import assert from "node:assert/strict";
import test from "node:test";

import { getAdminBookingLifecycleEligibility } from "@/lib/bookings/adminBookingLifecycleClient";

test("booking lifecycle eligibility requires completed pickup inspection and full payment", () => {
  assert.deepEqual(
    getAdminBookingLifecycleEligibility({
      bookingStatus: "CONFIRMED",
      isPaidInFull: true,
      isPickupInspectionComplete: true,
      isReturnInspectionComplete: false,
    }),
    {
      normalizedStatus: "CONFIRMED",
      canPickup: true,
      canComplete: false,
      pickupDisabledReason: null,
      completeDisabledReason: "Confirm pickup before completing the booking.",
    },
  );

  const unpaid = getAdminBookingLifecycleEligibility({
    bookingStatus: "CONFIRMED",
    isPaidInFull: false,
    isPickupInspectionComplete: true,
  });
  assert.equal(unpaid.canPickup, false);
  assert.equal(unpaid.pickupDisabledReason, "Booking must be fully paid before pickup.");
});

test("booking lifecycle eligibility requires picked-up status and completed return inspection", () => {
  const incomplete = getAdminBookingLifecycleEligibility({
    bookingStatus: "PICKED_UP",
    isPaidInFull: true,
    isPickupInspectionComplete: true,
    isReturnInspectionComplete: false,
  });
  assert.equal(incomplete.canComplete, false);
  assert.equal(
    incomplete.completeDisabledReason,
    "Complete the return inspection before completing the booking.",
  );

  const complete = getAdminBookingLifecycleEligibility({
    bookingStatus: "PICKED_UP",
    isPaidInFull: true,
    isPickupInspectionComplete: true,
    isReturnInspectionComplete: true,
  });
  assert.equal(complete.canComplete, true);
  assert.equal(complete.completeDisabledReason, null);
});
