import assert from "node:assert/strict";
import test from "node:test";

import {
  hasPublicBookingBearerCredential,
  readPublicBookingBearerToken,
} from "@/lib/bookings/publicAccess";

test("mobile booking bearer token is read from Authorization header", () => {
  const request = new Request("https://example.com/api/payments/wipay/start", {
    headers: { authorization: "Bearer mobile-access-token" },
  });

  assert.equal(readPublicBookingBearerToken(request), "mobile-access-token");
  assert.equal(hasPublicBookingBearerCredential(request), true);
});

test("legacy explicit booking access header remains supported", () => {
  const request = new Request("https://example.com/api/payments/wipay/start", {
    headers: { "x-booking-access-token": "legacy-mobile-token" },
  });

  assert.equal(readPublicBookingBearerToken(request), "legacy-mobile-token");
});

test("empty or malformed bearer credentials are rejected", () => {
  assert.equal(hasPublicBookingBearerCredential(new Request("https://example.com")), false);
  assert.equal(
    hasPublicBookingBearerCredential(new Request("https://example.com", { headers: { authorization: "Basic abc" } })),
    false,
  );
});
