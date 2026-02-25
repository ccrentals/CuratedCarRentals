import assert from "node:assert/strict";
import test from "node:test";

import { POST as postReturningStart } from "@/app/api/public/returning-customer/start/route";
import { POST as postReturningVerify } from "@/app/api/public/returning-customer/verify/route";

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test("returning-customer/start blocks missing turnstile token", { concurrency: false }, async () => {
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

    const response = await postReturningStart(
      new Request("http://localhost/api/public/returning-customer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driversLicenseNumber: "ABCD1234",
          sessionKey: "session-1",
        }),
      }),
    );

    assert.equal(response.status, 400);
    const body = (await response.json()) as { ok?: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "Please complete the security check and try again.");
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});

test("returning-customer/start accepts valid turnstile verification", { concurrency: false }, async () => {
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
          action: "public_returning_customer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    // Short license triggers early generic validation response after turnstile success.
    const response = await postReturningStart(
      new Request("http://localhost/api/public/returning-customer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driversLicenseNumber: "A",
          sessionKey: "session-1",
          turnstileToken: "valid-token",
        }),
      }),
    );

    assert.equal(calls, 1);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { ok?: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "We couldn't verify your details.");
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});

test("returning-customer/verify blocks missing turnstile token", { concurrency: false }, async () => {
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

    const response = await postReturningVerify(
      new Request("http://localhost/api/public/returning-customer/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driversLicenseNumber: "ABCD1234",
          sessionKey: "session-1",
          challengeToken: "token",
          otpCode: "123456",
        }),
      }),
    );

    assert.equal(response.status, 400);
    const body = (await response.json()) as { ok?: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "Please complete the security check and try again.");
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});

test("returning-customer/verify accepts valid turnstile verification", { concurrency: false }, async () => {
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
          action: "public_returning_customer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    // Short license triggers early generic validation response after turnstile success.
    const response = await postReturningVerify(
      new Request("http://localhost/api/public/returning-customer/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driversLicenseNumber: "A",
          sessionKey: "session-1",
          challengeToken: "token",
          otpCode: "123456",
          turnstileToken: "valid-token",
        }),
      }),
    );

    assert.equal(calls, 1);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { ok?: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "We couldn't verify your details.");
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});
