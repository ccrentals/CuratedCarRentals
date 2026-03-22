import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_MAINTENANCE_SEARCH_LENGTH,
  normalizeMaintenanceSearchTerm,
} from "@/lib/maintenance/normalize";

test("maintenance search term ignores values below threshold", () => {
  assert.equal(MIN_MAINTENANCE_SEARCH_LENGTH, 3);
  assert.equal(normalizeMaintenanceSearchTerm("ab"), "");
  assert.equal(normalizeMaintenanceSearchTerm("  xy "), "");
});

test("maintenance search term trims and keeps 3+ characters", () => {
  assert.equal(normalizeMaintenanceSearchTerm(" oil "), "oil");
  assert.equal(normalizeMaintenanceSearchTerm("Brake"), "Brake");
});
