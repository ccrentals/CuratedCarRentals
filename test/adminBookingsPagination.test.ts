import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBookingsCursor,
  encodeBookingsCursor,
  mergeBookingsById,
  normalizeBookingPageSize,
  withBookingPageSizeSearchParams,
} from "@/lib/bookings/adminBookingsPagination";

test("normalizeBookingPageSize: defaults to 10 for invalid values", () => {
  assert.equal(normalizeBookingPageSize(undefined), 10);
  assert.equal(normalizeBookingPageSize(""), 10);
  assert.equal(normalizeBookingPageSize("999"), 10);
  assert.equal(normalizeBookingPageSize(5), 10);
});

test("normalizeBookingPageSize: accepts 10/30/50", () => {
  assert.equal(normalizeBookingPageSize("10"), 10);
  assert.equal(normalizeBookingPageSize("30"), 30);
  assert.equal(normalizeBookingPageSize("50"), 50);
});

test("bookings cursor encode/decode round-trip", () => {
  const encoded = encodeBookingsCursor({
    createdAt: "2026-02-14T01:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
  });

  const decoded = decodeBookingsCursor(encoded);
  assert.deepEqual(decoded, {
    createdAt: "2026-02-14T01:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
  });
});

test("mergeBookingsById: appends new rows without duplicates", () => {
  const merged = mergeBookingsById(
    [
      { id: "a", label: "first" },
      { id: "b", label: "second" },
    ],
    [
      { id: "b", label: "duplicate second" },
      { id: "c", label: "third" },
    ],
  );

  assert.deepEqual(merged, [
    { id: "a", label: "first" },
    { id: "b", label: "second" },
    { id: "c", label: "third" },
  ]);
});

test("withBookingPageSizeSearchParams: keeps filters and resets cursor", () => {
  const next = withBookingPageSizeSearchParams("status=confirmed&q=damian&cursor=abc123", "30");
  assert.equal(next.get("status"), "confirmed");
  assert.equal(next.get("q"), "damian");
  assert.equal(next.get("pageSize"), "30");
  assert.equal(next.has("cursor"), false);
});
