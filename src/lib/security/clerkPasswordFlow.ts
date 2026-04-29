type ClerkErrorShape = {
  errors?: Array<{
    code?: string;
    message?: string;
    longMessage?: string;
  }>;
  message?: string;
};

function collectErrorCodes(error: unknown) {
  const details = (error as ClerkErrorShape | null)?.errors;
  if (!Array.isArray(details)) {
    return [];
  }

  return details
    .map((item) => (typeof item?.code === "string" ? item.code.trim().toLowerCase() : ""))
    .filter(Boolean);
}

function hasCodeFragment(codes: string[], fragment: string) {
  return codes.some((code) => code.includes(fragment));
}

function firstSafeClerkMessage(error: unknown) {
  const details = (error as ClerkErrorShape | null)?.errors;
  if (!Array.isArray(details)) {
    return "";
  }

  for (const issue of details) {
    const candidate =
      typeof issue?.longMessage === "string"
        ? issue.longMessage.trim()
        : typeof issue?.message === "string"
          ? issue.message.trim()
          : "";
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

export function mapClerkPasswordResetError(error: unknown) {
  const codes = collectErrorCodes(error);

  if (
    hasCodeFragment(codes, "pwn") ||
    hasCodeFragment(codes, "compromised") ||
    codes.includes("form_password_pwned")
  ) {
    return "That password has appeared in a breach. Choose a different password.";
  }

  if (
    hasCodeFragment(codes, "password") &&
    (hasCodeFragment(codes, "weak") ||
      hasCodeFragment(codes, "strong") ||
      hasCodeFragment(codes, "short") ||
      hasCodeFragment(codes, "length") ||
      hasCodeFragment(codes, "strength"))
  ) {
    return "Password is too weak. Use at least 8 characters with a mix of letters and numbers.";
  }

  if (
    hasCodeFragment(codes, "code") &&
    (hasCodeFragment(codes, "expired") ||
      hasCodeFragment(codes, "incorrect") ||
      hasCodeFragment(codes, "invalid"))
  ) {
    return "The reset code is invalid or expired. Request a new code and try again.";
  }

  if (hasCodeFragment(codes, "too_many")) {
    return "Too many attempts. Wait a moment, then request a new code.";
  }

  return (
    firstSafeClerkMessage(error) ||
    "We could not reset your password right now. Please try again."
  );
}

export function mapClerkAccountSetupError(error: unknown) {
  const codes = collectErrorCodes(error);

  if (
    hasCodeFragment(codes, "pwn") ||
    hasCodeFragment(codes, "compromised") ||
    codes.includes("form_password_pwned")
  ) {
    return "That password has appeared in a breach. Choose a different password.";
  }

  if (
    hasCodeFragment(codes, "password") &&
    (hasCodeFragment(codes, "weak") ||
      hasCodeFragment(codes, "strong") ||
      hasCodeFragment(codes, "short") ||
      hasCodeFragment(codes, "length") ||
      hasCodeFragment(codes, "strength"))
  ) {
    return "Password is too weak. Use at least 8 characters with a stronger mix of characters.";
  }

  if (hasCodeFragment(codes, "identifier") && hasCodeFragment(codes, "exists")) {
    return "An account for this email already exists in Clerk but could not be linked automatically. Contact an administrator.";
  }

  if (hasCodeFragment(codes, "username")) {
    return "The account could not be provisioned because the username could not be accepted by Clerk. Contact an administrator.";
  }

  if (hasCodeFragment(codes, "too_many")) {
    return "Too many attempts. Wait a moment and try account setup again.";
  }

  return (
    firstSafeClerkMessage(error) ||
    (typeof (error as { message?: unknown } | null)?.message === "string"
      ? String((error as { message?: unknown } | null)?.message).trim()
      : "") ||
    "We could not complete account setup right now. Please try again."
  );
}
