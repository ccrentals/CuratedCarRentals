import assert from "node:assert/strict";
import test from "node:test";

import { readinessResponse } from "@/app/api/health/ready/implementation";

test("public readiness response exposes only the liveness result", async () => {
  const response = readinessResponse({ ok: true });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true });
});

test("failed readiness keeps failure semantics without diagnostic data", async () => {
  const response = readinessResponse({ ok: false });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false });
});
