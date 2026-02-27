import assert from "node:assert/strict";
import test from "node:test";

import { isQuoteExpired, resolveEffectiveQuoteStatus } from "@/lib/quotes/lifecycle";

test("isQuoteExpired: returns true only when now is after expires_at", () => {
  const expiresAt = "2026-03-01T00:00:00.000Z";

  assert.equal(isQuoteExpired(expiresAt, new Date("2026-03-01T00:00:00.000Z")), false);
  assert.equal(isQuoteExpired(expiresAt, new Date("2026-03-01T00:00:00.001Z")), true);
  assert.equal(isQuoteExpired(null, new Date("2026-03-01T00:00:00.001Z")), false);
});

test("resolveEffectiveQuoteStatus: expires draft/sent/accepted quotes but keeps terminal statuses", () => {
  const now = new Date("2026-04-01T12:00:00.000Z");
  const expiredAt = "2026-03-01T00:00:00.000Z";

  assert.equal(resolveEffectiveQuoteStatus("DRAFT", expiredAt, now), "EXPIRED");
  assert.equal(resolveEffectiveQuoteStatus("SENT", expiredAt, now), "EXPIRED");
  assert.equal(resolveEffectiveQuoteStatus("ACCEPTED", expiredAt, now), "EXPIRED");
  assert.equal(resolveEffectiveQuoteStatus("CONVERTED", expiredAt, now), "CONVERTED");
  assert.equal(resolveEffectiveQuoteStatus("CANCELLED", expiredAt, now), "CANCELLED");
});

test("resolveEffectiveQuoteStatus: invalid expires_at does not force expiry", () => {
  assert.equal(resolveEffectiveQuoteStatus("SENT", "invalid-date", new Date("2026-04-01T12:00:00.000Z")), "SENT");
});

