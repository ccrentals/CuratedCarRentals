import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_HIDDEN_BOOKING_STATUSES,
  shouldExcludeCancelledFromDefaultBookingsScope,
} from "@/lib/bookings/adminBookingsList";

test("admin bookings visibility: default all scope excludes cancelled bookings", () => {
  assert.equal(shouldExcludeCancelledFromDefaultBookingsScope(undefined), true);
  assert.equal(shouldExcludeCancelledFromDefaultBookingsScope(null), true);
  assert.equal(shouldExcludeCancelledFromDefaultBookingsScope(""), true);
  assert.equal(shouldExcludeCancelledFromDefaultBookingsScope("all"), true);
  assert.deepEqual([...DEFAULT_HIDDEN_BOOKING_STATUSES], ["CANCELLED"]);
});

test("admin bookings visibility: explicit cancelled filters remain opt-in", () => {
  assert.equal(shouldExcludeCancelledFromDefaultBookingsScope("cancelled"), false);
  assert.equal(shouldExcludeCancelledFromDefaultBookingsScope("confirmed"), false);
  assert.equal(shouldExcludeCancelledFromDefaultBookingsScope("pending_payment"), false);
  assert.equal(shouldExcludeCancelledFromDefaultBookingsScope("lost_to_first_deposit"), false);
});
