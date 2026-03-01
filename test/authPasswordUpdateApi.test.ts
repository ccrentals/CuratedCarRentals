import assert from "node:assert/strict";
import test from "node:test";

import { handlePasswordUpdate, type PasswordUpdateDeps } from "@/app/api/auth/password/update/route";

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
    getClerk: async () =>
      ({
        users: {
          getUser: async () =>
            ({
              publicMetadata: {
                forcePasswordChange: true,
                tempPasswordExpiresAt: "2026-03-03T10:00:00.000Z",
              },
            }) as never,
          updateUser: async () => ({} as never),
        },
      }) as never,
    hashPasswordFn: async () => "hashed-password",
    updateLocalPasswordState: async () => {},
    writeAudit: async () => {},
    nowIso: () => "2026-02-28T12:00:00.000Z",
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

test("password update endpoint clears force-change metadata and updates local password", async () => {
  let updatedClerkUserId: string | null = null;
  let updatedClerkPayload: Record<string, unknown> | null = null;
  let localUpdate: { userId: string; passwordHash: string } | null = null;

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
      getClerk: async () =>
        ({
          users: {
            getUser: async () =>
              ({
                publicMetadata: {
                  forcePasswordChange: true,
                  tempPasswordExpiresAt: "2026-03-03T10:00:00.000Z",
                  localRole: "ADMIN",
                },
              }) as never,
            updateUser: async (id: string, payload: Record<string, unknown>) => {
              updatedClerkUserId = id;
              updatedClerkPayload = payload;
              return {} as never;
            },
          },
        }) as never,
      updateLocalPasswordState: async (input) => {
        localUpdate = input;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(updatedClerkUserId, "user_clerk_123");
  assert.equal(updatedClerkPayload?.password, "NewPass123!");
  assert.equal(
    (updatedClerkPayload?.publicMetadata as Record<string, unknown>).forcePasswordChange,
    false,
  );
  assert.equal(
    (updatedClerkPayload?.publicMetadata as Record<string, unknown>).tempPasswordExpiresAt,
    null,
  );
  assert.deepEqual(localUpdate, {
    userId: "local-admin-1",
    passwordHash: "hashed-password",
  });

  const body = (await response.json()) as { ok: boolean };
  assert.equal(body.ok, true);
});
