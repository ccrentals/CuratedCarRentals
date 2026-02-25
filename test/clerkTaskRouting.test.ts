import assert from "node:assert/strict";
import test from "node:test";

import {
  CLERK_RESET_PASSWORD_TASK_KEY,
  shouldRedirectToResetPasswordTask,
} from "@/lib/security/clerkTasks";

test("Clerk reset-password task routing only redirects protected routes", () => {
  assert.equal(
    shouldRedirectToResetPasswordTask({
      pathname: "/account",
      taskKey: CLERK_RESET_PASSWORD_TASK_KEY,
    }),
    true,
  );
  assert.equal(
    shouldRedirectToResetPasswordTask({
      pathname: "/admin/bookings",
      taskKey: CLERK_RESET_PASSWORD_TASK_KEY,
    }),
    true,
  );
  assert.equal(
    shouldRedirectToResetPasswordTask({
      pathname: "/task/reset-password",
      taskKey: CLERK_RESET_PASSWORD_TASK_KEY,
    }),
    false,
  );
  assert.equal(
    shouldRedirectToResetPasswordTask({
      pathname: "/forgot-password",
      taskKey: CLERK_RESET_PASSWORD_TASK_KEY,
    }),
    false,
  );
  assert.equal(
    shouldRedirectToResetPasswordTask({
      pathname: "/sign-in",
      taskKey: CLERK_RESET_PASSWORD_TASK_KEY,
    }),
    false,
  );
  assert.equal(
    shouldRedirectToResetPasswordTask({
      pathname: "/account",
      taskKey: null,
    }),
    false,
  );
});
