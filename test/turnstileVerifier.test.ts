import assert from "node:assert/strict";
import test from "node:test";

import { verifyTurnstileToken } from "@/lib/security/turnstile";
import { TURNSTILE_DEV_BYPASS_TOKEN } from "@/lib/security/turnstileShared";

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test("turnstile verifier: local dev bypass works regardless of key configuration", { concurrency: false }, async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalBypass = process.env.TURNSTILE_DEV_BYPASS;
  const originalFetch = globalThis.fetch;

  try {
    setEnv("NODE_ENV", "development");
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    setEnv("TURNSTILE_SECRET_KEY", "secret-key");
    setEnv("TURNSTILE_DEV_BYPASS", "1");
    globalThis.fetch = (async () => {
      throw new Error("fetch should not be called during bypass");
    }) as typeof fetch;

    const result = await verifyTurnstileToken({
      token: TURNSTILE_DEV_BYPASS_TOKEN,
      expectedAction: "public_contact",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.bypassed, true);
    }
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    setEnv("TURNSTILE_DEV_BYPASS", originalBypass);
    globalThis.fetch = originalFetch;
  }
});

test("turnstile verifier: production ignores bypass flag and still requires token", { concurrency: false }, async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalBypass = process.env.TURNSTILE_DEV_BYPASS;
  const originalFetch = globalThis.fetch;

  try {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    setEnv("TURNSTILE_SECRET_KEY", "secret-key");
    setEnv("TURNSTILE_DEV_BYPASS", "1");
    globalThis.fetch = (async () => {
      throw new Error("fetch should not run when token is missing");
    }) as typeof fetch;

    const result = await verifyTurnstileToken({
      token: "",
      expectedAction: "public_contact",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.errorCodes.includes("missing_input_response"), true);
    }
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    setEnv("TURNSTILE_DEV_BYPASS", originalBypass);
    globalThis.fetch = originalFetch;
  }
});

test("turnstile verifier: dev mode without bypass flag still fails closed when keys are missing", { concurrency: false }, async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalBypass = process.env.TURNSTILE_DEV_BYPASS;

  try {
    setEnv("NODE_ENV", "development");
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);
    setEnv("TURNSTILE_SECRET_KEY", undefined);
    setEnv("TURNSTILE_DEV_BYPASS", undefined);

    const result = await verifyTurnstileToken({
      token: TURNSTILE_DEV_BYPASS_TOKEN,
      expectedAction: "public_booking",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
      assert.equal(result.errorCodes.includes("turnstile_not_configured"), true);
    }
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    setEnv("TURNSTILE_DEV_BYPASS", originalBypass);
  }
});

test("turnstile verifier: fails closed in production when keys are missing", { concurrency: false }, async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalBypass = process.env.TURNSTILE_DEV_BYPASS;

  try {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);
    setEnv("TURNSTILE_SECRET_KEY", undefined);
    setEnv("TURNSTILE_DEV_BYPASS", "1");

    const result = await verifyTurnstileToken({
      token: "missing-config-token",
      expectedAction: "public_booking",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
      assert.equal(result.errorCodes.includes("turnstile_not_configured"), true);
    }
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    setEnv("TURNSTILE_DEV_BYPASS", originalBypass);
  }
});

test("turnstile verifier: accepts valid Siteverify response", { concurrency: false }, async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = globalThis.fetch;
  let calls = 0;

  try {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    setEnv("TURNSTILE_SECRET_KEY", "secret-key");
    globalThis.fetch = (async (input) => {
      calls += 1;
      assert.equal(String(input), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      return new Response(
        JSON.stringify({
          success: true,
          action: "public_booking",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await verifyTurnstileToken({
      token: "valid-token",
      remoteIp: "203.0.113.10",
      expectedAction: "public_booking",
    });

    assert.equal(calls, 1);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.bypassed, false);
    }
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});

test("turnstile verifier: rejects failed Siteverify response", { concurrency: false }, async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = globalThis.fetch;

  try {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    setEnv("TURNSTILE_SECRET_KEY", "secret-key");
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          "error-codes": ["timeout-or-duplicate"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const result = await verifyTurnstileToken({
      token: "stale-token",
      expectedAction: "public_contact",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.errorCodes.includes("timeout-or-duplicate"), true);
    }
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});

test("turnstile verifier: rejects when token is missing", { concurrency: false }, async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = globalThis.fetch;

  try {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    setEnv("TURNSTILE_SECRET_KEY", "secret-key");
    globalThis.fetch = (async () => {
      throw new Error("fetch should not run when token is missing");
    }) as typeof fetch;

    const result = await verifyTurnstileToken({
      token: "",
      expectedAction: "public_contact",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.errorCodes.includes("missing_input_response"), true);
    }
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});

test("turnstile verifier: rejects action mismatch", { concurrency: false }, async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = globalThis.fetch;

  try {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    setEnv("TURNSTILE_SECRET_KEY", "secret-key");
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          action: "public_contact",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const result = await verifyTurnstileToken({
      token: "valid-token",
      expectedAction: "public_booking",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.errorCodes.includes("turnstile_action_mismatch"), true);
    }
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});
