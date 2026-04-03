import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClerkIdentitySyncReport,
  toClerkIdentityRecord,
  type ClerkIdentityRecord,
  type LocalIdentityRecord,
} from "@/lib/auth/clerkIdentitySync";

function localUser(overrides: Partial<LocalIdentityRecord> = {}): LocalIdentityRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "debug-admin@example.com",
    username: "debug-admin",
    clerkUserId: "user_clerk_123",
    role: "ADMIN",
    isActive: true,
    deactivatedAt: null,
    ...overrides,
  };
}

function clerkUser(overrides: Partial<ClerkIdentityRecord> = {}): ClerkIdentityRecord {
  return {
    clerkUserId: "user_clerk_123",
    email: "debug-admin@example.com",
    username: "debug-admin",
    deleted: false,
    ...overrides,
  };
}

test("buildClerkIdentitySyncReport flags username drift against Clerk", () => {
  const report = buildClerkIdentitySyncReport({
    localUsers: [localUser({ username: "debug-admin-local" })],
    clerkUsers: [clerkUser()],
  });

  assert.equal(report.rows[0]?.status, "MISMATCH");
  assert.equal(report.rows[0]?.canAutoRepair, true);
  assert.equal(report.counts.MISMATCH, 1);
});

test("buildClerkIdentitySyncReport identifies safe relink by unique email", () => {
  const report = buildClerkIdentitySyncReport({
    localUsers: [localUser({ clerkUserId: null, username: "debug-admin-local" })],
    clerkUsers: [clerkUser()],
  });

  assert.equal(report.rows[0]?.status, "NEEDS_RELINK");
  assert.equal(report.rows[0]?.canAutoRepair, true);
  assert.equal(report.rows[0]?.clerkUserId, "user_clerk_123");
});

test("buildClerkIdentitySyncReport flags missing local users from Clerk", () => {
  const report = buildClerkIdentitySyncReport({
    localUsers: [],
    clerkUsers: [clerkUser({ clerkUserId: "user_clerk_missing", email: "orphan@example.com" })],
  });

  assert.equal(report.rows[0]?.status, "MISSING_LOCAL_USER");
  assert.equal(report.rows[0]?.canAutoRepair, false);
});

test("toClerkIdentityRecord reads primary email from Clerk webhook/API shapes", () => {
  const identity = toClerkIdentityRecord({
    id: "user_clerk_123",
    username: "debug-admin",
    primary_email_address_id: "email_123",
    email_addresses: [{ id: "email_123", email_address: "debug-admin@example.com" }],
  });

  assert.deepEqual(identity, {
    clerkUserId: "user_clerk_123",
    email: "debug-admin@example.com",
    username: "debug-admin",
    deleted: false,
  });
});
