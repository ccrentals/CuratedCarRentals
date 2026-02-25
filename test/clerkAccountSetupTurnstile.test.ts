import assert from "node:assert/strict";
import test from "node:test";

import { POST as postClerkAccountSetup } from "@/app/api/public/auth/clerk-account-setup/route";

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test("clerk account setup blocks missing turnstile token", { concurrency: false }, async () => {
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

    const response = await postClerkAccountSetup(
      new Request("http://localhost/api/public/auth/clerk-account-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com" }),
      }),
    );

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Please complete the security check and try again.");
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});

test("clerk account setup accepts valid turnstile and continues request validation", { concurrency: false }, async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = globalThis.fetch;
  let calls = 0;

  try {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    setEnv("TURNSTILE_SECRET_KEY", "secret-key");
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          success: true,
          action: "public_clerk_account_setup",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const response = await postClerkAccountSetup(
      new Request("http://localhost/api/public/auth/clerk-account-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "invalid-email",
          turnstileToken: "valid-token",
        }),
      }),
    );

    assert.equal(calls, 1);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Enter a valid email address.");
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});
