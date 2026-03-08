import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_AUTH_ENTRY_PATH,
  canUpdatePrimaryAdminLoginMethod,
  evaluatePrimaryAdminLoginMethodPersistence,
  resolvePostClerkAdminAuthPath,
  parseAdminLoginMethodOverride,
  resolvePrimaryAdminLoginMethodResolution,
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

  assert.equal(resolvePostClerkAdminAuthPath("legacy"), "/admin/login");
  assert.equal(resolvePostClerkAdminAuthPath("clerk"), "/admin");
  assert.equal(resolvePostClerkAdminAuthPath("bad-value"), "/admin");
  assert.equal(ADMIN_AUTH_ENTRY_PATH, "/admin/auth");
});

test("env override parser accepts only clerk/legacy and ignores blank/invalid values", () => {
  assert.equal(parseAdminLoginMethodOverride("legacy"), "legacy");
  assert.equal(parseAdminLoginMethodOverride("LEGACY"), "legacy");
  assert.equal(parseAdminLoginMethodOverride("clerk"), "clerk");
  assert.equal(parseAdminLoginMethodOverride(" CLERK "), "clerk");

  assert.equal(parseAdminLoginMethodOverride(""), null);
  assert.equal(parseAdminLoginMethodOverride("   "), null);
  assert.equal(parseAdminLoginMethodOverride(undefined), null);
  assert.equal(parseAdminLoginMethodOverride(null), null);
  assert.equal(parseAdminLoginMethodOverride("invalid"), null);
});

test("resolver precedence: env override legacy beats DB clerk", () => {
  const result = resolvePrimaryAdminLoginMethodResolution({
    envOverrideValue: "legacy",
    dbLoginMethodValue: "clerk",
    dbSource: "db",
  });
  assert.deepEqual(result, { method: "legacy", source: "env-override" });
  assert.equal(resolvePrimaryAdminLoginPath(result.method), "/admin/login");
});

test("resolver precedence: env override clerk beats DB legacy", () => {
  const result = resolvePrimaryAdminLoginMethodResolution({
    envOverrideValue: "clerk",
    dbLoginMethodValue: "legacy",
    dbSource: "db",
  });
  assert.deepEqual(result, { method: "clerk", source: "env-override" });
  assert.equal(resolvePrimaryAdminLoginPath(result.method), "/sign-in");
});

test("resolver precedence: invalid env override falls back to DB value", () => {
  const result = resolvePrimaryAdminLoginMethodResolution({
    envOverrideValue: "oops",
    dbLoginMethodValue: "legacy",
    dbSource: "db",
  });
  assert.deepEqual(result, { method: "legacy", source: "db" });
});

test("resolver precedence: blank or unset env override falls back to DB value", () => {
  const blankResult = resolvePrimaryAdminLoginMethodResolution({
    envOverrideValue: "   ",
    dbLoginMethodValue: "legacy",
    dbSource: "db",
  });
  assert.deepEqual(blankResult, { method: "legacy", source: "db" });

  const unsetResult = resolvePrimaryAdminLoginMethodResolution({
    envOverrideValue: undefined,
    dbLoginMethodValue: "legacy",
    dbSource: "db",
  });
  assert.deepEqual(unsetResult, { method: "legacy", source: "db" });
});

test("resolver precedence: missing or invalid DB falls back to default clerk", () => {
  const missingDb = resolvePrimaryAdminLoginMethodResolution({
    envOverrideValue: "",
    dbLoginMethodValue: undefined,
    dbSource: "default",
  });
  assert.deepEqual(missingDb, { method: "clerk", source: "default" });

  const invalidDb = resolvePrimaryAdminLoginMethodResolution({
    envOverrideValue: "",
    dbLoginMethodValue: "invalid",
    dbSource: "db",
  });
  assert.deepEqual(invalidDb, { method: "clerk", source: "db" });
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

test("primary login method persistence blocks changes while env override is active", () => {
  assert.deepEqual(
    evaluatePrimaryAdminLoginMethodPersistence({
      envOverrideValue: "legacy",
      previousMethod: "clerk",
      nextMethod: "legacy",
    }),
    { ok: false, reason: "env-override", effectiveMethod: "legacy" },
  );

  assert.deepEqual(
    evaluatePrimaryAdminLoginMethodPersistence({
      envOverrideValue: "clerk",
      previousMethod: "legacy",
      nextMethod: "clerk",
    }),
    { ok: false, reason: "env-override", effectiveMethod: "clerk" },
  );

  assert.deepEqual(
    evaluatePrimaryAdminLoginMethodPersistence({
      envOverrideValue: "legacy",
      previousMethod: "legacy",
      nextMethod: "legacy",
    }),
    { ok: true },
  );

  assert.deepEqual(
    evaluatePrimaryAdminLoginMethodPersistence({
      envOverrideValue: "",
      previousMethod: "legacy",
      nextMethod: "clerk",
    }),
    { ok: true },
  );
});
