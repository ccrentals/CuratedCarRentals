import assert from "node:assert/strict";
import test from "node:test";

import { mapClerkPasswordResetError } from "@/lib/security/clerkPasswordFlow";

test("maps invalid or expired reset code errors", () => {
  const message = mapClerkPasswordResetError({
    errors: [{ code: "form_code_incorrect" }],
  });
  assert.equal(
    message,
    "The reset code is invalid or expired. Request a new code and try again.",
  );
});

test("maps weak password errors", () => {
  const message = mapClerkPasswordResetError({
    errors: [{ code: "form_password_not_strong_enough" }],
  });
  assert.equal(
    message,
    "Password is too weak. Use at least 8 characters with a mix of letters and numbers.",
  );
});

test("maps compromised password errors", () => {
  const message = mapClerkPasswordResetError({
    errors: [{ code: "form_password_pwned" }],
  });
  assert.equal(
    message,
    "That password has appeared in a breach. Choose a different password.",
  );
});

test("maps unknown errors to generic retry", () => {
  const message = mapClerkPasswordResetError({
    errors: [{ code: "unexpected_error" }],
  });
  assert.equal(message, "We could not reset your password right now. Please try again.");
});
