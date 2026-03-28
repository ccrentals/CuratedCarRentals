import assert from "node:assert/strict";
import test from "node:test";

import {
  createBookingAccessToken,
  hashBookingAccessToken,
  hasMatchingBookingAccessToken,
  readBookingAccessHash,
} from "@/lib/bookings/privateAccess";

test("public booking access: matching token satisfies stored booking access hash", () => {
  const token = createBookingAccessToken("submit-key-1234567890");
  const expectedHash = hashBookingAccessToken(token);

  assert.equal(hasMatchingBookingAccessToken(token, expectedHash), true);
  assert.equal(hasMatchingBookingAccessToken("wrong-token", expectedHash), false);
});

test("public booking access: submission-derived token is stable without env secrets", () => {
  const first = createBookingAccessToken("submit-key-1234567890");
  const second = createBookingAccessToken("submit-key-1234567890");

  assert.equal(first, second);
  assert.equal(hashBookingAccessToken(first), hashBookingAccessToken(second));
});

test("public booking access: access hash is read from pricing snapshot only when present", () => {
  assert.equal(
    readBookingAccessHash({ private_access_token_hash: "abc123" }),
    "abc123",
  );
  assert.equal(readBookingAccessHash({}), "");
  assert.equal(readBookingAccessHash(null), "");
});
