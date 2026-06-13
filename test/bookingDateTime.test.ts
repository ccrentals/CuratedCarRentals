import assert from "node:assert/strict";
import test from "node:test";

import {
  addBookingCalendarDays,
  bookingDateTimeToUtcIso,
  buildBookingDateTimeLabel,
  formatBookingDateOnly,
  toBookingDateOnly,
} from "@/lib/bookings/bookingDateTime";

test("booking dates preserve date-only strings without timezone conversion", () => {
  assert.equal(toBookingDateOnly("2026-07-06"), "2026-07-06");
  assert.equal(formatBookingDateOnly("2026-07-06"), "7/6/2026");
});

test("booking dates preserve PostgreSQL DATE objects in the process timezone", () => {
  const databaseDate = new Date(2026, 6, 6);
  assert.equal(toBookingDateOnly(databaseDate), "2026-07-06");
  assert.equal(formatBookingDateOnly(databaseDate), "7/6/2026");
});

test("booking calendar arithmetic does not depend on the process timezone", () => {
  assert.equal(addBookingCalendarDays("2026-07-15", 1), "2026-07-16");
  assert.equal(addBookingCalendarDays("2026-12-31", 1), "2027-01-01");
});

test("Jamaica wall-clock booking times convert to stable UTC instants", () => {
  assert.equal(
    bookingDateTimeToUtcIso("2026-07-06", "10:30"),
    "2026-07-06T15:30:00.000Z",
  );
  assert.equal(
    bookingDateTimeToUtcIso("2026-07-15", "07:30"),
    "2026-07-15T12:30:00.000Z",
  );
});

test("booking date-time labels prefer the stored instant and fall back to date plus time", () => {
  assert.equal(
    buildBookingDateTimeLabel({
      date: "2026-07-06",
      time: "10:30",
      at: "2026-07-06T15:30:00.000Z",
    }),
    "7/6/2026, 10:30 AM",
  );
  assert.equal(
    buildBookingDateTimeLabel({
      date: "2026-07-06",
      time: "10:30",
    }),
    "7/6/2026, 10:30 AM",
  );
});
