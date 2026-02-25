export const CLERK_RESET_PASSWORD_TASK_KEY = "reset-password";
export const CLERK_RESET_PASSWORD_TASK_ROUTE = "/task/reset-password";

const RESET_PASSWORD_ALLOWED_PREFIXES = [
  CLERK_RESET_PASSWORD_TASK_ROUTE,
  "/sign-in",
  "/sign-up",
  "/forgot-password",
];

function isAllowedPrefix(pathname: string) {
  return RESET_PASSWORD_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isResetPasswordTask(taskKey: string | null | undefined) {
  return taskKey === CLERK_RESET_PASSWORD_TASK_KEY;
}

export function shouldRedirectToResetPasswordTask({
  pathname,
  taskKey,
}: {
  pathname: string | null | undefined;
  taskKey: string | null | undefined;
}) {
  if (!pathname || !isResetPasswordTask(taskKey)) {
    return false;
  }

  return !isAllowedPrefix(pathname);
}
