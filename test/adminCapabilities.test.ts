import assert from "node:assert/strict";
import test from "node:test";

import { canAccessAdminPath, isDeveloperOnlyAdminPath } from "@/lib/auth/adminCapabilities";

test("developer-only admin paths are identified consistently", () => {
  assert.equal(isDeveloperOnlyAdminPath("/admin/cron"), true);
  assert.equal(isDeveloperOnlyAdminPath("/admin/health"), true);
  assert.equal(isDeveloperOnlyAdminPath("/admin/documentation"), true);
  assert.equal(isDeveloperOnlyAdminPath("/admin/documentation/security"), true);
  assert.equal(isDeveloperOnlyAdminPath("/admin/template-lab"), true);
  assert.equal(isDeveloperOnlyAdminPath("/admin/developer"), true);
  assert.equal(isDeveloperOnlyAdminPath("/admin/developer/access"), true);
  assert.equal(isDeveloperOnlyAdminPath("/admin/vehicles"), false);
});

test("admin path access hides developer-only destinations from plain admins", () => {
  assert.equal(canAccessAdminPath("ADMIN", "/admin/vehicles"), true);
  assert.equal(canAccessAdminPath("ADMIN", "/admin/settings"), true);
  assert.equal(canAccessAdminPath("ADMIN", "/admin/cron"), false);
  assert.equal(canAccessAdminPath("ADMIN", "/admin/health"), false);
  assert.equal(canAccessAdminPath("ADMIN", "/admin/documentation"), false);
  assert.equal(canAccessAdminPath("ADMIN", "/admin/template-lab"), false);
  assert.equal(canAccessAdminPath("ADMIN", "/admin/developer"), false);

  assert.equal(canAccessAdminPath("DEVELOPER", "/admin/vehicles"), true);
  assert.equal(canAccessAdminPath("DEVELOPER", "/admin/settings"), true);
  assert.equal(canAccessAdminPath("DEVELOPER", "/admin/cron"), true);
  assert.equal(canAccessAdminPath("DEVELOPER", "/admin/health"), true);
  assert.equal(canAccessAdminPath("DEVELOPER", "/admin/documentation"), true);
  assert.equal(canAccessAdminPath("DEVELOPER", "/admin/template-lab"), true);
  assert.equal(canAccessAdminPath("DEVELOPER", "/admin/developer"), true);
});
