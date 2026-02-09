import test from "node:test";
import assert from "node:assert/strict";

import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";

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

