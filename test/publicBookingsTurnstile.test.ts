import assert from "node:assert/strict";
import test from "node:test";

import { POST as postPublicBooking } from "@/app/api/public/bookings/route";

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test("public bookings API blocks missing turnstile token", { concurrency: false }, async () => {
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

    const response = await postPublicBooking(
      new Request("http://localhost/api/public/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: "invalid-id" }),
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

test("public bookings API accepts valid turnstile and continues request validation", { concurrency: false }, async () => {
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
          action: "public_booking",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const response = await postPublicBooking(
      new Request("http://localhost/api/public/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: "invalid-id",
          turnstileToken: "valid-token",
        }),
      }),
    );

    assert.equal(calls, 1);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Invalid vehicleId");
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});
