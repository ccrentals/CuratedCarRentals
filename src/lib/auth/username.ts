import { normalizeUsernameForClerk } from "@/lib/security/clerkUsernames";

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

function stripDiacritics(value: string) {
  return value.normalize("NFKD").replace(COMBINING_MARKS_RE, "");
}

function sanitizeToUsernameCharset(value: string) {
  return normalizeUsernameForClerk(stripDiacritics(value));
}

function ensureMinLength(base: string, fallbackSeed: string) {
  const normalizedBase = normalizeNamePart(base) || "user";
  if (normalizedBase.length >= USERNAME_MIN_LENGTH) {
    return normalizedBase.slice(0, USERNAME_MAX_LENGTH);
  }

  const fallback = normalizeNamePart(fallbackSeed) || "user";
  let combined = `${normalizedBase}${fallback}`;
  if (combined.length < USERNAME_MIN_LENGTH) {
    combined = `${combined}000`;
  }
  return combined.slice(0, USERNAME_MAX_LENGTH);
}

function splitFullName(fullName: string) {
  const parts = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length < 1) {
    return { firstName: "", lastName: "" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: parts[0] };
  }

  return {
    firstName: parts[0],
    lastName: parts[parts.length - 1],
  };
}

function sanitizeEmailLocalPart(email: string) {
  const localPart = String(email ?? "")
    .trim()
    .split("@")[0];
  return normalizeNamePart(localPart);
}

export function normalizeNamePart(str: string) {
  return sanitizeToUsernameCharset(String(str ?? ""));
}

export function generateBaseUsername(firstName: string, lastName: string) {
  const normalizedFirst = normalizeNamePart(firstName);
  const normalizedLast = normalizeNamePart(lastName);
  const firstInitial = normalizedFirst.slice(0, 1);
  const base = `${firstInitial}${normalizedLast}` || normalizedLast || normalizedFirst || "user";
  return ensureMinLength(base, normalizedLast || normalizedFirst || "user");
}

export function generateStandardUsernameBase(input: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
}) {
  let firstName = String(input.firstName ?? "").trim();
  let lastName = String(input.lastName ?? "").trim();

  if (!firstName || !lastName) {
    const split = splitFullName(String(input.fullName ?? ""));
    if (!firstName) {
      firstName = split.firstName;
    }
    if (!lastName) {
      lastName = split.lastName;
    }
  }

  const normalizedFirst = normalizeNamePart(firstName);
  const normalizedLast = normalizeNamePart(lastName);
  if (normalizedFirst || normalizedLast) {
    return generateBaseUsername(firstName, lastName);
  }

  const emailLocal = sanitizeEmailLocalPart(String(input.email ?? ""));
  if (emailLocal) {
    return ensureMinLength(emailLocal, "user");
  }

  return ensureMinLength("user", "user");
}

export async function resolveUsernameCollision(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
) {
  const seed = ensureMinLength(base, "user");
  if (!(await isTaken(seed))) {
    return seed;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const suffix = String(index);
    const maxSeedLength = Math.max(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH - suffix.length);
    const trimmedSeed = seed.slice(0, maxSeedLength);
    const candidate = `${trimmedSeed}${suffix}`.slice(0, USERNAME_MAX_LENGTH);
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  throw new Error("Unable to resolve a unique username.");
}
