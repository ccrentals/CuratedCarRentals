import test from "node:test";
import assert from "node:assert/strict";

import { calcDaysInclusive, calcRentalDays, dateOnlyUtc } from "@/lib/payments/dateMath";
import { normalizeAdminSettingsValue } from "@/lib/adminSettings";
import {
  calcElapsedCalendarDays,
  defaultBookingDateTime,
  restoredPickupIsBeforeDefault,
  validateMinimumRentalDays,
} from "@/lib/bookings/minimumRentalDays";

test("dateOnlyUtc normalizes to T00:00:00Z", () => {
  const d = dateOnlyUtc("2026-03-19T18:22:10.000Z");
  assert.ok(d instanceof Date);
  assert.equal(d!.toISOString(), "2026-03-19T00:00:00.000Z");
});

test("calcDaysInclusive: same-day is 1 day", () => {
  assert.equal(calcDaysInclusive("2026-03-19", "2026-03-19"), 1);
});

test("calcDaysInclusive: consecutive dates count as 2 days (inclusive rule)", () => {
  assert.equal(calcDaysInclusive("2026-03-19", "2026-03-20"), 2);
});

test("calcDaysInclusive: works with Date objects (DB driver often returns Date for DATE columns)", () => {
  const start = new Date("2026-03-19T05:00:00.000Z");
  const end = new Date("2026-03-20T05:00:00.000Z");
  assert.equal(calcDaysInclusive(start, end), 2);
});

test("calcDaysInclusive: crossing month boundary stays consistent", () => {
  assert.equal(calcDaysInclusive("2026-02-28", "2026-03-01"), 2);
});

test("calcRentalDays: return date is exclusive for billing", () => {
  assert.equal(calcRentalDays("2026-06-26", "2026-06-28"), 2);
});

test("calcRentalDays: same-day is one day and reversed ranges are invalid", () => {
  assert.equal(calcRentalDays("2026-06-26", "2026-06-26"), 1);
  assert.equal(calcRentalDays("2026-06-28", "2026-06-26"), 0);
});

test("calcElapsedCalendarDays: consecutive dates count as 1 elapsed rental day", () => {
  assert.equal(calcElapsedCalendarDays("2026-06-03", "2026-06-04"), 1);
});

test("validateMinimumRentalDays: rejects one elapsed day when minimum is 2", () => {
  const result = validateMinimumRentalDays({
    start: "2026-06-03T06:00:00.000Z",
    end: "2026-06-04T06:00:00.000Z",
    minimumDays: 2,
  });

  assert.equal(result.ok, false);
  assert.equal(result.elapsedDays, 1);
  assert.equal(result.message, "Minimum rental period is 2 days.");
});

test("validateMinimumRentalDays: accepts two elapsed days when minimum is 2", () => {
  const result = validateMinimumRentalDays({
    start: "2026-06-03T06:00:00.000Z",
    end: "2026-06-05T06:00:00.000Z",
    minimumDays: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.elapsedDays, 2);
  assert.equal(result.message, null);
});

test("defaultBookingDateTime: before 11 AM Jamaica defaults to today at 11 AM", () => {
  const result = defaultBookingDateTime({
    now: new Date("2026-06-03T15:59:00.000Z"),
    minimumDays: 2,
  });

  assert.deepEqual(result, {
    pickupDate: "2026-06-03",
    pickupTime: "11:00",
    dropoffDate: "2026-06-05",
    dropoffTime: "11:00",
  });
});

test("defaultBookingDateTime: after 11 AM through 3 PM Jamaica defaults to today at 3 PM", () => {
  const result = defaultBookingDateTime({
    now: new Date("2026-06-03T16:01:00.000Z"),
    minimumDays: 2,
  });

  assert.deepEqual(result, {
    pickupDate: "2026-06-03",
    pickupTime: "15:00",
    dropoffDate: "2026-06-05",
    dropoffTime: "15:00",
  });
});

test("defaultBookingDateTime: after 3 PM Jamaica defaults to next day at 11 AM", () => {
  const result = defaultBookingDateTime({
    now: new Date("2026-06-03T20:01:00.000Z"),
    minimumDays: 3,
  });

  assert.deepEqual(result, {
    pickupDate: "2026-06-04",
    pickupTime: "11:00",
    dropoffDate: "2026-06-07",
    dropoffTime: "11:00",
  });
});

test("restoredPickupIsBeforeDefault: rejects stale draft pickup before Jamaica default", () => {
  assert.equal(
    restoredPickupIsBeforeDefault({
      pickupDate: "2026-06-02",
      pickupTime: "11:00",
      now: new Date("2026-06-03T03:52:00.000Z"),
      minimumDays: 2,
    }),
    true,
  );
});

test("restoredPickupIsBeforeDefault: accepts draft pickup at current Jamaica default", () => {
  assert.equal(
    restoredPickupIsBeforeDefault({
      pickupDate: "2026-06-03",
      pickupTime: "11:00",
      now: new Date("2026-06-03T03:52:00.000Z"),
      minimumDays: 2,
    }),
    false,
  );
});

test("normalizeAdminSettingsValue: ignores legacy per-vehicle minimum rental day overrides", () => {
  const settings = normalizeAdminSettingsValue({
    bookingMinimumRentalDays: {
      globalDefaultDays: 4,
      vehicleOverrides: {
        "legacy-vehicle": 1,
      },
    },
  });

  assert.deepEqual(settings.bookingMinimumRentalDays, {
    globalDefaultDays: 4,
  });
});
