import assert from "node:assert/strict";
import test from "node:test";

import { getStartOfToday, getStartOfTomorrow, isPickupToday, isUpcomingBooking } from "@/lib/bookings/upcoming";

const NOW = new Date("2026-02-22T15:30:00.000Z");

test("upcoming booking: starts tomorrow is upcoming", () => {
  const startTomorrow = new Date(getStartOfToday(NOW).getTime() + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isUpcomingBooking({ status: "CONFIRMED", start_at: startTomorrow }, NOW), true);
});

test("upcoming booking: starts today is upcoming", () => {
  const startToday = new Date(getStartOfToday(NOW).getTime() + 3 * 60 * 60 * 1000).toISOString();
  assert.equal(isUpcomingBooking({ status: "PENDING_PAYMENT", start_at: startToday }, NOW), true);
});

test("upcoming booking: started yesterday is not upcoming", () => {
  const startedYesterday = new Date(getStartOfToday(NOW).getTime() - 1).toISOString();
  assert.equal(isUpcomingBooking({ status: "CONFIRMED", start_at: startedYesterday }, NOW), false);
});

test("upcoming booking: cancelled future booking is not upcoming", () => {
  const futureStart = new Date(getStartOfToday(NOW).getTime() + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isUpcomingBooking({ status: "CANCELLED", start_at: futureStart }, NOW), false);
});

test("upcoming booking: archived future booking is not upcoming", () => {
  const futureStart = new Date(getStartOfToday(NOW).getTime() + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isUpcomingBooking({ status: "ARCHIVED", start_at: futureStart }, NOW), false);
});

test("pickup today predicate uses start-of-day boundaries", () => {
  const startOfToday = getStartOfToday(NOW);
  const startOfTomorrow = getStartOfTomorrow(NOW);

  assert.equal(
    isPickupToday(
      { status: "CONFIRMED", start_at: new Date(startOfToday.getTime() + 60 * 1000).toISOString() },
      NOW,
    ),
    true,
  );
  assert.equal(
    isPickupToday({ status: "CONFIRMED", start_at: new Date(startOfToday.getTime() - 1).toISOString() }, NOW),
    false,
  );
  assert.equal(
    isPickupToday({ status: "CONFIRMED", start_at: startOfTomorrow.toISOString() }, NOW),
    false,
  );
});

test("regression: pickup-today booking is included in upcoming scope", () => {
  const startToday = new Date(getStartOfToday(NOW).getTime() + 2 * 60 * 60 * 1000).toISOString();
  const booking = { status: "CONFIRMED", start_at: startToday };

  assert.equal(isPickupToday(booking, NOW), true);
  assert.equal(isUpcomingBooking(booking, NOW), true);
});
