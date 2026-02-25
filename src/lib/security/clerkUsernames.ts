type ClerkError = {
  errors?: Array<{
    code?: string;
    meta?: {
      paramName?: string;
    };
  }>;
};

const CLERK_USERNAME_MIN_LENGTH = 3;
const CLERK_USERNAME_MAX_LENGTH = 32;

function normalizeRaw(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");
}

export function normalizeUsernameForClerk(value: string) {
  const normalized = normalizeRaw(value);
  if (!normalized) {
    return "";
  }

  const clipped = normalized.slice(0, CLERK_USERNAME_MAX_LENGTH);
  if (clipped.length >= CLERK_USERNAME_MIN_LENGTH) {
    return clipped;
  }

  return clipped.padEnd(CLERK_USERNAME_MIN_LENGTH, "0");
}

function pushCandidate(target: string[], candidate: string) {
  if (!candidate) {
    return;
  }
  if (!target.includes(candidate)) {
    target.push(candidate);
  }
}

export function buildClerkUsernameCandidates({
  localUsername,
  email,
  localUserId,
}: {
  localUsername: string | null | undefined;
  email: string;
  localUserId: string;
}) {
  const candidates: string[] = [];
  const suffix = localUserId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase();

  const localBase = normalizeUsernameForClerk(localUsername ?? "");
  pushCandidate(candidates, localBase);
  if (localBase && suffix) {
    pushCandidate(candidates, normalizeUsernameForClerk(`${localBase}-${suffix}`));
  }

  const emailLocalPart = email.split("@")[0] ?? "";
  const emailBase = normalizeUsernameForClerk(emailLocalPart);
  pushCandidate(candidates, emailBase);
  if (emailBase && suffix) {
    pushCandidate(candidates, normalizeUsernameForClerk(`${emailBase}-${suffix}`));
  }

  if (suffix) {
    pushCandidate(candidates, normalizeUsernameForClerk(`user-${suffix}`));
  }

  return candidates;
}

export function isClerkUsernameError(error: unknown) {
  const details = (error as ClerkError | null)?.errors ?? [];
  return details.some((issue) => {
    const code = String(issue?.code ?? "").toLowerCase();
    const paramName = String(issue?.meta?.paramName ?? "").toLowerCase();
    return code.includes("username") || paramName === "username";
  });
}

export function isClerkPasswordPolicyError(error: unknown) {
  const details = (error as ClerkError | null)?.errors ?? [];
  return details.some((issue) => {
    const code = String(issue?.code ?? "").toLowerCase();
    const paramName = String(issue?.meta?.paramName ?? "").toLowerCase();
    return code.includes("password") || paramName === "password";
  });
}
