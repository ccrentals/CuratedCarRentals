import assert from "node:assert/strict";
import test from "node:test";

import { buildAdminUserCreateSuccessPayload } from "@/app/api/admin/users/route";

test("admin create-user payload returns the secure setup invitation contract", () => {
  const payload = buildAdminUserCreateSuccessPayload({
    userId: "user-123",
    userPublicId: "UR000123",
    username: "mmalcolm",
    setupEmail: "mary@example.com",
    onboarding: {
      status: "setup_pending",
      message: "Complete account setup before signing in.",
      setupPath: "/sign-up?redirect=%2Fadmin",
    },
    welcomeEmail: {
      warning: "Welcome email could not be sent. Share the setup link manually.",
    },
  });

  assert.deepEqual(payload, {
    ok: true,
    userId: "user-123",
    userPublicId: "UR000123",
    username: "mmalcolm",
    setupEmail: "mary@example.com",
    onboarding: {
      status: "setup_pending",
      message: "Complete account setup before signing in.",
      setupPath: "/sign-up?redirect=%2Fadmin",
    },
    welcomeEmail: {
      warning: "Welcome email could not be sent. Share the setup link manually.",
    },
  });
  assert.equal("tempPassword" in payload, false);
  assert.equal("tempPasswordExpiresAt" in payload, false);
});

test("admin create-user payload defaults missing welcome-email state to null", () => {
  const payload = buildAdminUserCreateSuccessPayload({
    userId: "user-456",
    userPublicId: null,
    username: "jsmith",
    setupEmail: "john@example.com",
    onboarding: {
      status: "setup_pending",
      message: "Account setup is pending.",
      setupPath: "/sign-up?redirect=%2Fadmin",
    },
  });

  assert.equal(payload.welcomeEmail, null);
  assert.equal(payload.onboarding.status, "setup_pending");
  assert.equal("tempPassword" in payload, false);
});
