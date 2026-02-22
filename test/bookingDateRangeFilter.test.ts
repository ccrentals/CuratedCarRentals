import assert from "node:assert/strict";
import test from "node:test";

import { bookingMatchesDateRange, buildBookingRangeWhere, buildRange } from "@/lib/bookings/dateRangeFilter";

function requireRange(fromDate: string, toDate?: string | null) {
  const range = buildRange(fromDate, toDate);
  assert.ok(range, "expected a normalized range");
  return range;
}

test("buildRange: normalizes dateTo to dateFrom when dateTo is blank", () => {
  const range = requireRange("2026-02-21", null);
  assert.equal(range.dateFrom, "2026-02-21");
  assert.equal(range.dateTo, "2026-02-21");
  assert.equal(range.rangeStartIso, "2026-02-21T00:00:00.000Z");
  assert.equal(range.rangeEndIso, "2026-02-21T23:59:59.999Z");
});

test("buildBookingRangeWhere: uses overlap OR created-at window clause", () => {
  const rangeWhere = buildBookingRangeWhere({
    rangeStart: "2026-02-21T00:00:00.000Z",
    rangeEnd: "2026-02-21T23:59:59.999Z",
    bookingAlias: "b",
  });
  assert.match(
    rangeWhere.clause,
    /start_at, b\.start_date::timestamptz\) <= \$2::timestamptz[\s\S]*end_at[\s\S]*>= \$1::timestamptz[\s\S]*created_at between \$1::timestamptz and \$2::timestamptz/,
  );
  assert.deepEqual(rangeWhere.values, [
    "2026-02-21T00:00:00.000Z",
    "2026-02-21T23:59:59.999Z",
  ]);
});

test("bookingMatchesDateRange: booking fully inside range is included", () => {
  const range = requireRange("2026-02-21", "2026-02-21");
  assert.equal(
    bookingMatchesDateRange(
      {
        startAt: "2026-02-21T08:00:00.000Z",
        endAt: "2026-02-21T18:00:00.000Z",
        createdAt: "2026-02-10T09:00:00.000Z",
      },
      range,
    ),
    true,
  );
});

test("bookingMatchesDateRange: booking starts before range and ends inside range is included", () => {
  const range = requireRange("2026-02-21", "2026-02-21");
  assert.equal(
    bookingMatchesDateRange(
      {
        startAt: "2026-02-20T20:00:00.000Z",
        endAt: "2026-02-21T03:00:00.000Z",
        createdAt: "2026-02-10T09:00:00.000Z",
      },
      range,
    ),
    true,
  );
});

test("bookingMatchesDateRange: booking starts inside range and ends after range is included", () => {
  const range = requireRange("2026-02-21", "2026-02-21");
  assert.equal(
    bookingMatchesDateRange(
      {
        startAt: "2026-02-21T10:00:00.000Z",
        endAt: "2026-02-22T12:00:00.000Z",
        createdAt: "2026-02-10T09:00:00.000Z",
      },
      range,
    ),
    true,
  );
});

test("bookingMatchesDateRange: booking spanning the entire range is included", () => {
  const range = requireRange("2026-02-21", "2026-02-24");
  assert.equal(
    bookingMatchesDateRange(
      {
        startAt: "2026-02-20T00:00:00.000Z",
        endAt: "2026-02-25T23:59:59.000Z",
        createdAt: "2026-02-10T09:00:00.000Z",
      },
      range,
    ),
    true,
  );
});

test("bookingMatchesDateRange: booking outside range is excluded unless created in range", () => {
  const range = requireRange("2026-02-21", "2026-02-21");
  assert.equal(
    bookingMatchesDateRange(
      {
        startAt: "2026-02-25T00:00:00.000Z",
        endAt: "2026-02-26T00:00:00.000Z",
        createdAt: "2026-02-19T09:00:00.000Z",
      },
      range,
    ),
    false,
  );

  assert.equal(
    bookingMatchesDateRange(
      {
        startAt: "2026-02-25T00:00:00.000Z",
        endAt: "2026-02-26T00:00:00.000Z",
        createdAt: "2026-02-21T09:00:00.000Z",
      },
      range,
    ),
    true,
  );
});

test("bookingMatchesDateRange: regression - rental overlap with created_at outside range is included", () => {
  const range = requireRange("2026-02-21", "2026-02-21");
  assert.equal(
    bookingMatchesDateRange(
      {
        startAt: "2026-02-20T00:00:00.000Z",
        endAt: "2026-02-23T00:00:00.000Z",
        createdAt: "2026-02-18T09:00:00.000Z",
      },
      range,
    ),
    true,
  );
});

