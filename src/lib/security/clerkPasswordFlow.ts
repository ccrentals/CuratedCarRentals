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

  return "We could not reset your password right now. Please try again.";
}
