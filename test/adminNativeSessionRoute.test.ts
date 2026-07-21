import assert from "node:assert/strict";
import test from "node:test";

import { exchangeNativeAdminSession } from "@/app/api/mobile/admin/session/route";

const activeUser = {
  id: "11111111-1111-4111-8111-111111111111",
  public_id: "USR000001",
  email: "ops@example.com",
  role: "OPERATIONS",
  full_name: "Island Operations",
  username: "island.ops",
  is_active: true,
  deactivated_at: null,
  locked_at: null,
};

test("native session exchange requires a current Clerk session", async () => {
  const response = await exchangeNativeAdminSession({
    getClerkSession: async () => null,
    loadUser: async () => activeUser,
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
});

test("native session exchange returns an audience-bound token and safe profile", { concurrency: false }, async () => {
  const originalSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = "native-admin-route-test-secret";

  try {
    const response = await exchangeNativeAdminSession({
      getClerkSession: async () => ({
        userId: activeUser.id,
        role: activeUser.role,
        issuedAt: 1,
        expiresAt: 2,
        source: "clerk",
        clerkUserId: "user_clerk_123",
      }),
      loadUser: async () => activeUser,
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.user.role, "OPERATIONS");
    assert.equal(body.user.email, "ops@example.com");
    assert.match(body.accessToken, /^[^.]+\.[^.]+$/);
  } finally {
    if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = originalSecret;
  }
});

test("native session exchange rejects inactive, locked, and customer accounts", async () => {
  for (const user of [
    { ...activeUser, is_active: false },
    { ...activeUser, locked_at: "2026-07-21T10:00:00.000Z" },
    { ...activeUser, role: "CUSTOMER" },
  ]) {
    const response = await exchangeNativeAdminSession({
      getClerkSession: async () => ({
        userId: user.id,
        role: user.role,
        issuedAt: 1,
        expiresAt: 2,
        source: "clerk",
        clerkUserId: "user_clerk_123",
      }),
      loadUser: async () => user,
    });
    assert.equal(response.status, 403);
  }
});
