import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClerkUsernameCandidates,
  isClerkSafeUsernameInput,
  isClerkPasswordPolicyError,
  isClerkUsernameError,
  normalizeUsernameForClerk,
} from "@/lib/security/clerkUsernames";

test("normalizeUsernameForClerk: normalizes unsupported local username characters", () => {
  assert.equal(normalizeUsernameForClerk("First.Last"), "first-last");
  assert.equal(normalizeUsernameForClerk("  __A__  "), "a00");
  assert.equal(normalizeUsernameForClerk(""), "");
});

test("buildClerkUsernameCandidates: produces deterministic unique candidates", () => {
  const candidates = buildClerkUsernameCandidates({
    localUsername: "john.smith",
    email: "john.smith@example.com",
    localUserId: "7df2de53-30c2-4dcf-a5b2-a3e3ca9f15f3",
  });

  assert.deepEqual(candidates, [
    "john-smith",
    "john-smith-7df2de",
    "user-7df2de",
  ]);
});

test("clerk error helpers: identify username/password issues", () => {
  assert.equal(
    isClerkUsernameError({
      errors: [{ code: "form_username_invalid_character", meta: { paramName: "username" } }],
    }),
    true,
  );
  assert.equal(
    isClerkPasswordPolicyError({
      errors: [{ code: "form_password_pwned", meta: { paramName: "password" } }],
    }),
    true,
  );
  assert.equal(
    isClerkUsernameError({
      errors: [{ code: "form_identifier_not_found", meta: { paramName: "identifier" } }],
    }),
    false,
  );
});

test("isClerkSafeUsernameInput: rejects dot-style usernames and accepts Clerk-safe ones", () => {
  assert.equal(isClerkSafeUsernameInput("theredo-johnson"), true);
  assert.equal(isClerkSafeUsernameInput("crentals"), true);
  assert.equal(isClerkSafeUsernameInput("theredo.johnson"), false);
});
