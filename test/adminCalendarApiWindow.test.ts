import assert from "node:assert/strict";
import test from "node:test";

import { buildAdminCalendarWindow } from "@/app/api/admin/calendar/route";

test("admin calendar API builds a complete Sunday-to-Saturday month grid", () => {
  const result = buildAdminCalendarWindow({ date: "2026-07-15", view: "month" });
  assert.equal(result.baseDate, "2026-07-15");
  assert.equal(result.rangeStart, "2026-06-28");
  assert.equal(result.rangeEnd, "2026-08-01");
  assert.equal(result.days.length, 35);
  assert.equal(result.days[0], result.rangeStart);
  assert.equal(result.days.at(-1), result.rangeEnd);
});

test("admin calendar API builds stable week windows and rejects invalid view/date input", () => {
  const week = buildAdminCalendarWindow({ date: "2026-07-15", view: "week" });
  assert.equal(week.view, "week");
  assert.equal(week.rangeStart, "2026-07-12");
  assert.equal(week.rangeEnd, "2026-07-18");
  assert.equal(week.days.length, 7);

  const fallback = buildAdminCalendarWindow({ date: "bad-date", view: "agenda", now: new Date("2026-07-21T13:00:00.000Z") });
  assert.equal(fallback.view, "month");
  assert.equal(fallback.baseDate, "2026-07-21");
});
