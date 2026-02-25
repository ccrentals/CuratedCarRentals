import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessAdmin,
  canPerformAdminWrite,
  hasRequiredAdminAccess,
  isAdminRole,
  isDeveloperRole,
  isStaffRole,
  normalizeRole,
  parseAppRole,
} from "@/lib/auth/roles";

test("RBAC roles: normalize and parse canonical roles", () => {
  assert.equal(normalizeRole(" admin "), "ADMIN");
  assert.equal(normalizeRole(null), "");

  assert.equal(parseAppRole("admin"), "ADMIN");
  assert.equal(parseAppRole(" user "), "USER");
  assert.equal(parseAppRole("developer"), "DEVELOPER");
  assert.equal(parseAppRole("customer"), null);
});

test("RBAC roles: staff/admin/developer predicates", () => {
  assert.equal(isStaffRole("USER"), true);
  assert.equal(isStaffRole("ADMIN"), true);
  assert.equal(isStaffRole("DEVELOPER"), true);
  assert.equal(isStaffRole("customer"), false);

  assert.equal(isAdminRole("ADMIN"), true);
  assert.equal(isAdminRole("DEVELOPER"), true);
  assert.equal(isAdminRole("USER"), false);

  assert.equal(isDeveloperRole("DEVELOPER"), true);
  assert.equal(isDeveloperRole("ADMIN"), false);
});

test("RBAC roles: access and requirement helpers", () => {
  assert.equal(canAccessAdmin("USER"), true);
  assert.equal(canAccessAdmin("ADMIN"), true);
  assert.equal(canAccessAdmin("CUSTOMER"), false);

  assert.equal(canPerformAdminWrite("USER"), true);
  assert.equal(canPerformAdminWrite("ADMIN"), true);
  assert.equal(canPerformAdminWrite("CUSTOMER"), false);

  assert.equal(hasRequiredAdminAccess("USER", "staff"), true);
  assert.equal(hasRequiredAdminAccess("USER", "admin"), false);
  assert.equal(hasRequiredAdminAccess("ADMIN", "admin"), true);
  assert.equal(hasRequiredAdminAccess("DEVELOPER", "developer"), true);
  assert.equal(hasRequiredAdminAccess("ADMIN", "developer"), false);
});
