import assert from "node:assert/strict";
import test from "node:test";

import {
  dateRangeLabel,
  joinDateTime,
  parseDateOnly,
  splitDateTime,
  toDateOnly,
} from "@/components/admin/date/dateUtils";

test("single date parse/format keeps YYYY-MM-DD", () => {
  const parsed = parseDateOnly("2026-03-02");
  assert.ok(parsed instanceof Date);
  assert.equal(toDateOnly(parsed), "2026-03-02");
  assert.equal(parseDateOnly("invalid"), undefined);
});

test("date range label formats from/to states", () => {
  assert.equal(dateRangeLabel("2026-03-01", "2026-03-10"), "2026-03-01 - 2026-03-10");
  assert.equal(dateRangeLabel("2026-03-01", ""), "2026-03-01 - ...");
  assert.equal(dateRangeLabel("", ""), "Select date range");
});

test("datetime helpers split and join stable values", () => {
  assert.deepEqual(splitDateTime("2026-03-02T05:00"), { date: "2026-03-02", time: "05:00" });
  assert.equal(joinDateTime("2026-03-02", "05:00"), "2026-03-02T05:00");
  assert.equal(joinDateTime("2026-03-02", ""), "2026-03-02T00:00");
});
