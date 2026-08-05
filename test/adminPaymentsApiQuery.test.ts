import assert from "node:assert/strict";
import test from "node:test";

import { parseAdminPaymentsQuery } from "@/app/api/admin/payments/route";

test("admin payments API normalizes supported filters and page size", () => {
  const result = parseAdminPaymentsQuery("https://example.test/api/admin/payments?q=%20BK000123%20&type=BALANCE&state=FAILED&provider=wipay&limit=200");
  assert.deepEqual(result, {
    q: "BK000123",
    type: "balance",
    state: "failed",
    provider: "WIPAY",
    cursor: "",
    limit: 50,
  });
});

test("admin payments API rejects unsupported filters and applies safe defaults", () => {
  const result = parseAdminPaymentsQuery("https://example.test/api/admin/payments?type=chargeback&state=secret&provider=stripe&limit=-5");
  assert.equal(result.type, "all");
  assert.equal(result.state, "all");
  assert.equal(result.provider, "all");
  assert.equal(result.limit, 10);
});
