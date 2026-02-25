import assert from "node:assert/strict";
import test from "node:test";

import {
  isAccountRoute,
  isAdminApiRoute,
  isAdminPublicApiRoute,
  isAdminPublicRoute,
  isAdminRoute,
  isClerkPublicAuthRoute,
  isStandaloneAuthRoute,
  isStagedAdminClerkProtectedRoute,
  shouldEnforceClerkOnAdminRoutes,
} from "@/lib/security/clerk";

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test("auth route helpers: account and admin matchers", () => {
  assert.equal(isAccountRoute("/account"), true);
  assert.equal(isAccountRoute("/account/profile"), true);
  assert.equal(isAccountRoute("/fleet"), false);

  assert.equal(isAdminRoute("/admin"), true);
  assert.equal(isAdminRoute("/admin/bookings"), true);
  assert.equal(isAdminRoute("/administrator"), false);
  assert.equal(isAdminApiRoute("/api/admin"), true);
  assert.equal(isAdminApiRoute("/api/admin/bookings"), true);
  assert.equal(isAdminApiRoute("/api/public/bookings"), false);

  assert.equal(isAdminPublicRoute("/admin/login"), true);
  assert.equal(isAdminPublicRoute("/admin/auth"), true);
  assert.equal(isAdminPublicRoute("/admin/set-password"), true);
  assert.equal(isAdminPublicRoute("/admin"), false);
  assert.equal(isAdminPublicRoute("/admin/bookings"), false);
  assert.equal(isAdminPublicApiRoute("/api/admin/login"), true);
  assert.equal(isAdminPublicApiRoute("/api/admin/bookings"), false);

  assert.equal(isStagedAdminClerkProtectedRoute("/admin"), true);
  assert.equal(isStagedAdminClerkProtectedRoute("/admin/auth"), false);
  assert.equal(isStagedAdminClerkProtectedRoute("/admin/login"), false);
  assert.equal(isStagedAdminClerkProtectedRoute("/api/admin/bookings"), true);
  assert.equal(isStagedAdminClerkProtectedRoute("/api/admin/login"), false);

  assert.equal(isClerkPublicAuthRoute("/sign-in"), true);
  assert.equal(isClerkPublicAuthRoute("/sign-up"), true);
  assert.equal(isClerkPublicAuthRoute("/forgot-password"), true);
  assert.equal(isStandaloneAuthRoute("/task/reset-password"), true);
  assert.equal(isStandaloneAuthRoute("/fleet"), false);
});

test("auth route helpers: admin Clerk enforcement toggle", { concurrency: false }, () => {
  const original = process.env.CLERK_PROTECT_ADMIN_ROUTES;

  try {
    setEnv("CLERK_PROTECT_ADMIN_ROUTES", "1");
    assert.equal(shouldEnforceClerkOnAdminRoutes(), true);

    setEnv("CLERK_PROTECT_ADMIN_ROUTES", "0");
    assert.equal(shouldEnforceClerkOnAdminRoutes(), false);

    setEnv("CLERK_PROTECT_ADMIN_ROUTES", undefined);
    assert.equal(shouldEnforceClerkOnAdminRoutes(), false);
  } finally {
    setEnv("CLERK_PROTECT_ADMIN_ROUTES", original);
  }
});
