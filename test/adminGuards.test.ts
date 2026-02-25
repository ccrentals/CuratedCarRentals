import assert from "node:assert/strict";
import test from "node:test";

import {
  requireAdminRole,
  requireStaffOrAdminRole,
  resolveAdminActor,
} from "@/lib/auth/adminGuards";
import type { AdminSession } from "@/lib/auth/session";

function makeSession(
  role: string,
  source: AdminSession["source"] = "legacy",
): AdminSession {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    role,
    issuedAt: 1,
    expiresAt: 2,
    source,
    clerkUserId: source === "clerk" ? "user_clerk_123" : undefined,
  };
}

test("admin guards: unauthenticated requests are rejected", async () => {
  const result = await requireStaffOrAdminRole({ getSession: async () => null });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "unauthorized");
    assert.equal(result.response.status, 401);
  }
});

test("admin guards: non-staff role is forbidden", async () => {
  const result = await requireStaffOrAdminRole({
    getSession: async () => makeSession("CUSTOMER"),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "forbidden");
    assert.equal(result.response.status, 403);
  }
});

test("admin guards: Clerk-bridge non-staff role is forbidden with actor context", async () => {
  const result = await resolveAdminActor({
    requirement: "staff",
    getSession: async () => makeSession("CUSTOMER", "clerk"),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "forbidden");
    assert.equal(result.actor?.authSource, "clerk-bridge");
    assert.equal(result.actor?.role, "CUSTOMER");
  }
});

test("admin guards: staff role passes staff guard but not admin guard", async () => {
  const staffResult = await requireStaffOrAdminRole({
    getSession: async () => makeSession("USER"),
  });
  assert.equal(staffResult.ok, true);
  if (staffResult.ok) {
    assert.equal(staffResult.actor.appRole, "USER");
    assert.equal(staffResult.actor.authSource, "legacy");
  }

  const adminResult = await requireAdminRole({
    getSession: async () => makeSession("USER"),
  });
  assert.equal(adminResult.ok, false);
  if (!adminResult.ok) {
    assert.equal(adminResult.reason, "forbidden");
    assert.equal(adminResult.response.status, 403);
  }
});

test("admin guards: admin role passes admin guard", async () => {
  const result = await requireAdminRole({
    getSession: async () => makeSession("ADMIN"),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.actor.appRole, "ADMIN");
    assert.equal(result.actor.authSource, "legacy");
  }
});

test("admin guards: clerk bridge actor context is normalized", async () => {
  const result = await resolveAdminActor({
    requirement: "staff",
    getSession: async () => makeSession("DEVELOPER", "clerk"),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.actor.authSource, "clerk-bridge");
    assert.equal(result.actor.clerkUserId, "user_clerk_123");
    assert.equal(result.actor.role, "DEVELOPER");
  }
});

test("admin guards: text response format is supported", async () => {
  const result = await requireAdminRole({
    getSession: async () => null,
    responseFormat: "text",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.response.status, 401);
    const body = await result.response.text();
    assert.equal(body, "Unauthorized");
  }
});

test("admin guards: json unauthorized and forbidden payloads are consistent", async () => {
  const unauthorized = await requireStaffOrAdminRole({ getSession: async () => null });
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) {
    assert.equal(unauthorized.response.status, 401);
    assert.deepEqual(await unauthorized.response.json(), {
      ok: false,
      error: "Unauthorized",
    });
  }

  const forbidden = await requireAdminRole({
    getSession: async () => makeSession("USER"),
  });
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) {
    assert.equal(forbidden.response.status, 403);
    assert.deepEqual(await forbidden.response.json(), {
      ok: false,
      error: "Forbidden",
    });
  }
});
