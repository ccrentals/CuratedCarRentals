import assert from "node:assert/strict";
import test from "node:test";

import { fmtAdminDateTimeNoSeconds } from "@/lib/dateFormat";

test("date format: admin timestamp formatter uses Jamaica timezone", () => {
  assert.equal(
    fmtAdminDateTimeNoSeconds("2026-03-16T14:12:00.000Z"),
    "3/16/2026, 9:12 AM",
  );
});

test("date format: admin timestamp formatter leaves invalid values untouched", () => {
  assert.equal(fmtAdminDateTimeNoSeconds("not-a-date"), "not-a-date");
});
