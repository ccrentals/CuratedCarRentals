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

test("public bookings API requires production contact details once turnstile passes", { concurrency: false }, async () => {
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
          action: "public_booking",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const response = await postPublicBooking(
      new Request("http://localhost/api/public/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: "11111111-1111-4111-8111-111111111111",
          turnstileToken: "valid-token",
          fullName: "Test Customer",
          email: "",
          phone: "1234567",
          submissionKey: "submission-key-123456",
        }),
      }),
    );

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Valid email is required");
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});

test("public bookings API requires a submission key once turnstile passes", { concurrency: false }, async () => {
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
          action: "public_booking",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const response = await postPublicBooking(
      new Request("http://localhost/api/public/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: "11111111-1111-4111-8111-111111111111",
          turnstileToken: "valid-token",
          fullName: "Test Customer",
          email: "test@example.com",
          phone: "1234567",
          startDate: "2026-03-20",
          endDate: "2026-03-21",
          pickupLocation: "Kingston",
          dropoffLocation: "Kingston",
          signatureDataUrl: "data:image/png;base64,ZmFrZQ==",
          submissionKey: "too-short",
        }),
      }),
    );

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Invalid submission key.");
  } finally {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", originalSiteKey);
    setEnv("TURNSTILE_SECRET_KEY", originalSecret);
    globalThis.fetch = originalFetch;
  }
});
