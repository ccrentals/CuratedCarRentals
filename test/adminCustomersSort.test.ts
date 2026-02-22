import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCustomerSort } from "@/app/api/admin/customers/route";

test("admin customers sorting: accepts sortBy/sortDir allowlist", () => {
  const sort = normalizeCustomerSort(new URLSearchParams("sortBy=customer&sortDir=asc"));
  assert.deepEqual(sort, { sortBy: "customer", sortDir: "asc" });
});

test("admin customers sorting: supports legacy sort param mapping", () => {
  const sort = normalizeCustomerSort(new URLSearchParams("sort=total_spend"));
  assert.deepEqual(sort, { sortBy: "totalSpend", sortDir: "desc" });
});

test("admin customers sorting: invalid values fall back to default", () => {
  const sort = normalizeCustomerSort(new URLSearchParams("sortBy=drop table&sortDir=sideways"));
  assert.deepEqual(sort, { sortBy: "lastBooked", sortDir: "desc" });
});

