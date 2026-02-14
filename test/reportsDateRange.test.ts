import assert from "node:assert/strict";
import test from "node:test";

import { isDateInInclusiveRange, overlapDaysInclusive } from "@/lib/reports/adminReports";

test("overlapDaysInclusive: counts overlapping days using inclusive boundaries", () => {
  const days = overlapDaysInclusive(
    "2026-02-01",
    "2026-02-10",
    "2026-02-08",
    "2026-02-12",
  );
  assert.equal(days, 3);
});

test("overlapDaysInclusive: returns 0 when ranges do not overlap", () => {
  const days = overlapDaysInclusive(
    "2026-02-01",
    "2026-02-10",
    "2026-02-11",
    "2026-02-12",
  );
  assert.equal(days, 0);
});

test("isDateInInclusiveRange: pickup and return dates inside range are included", () => {
  assert.equal(isDateInInclusiveRange("2026-03-10", "2026-03-01", "2026-03-31"), true);
  assert.equal(isDateInInclusiveRange("2026-03-31", "2026-03-01", "2026-03-31"), true);
  assert.equal(isDateInInclusiveRange("2026-04-01", "2026-03-01", "2026-03-31"), false);
});
