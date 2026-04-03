import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminSetPasswordPost,
  type AdminSetPasswordDeps,
} from "@/app/api/admin/set-password/route";

function makeDeps(overrides: Partial<AdminSetPasswordDeps> = {}): AdminSetPasswordDeps {
  return {
    requireAuth: async () =>
      ({
        ok: true,
        session: {
          userId: "local-admin-1",
          role: "ADMIN",
          issuedAt: 1,
          expiresAt: 2,
          source: "legacy",
          clerkUserId: null,
        },
        actor: {
          userId: "local-admin-1",
          role: "ADMIN",
          appRole: "ADMIN",
          authSource: "legacy",
          clerkUserId: null,
          issuedAt: 1,
          expiresAt: 2,
        },
      }) as never,
    requireCsrfCheck: async () => true,
    isClerkEnabledFn: () => true,
    loadUserState: async () => ({
      id: "local-admin-1",
      email: "debug-admin@example.com",
      role: "ADMIN",
      full_name: "Debug Admin",
      username: "debug-admin",
      clerk_user_id: null,
      must_change_password: true,
      temp_password_expires_at: null,
    }),
    resolveClerkIdentity: async () =>
      ({
        ok: true,
        clerkUserId: "user_clerk_123",
        resolution: "matched_by_email",
      }) as const,
    syncPassword: async () =>
      ({
        ok: true,
        clerkUserId: "user_clerk_123",
      }) as const,
    hashPasswordFn: async () => "hashed-password",
    updateLocalPasswordState: async () => {},
    writeAudit: async () => {},
    ...overrides,
  };
}

test("legacy admin set-password uses Clerk first when Clerk is enabled", async () => {
  let resolveInput:
    | {
        localUser: {
          id: string;
          email: string;
          role: string;
          fullName: string | null;
          username: string | null;
          clerkUserId: string | null;
        };
        flow: string;
      }
    | null = null;
  let syncInput:
    | {
        localUserId: string;
        clerkUserId: string;
        password: string;
      }
    | null = null;
  let auditDetails: Record<string, unknown> | null = null;

  const response = await handleAdminSetPasswordPost(
    new Request("http://localhost/api/admin/set-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        password: "NewPass123!",
        confirmPassword: "NewPass123!",
        csrfToken: "token",
      }),
    }),
    makeDeps({
      resolveClerkIdentity: async (input) => {
        resolveInput = input;
        return {
          ok: true,
          clerkUserId: "user_clerk_123",
          resolution: "matched_by_email",
        } as const;
      },
      syncPassword: async (input) => {
        syncInput = input;
        return {
          ok: true,
          clerkUserId: input.clerkUserId,
        } as const;
      },
      writeAudit: async (input) => {
        auditDetails = input.details ?? null;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(resolveInput?.flow, "legacy_admin_set_password");
  assert.deepEqual(resolveInput?.localUser, {
    id: "local-admin-1",
    email: "debug-admin@example.com",
    role: "ADMIN",
    fullName: "Debug Admin",
    username: "debug-admin",
    clerkUserId: null,
  });
  assert.deepEqual(syncInput, {
    localUserId: "local-admin-1",
    clerkUserId: "user_clerk_123",
    password: "NewPass123!",
  });
  assert.equal(auditDetails?.flow, "legacy_admin_set_password");
  assert.equal(auditDetails?.clerkUserId, "user_clerk_123");
  assert.equal(auditDetails?.clerkResolution, "matched_by_email");

  const body = (await response.json()) as { ok: boolean };
  assert.equal(body.ok, true);
});

test("legacy admin set-password preserves local-only behavior when Clerk is disabled", async () => {
  let localUpdate: { userId: string; passwordHash: string } | null = null;
  let syncCalled = false;

  const response = await handleAdminSetPasswordPost(
    new Request("http://localhost/api/admin/set-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        password: "NewPass123!",
        confirmPassword: "NewPass123!",
        csrfToken: "token",
      }),
    }),
    makeDeps({
      isClerkEnabledFn: () => false,
      syncPassword: async () => {
        syncCalled = true;
        return {
          ok: true,
          clerkUserId: "user_clerk_123",
        } as const;
      },
      updateLocalPasswordState: async (input) => {
        localUpdate = input;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(syncCalled, false);
  assert.deepEqual(localUpdate, {
    userId: "local-admin-1",
    passwordHash: "hashed-password",
  });
});

test("legacy admin set-password fails safely when Clerk identity resolution is ambiguous", async () => {
  let syncCalled = false;

  const response = await handleAdminSetPasswordPost(
    new Request("http://localhost/api/admin/set-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        password: "NewPass123!",
        confirmPassword: "NewPass123!",
        csrfToken: "token",
      }),
    }),
    makeDeps({
      resolveClerkIdentity: async () =>
        ({
          ok: false,
          status: 409,
          message: "Multiple Clerk users were found for this email. Resolve the Clerk mapping manually first.",
          clerkUserId: null,
        }) as const,
      syncPassword: async () => {
        syncCalled = true;
        return {
          ok: true,
          clerkUserId: "user_clerk_123",
        } as const;
      },
    }),
  );

  assert.equal(response.status, 409);
  assert.equal(syncCalled, false);

  const body = (await response.json()) as { error?: string };
  assert.equal(
    body.error,
    "Multiple Clerk users were found for this email. Resolve the Clerk mapping manually first.",
  );
});
