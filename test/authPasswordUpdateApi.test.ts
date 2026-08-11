import assert from "node:assert/strict";
import test from "node:test";

import { handlePasswordUpdate, type PasswordUpdateDeps } from "@/app/api/auth/password/update/implementation";

function makeDeps(overrides: Partial<PasswordUpdateDeps>): PasswordUpdateDeps {
  return {
    requireAuth: async () =>
      ({
        ok: true,
        session: {
          userId: "local-admin-1",
          role: "ADMIN",
          issuedAt: 1,
          expiresAt: 2,
          source: "clerk",
          clerkUserId: "user_clerk_123",
        },
        actor: {
          userId: "local-admin-1",
          role: "ADMIN",
          appRole: "ADMIN",
          authSource: "clerk-bridge",
          clerkUserId: "user_clerk_123",
          issuedAt: 1,
          expiresAt: 2,
        },
      }) as never,
    requireCsrfCheck: async () => true,
    syncPassword: async () =>
      ({
        ok: true,
        clerkUserId: "user_clerk_123",
      }) as const,
    writeAudit: async () => {},
    ...overrides,
  };
}

test("password update endpoint rejects unauthenticated requests", async () => {
  const response = await handlePasswordUpdate(
    new Request("http://localhost/api/auth/password/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "NewPass123!", confirmPassword: "NewPass123!" }),
    }),
    makeDeps({
      requireAuth: async () =>
        ({
          ok: false,
          reason: "unauthorized",
          response: new Response("Unauthorized", { status: 401 }),
        }) as never,
    }),
  );

  assert.equal(response.status, 401);
});

test("password update endpoint syncs through the shared Clerk-first service", async () => {
  let syncInput:
    | {
        localUserId: string;
        clerkUserId: string;
        password: string;
      }
    | null = null;
  let auditDetails: Record<string, unknown> | null = null;

  const response = await handlePasswordUpdate(
    new Request("http://localhost/api/auth/password/update", {
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
  assert.deepEqual(syncInput, {
    localUserId: "local-admin-1",
    clerkUserId: "user_clerk_123",
    password: "NewPass123!",
  });
  assert.equal(auditDetails?.flow, "admin_clerk_force_change_dialog");
  assert.equal(auditDetails?.clerkUserId, "user_clerk_123");

  const body = (await response.json()) as { ok: boolean };
  assert.equal(body.ok, true);
});

test("password update endpoint surfaces local sync failures after Clerk success", async () => {
  const response = await handlePasswordUpdate(
    new Request("http://localhost/api/auth/password/update", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        password: "NewPass123!",
        confirmPassword: "NewPass123!",
        csrfToken: "token",
        flow: "clerk_task_reset_password",
      }),
    }),
    makeDeps({
      syncPassword: async () =>
        ({
          ok: false,
          status: 500,
          stage: "local",
          clerkUserId: "user_clerk_123",
          message:
            "Password updated in Clerk, but the local legacy password could not be synced. Clerk login will use the new password.",
        }) as const,
    }),
  );

  assert.equal(response.status, 500);
  const body = (await response.json()) as { error?: string; stage?: string };
  assert.equal(
    body.error,
    "Password updated in Clerk, but the local legacy password could not be synced. Clerk login will use the new password.",
  );
  assert.equal(body.stage, "local");
});
