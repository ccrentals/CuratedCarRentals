import assert from "node:assert/strict";
import test from "node:test";

import {
  canUpdatePrimaryAdminLoginMethod,
  resolvePrimaryAdminLoginMethod,
  resolvePrimaryAdminLoginPath,
} from "@/lib/auth/adminLoginMethod";
import {
  DEFAULT_ADMIN_LOGIN_METHOD,
  normalizeAdminLoginMethod,
} from "@/lib/adminSettings";

test("admin login method normalization defaults to clerk", () => {
  assert.equal(DEFAULT_ADMIN_LOGIN_METHOD, "clerk");
  assert.equal(normalizeAdminLoginMethod(undefined), "clerk");
  assert.equal(normalizeAdminLoginMethod(null), "clerk");
  assert.equal(normalizeAdminLoginMethod(""), "clerk");
  assert.equal(normalizeAdminLoginMethod("clerk"), "clerk");
  assert.equal(normalizeAdminLoginMethod("CLERK"), "clerk");
  assert.equal(normalizeAdminLoginMethod("legacy"), "legacy");
  assert.equal(normalizeAdminLoginMethod("LEGACY"), "legacy");
  assert.equal(normalizeAdminLoginMethod("unexpected"), "clerk");
});

test("primary admin login path resolves from normalized setting", () => {
  assert.equal(resolvePrimaryAdminLoginMethod("legacy"), "legacy");
  assert.equal(resolvePrimaryAdminLoginMethod("clerk"), "clerk");
  assert.equal(resolvePrimaryAdminLoginMethod("bad-value"), "clerk");

  assert.equal(resolvePrimaryAdminLoginPath("legacy"), "/admin/login");
  assert.equal(resolvePrimaryAdminLoginPath("clerk"), "/sign-in");
  assert.equal(resolvePrimaryAdminLoginPath("bad-value"), "/sign-in");
});

test("primary login method updates require DEVELOPER role when value changes", () => {
  assert.equal(
    canUpdatePrimaryAdminLoginMethod({
      actorRole: "DEVELOPER",
      previousMethod: "clerk",
      nextMethod: "legacy",
    }),
    true,
  );

  assert.equal(
    canUpdatePrimaryAdminLoginMethod({
      actorRole: "ADMIN",
      previousMethod: "clerk",
      nextMethod: "legacy",
    }),
    false,
  );

  assert.equal(
    canUpdatePrimaryAdminLoginMethod({
      actorRole: "ADMIN",
      previousMethod: "legacy",
      nextMethod: "legacy",
    }),
    true,
  );
});
