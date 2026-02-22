import assert from "node:assert/strict";
import test from "node:test";

import {
  nextSort,
  readSortFromSearchParams,
} from "@/components/admin/tableSort";

test("nextSort: new column starts with provided default direction", () => {
  const next = nextSort({ sortBy: "created", sortDir: "desc" }, "customer", "asc");
  assert.deepEqual(next, { sortBy: "customer", sortDir: "asc" });
});

test("nextSort: active column toggles asc/desc", () => {
  const toDesc = nextSort({ sortBy: "created", sortDir: "asc" }, "created", "desc");
  assert.deepEqual(toDesc, { sortBy: "created", sortDir: "desc" });

  const toAsc = nextSort({ sortBy: "created", sortDir: "desc" }, "created", "desc");
  assert.deepEqual(toAsc, { sortBy: "created", sortDir: "asc" });
});

test("readSortFromSearchParams: falls back to legacy mapping with allowlist", () => {
  const params = new URLSearchParams("sort=total_spend");
  const sort = readSortFromSearchParams(params, {
    allowedSortBy: ["customer", "totalSpend", "lastBooked"],
    defaultSortBy: "lastBooked",
    defaultSortDir: "desc",
    legacySortParam: "sort",
    legacySortMap: {
      total_spend: { sortBy: "totalSpend", sortDir: "desc" },
    },
  });

  assert.deepEqual(sort, { sortBy: "totalSpend", sortDir: "desc" });
});

test("readSortFromSearchParams: accepts quote sort allowlist keys", () => {
  const params = new URLSearchParams("sortBy=pickup&sortDir=asc");
  const sort = readSortFromSearchParams(params, {
    allowedSortBy: ["created", "customer", "email", "pickup", "return", "vehicle", "total", "status"],
    defaultSortBy: "created",
    defaultSortDir: "desc",
  });

  assert.deepEqual(sort, { sortBy: "pickup", sortDir: "asc" });
});
