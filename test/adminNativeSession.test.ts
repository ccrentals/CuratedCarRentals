import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionToken,
  getNativeAdminSessionFromAuthorization,
  verifyAdminSessionToken,
} from "@/lib/auth/session";
import { requireCsrf } from "@/lib/security/csrf";

test("native admin sessions are audience-bound bearer credentials", { concurrency: false }, () => {
  const originalSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = "native-admin-test-secret-with-sufficient-entropy";

  try {
    const nativeToken = createSessionToken("user-123", "OPERATIONS", "native-admin");
    const browserToken = createSessionToken("user-123", "OPERATIONS", "browser");

    const nativeSession = getNativeAdminSessionFromAuthorization(`Bearer ${nativeToken}`);
    assert.equal(nativeSession?.userId, "user-123");
    assert.equal(nativeSession?.role, "OPERATIONS");
    assert.equal(nativeSession?.source, "native");
    assert.equal(nativeSession?.audience, "native-admin");

    assert.equal(getNativeAdminSessionFromAuthorization(`Bearer ${browserToken}`), null);
    assert.equal(verifyAdminSessionToken(nativeToken, "browser"), null);
    assert.equal(verifyAdminSessionToken(browserToken, "native-admin"), null);
    assert.equal(getNativeAdminSessionFromAuthorization("Basic abc123"), null);
    assert.equal(getNativeAdminSessionFromAuthorization("Bearer tampered.token"), null);
  } finally {
    if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = originalSecret;
  }
});

test("native bearer auth bypasses cookie CSRF without weakening browser tokens", { concurrency: false }, async () => {
  const originalSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = "native-admin-test-secret-with-sufficient-entropy";

  try {
    const nativeToken = createSessionToken("user-123", "ADMIN", "native-admin");
    const request = new Request("https://example.test/api/admin/settings", {
      method: "PATCH",
      headers: { authorization: `Bearer ${nativeToken}` },
    });
    assert.equal(await requireCsrf(request), true);
  } finally {
    if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = originalSecret;
  }
});
