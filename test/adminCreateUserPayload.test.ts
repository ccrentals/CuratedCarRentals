import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdminCreatedUserPublicMetadata,
  buildAdminUserCreateSuccessPayload,
  ensureAdminCreatedUserEmailVerification,
  shouldSkipEmailChallengeForAdminCreatedUsers,
} from "@/app/api/admin/users/route";

test("admin create-user payload includes username and temp password", () => {
  const payload = buildAdminUserCreateSuccessPayload({
    userId: "user-123",
    userPublicId: "UR000123",
    username: "mmalcolm",
    tempPassword: "TempPass123!",
    tempPasswordExpiresAt: "2026-03-03T10:00:00.000Z",
    clerkSync: {
      status: "created",
      clerkUserId: "user_clerk_123",
      finalUsername: "mmalcolm",
      message: "Clerk account created and linked.",
      localLinkSaved: true,
    },
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.username, "mmalcolm");
  assert.equal(payload.tempPassword, "TempPass123!");
  assert.equal(payload.userId, "user-123");
});

test("admin create-user metadata marks first-login password change", () => {
  const metadata = buildAdminCreatedUserPublicMetadata({
    tempPasswordExpiresAt: "2026-03-03T10:00:00.000Z",
  });
  assert.equal(metadata.forcePasswordChange, true);
  assert.equal(metadata.tempPasswordExpiresAt, "2026-03-03T10:00:00.000Z");
});

test("email-challenge skip flag applies outside production or with explicit env flag", () => {
  assert.equal(
    shouldSkipEmailChallengeForAdminCreatedUsers({
      nodeEnv: "development",
      envFlag: "0",
    }),
    true,
  );
  assert.equal(
    shouldSkipEmailChallengeForAdminCreatedUsers({
      nodeEnv: "production",
      envFlag: "0",
    }),
    false,
  );
  assert.equal(
    shouldSkipEmailChallengeForAdminCreatedUsers({
      nodeEnv: "production",
      envFlag: "1",
    }),
    true,
  );
});

test("admin create-user email verification helper verifies primary email when enabled", async () => {
  const calls: Array<{ id: string; verified?: boolean }> = [];
  const result = await ensureAdminCreatedUserEmailVerification({
    clerkEmailAddressesApi: {
      updateEmailAddress: async (emailAddressId, params) => {
        calls.push({ id: emailAddressId, verified: params?.verified });
        return {} as never;
      },
    },
    shouldVerify: true,
    primaryEmailAddressId: "email_primary_123",
    emailAddresses: [
      {
        id: "email_primary_123",
        verification: { status: "unverified" },
      },
    ],
  });

  assert.equal(result.attempted, true);
  assert.equal(result.verified, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { id: "email_primary_123", verified: true });
});
