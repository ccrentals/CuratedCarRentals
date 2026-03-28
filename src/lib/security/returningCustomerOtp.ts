import { createHash } from "node:crypto";

function normalizedReturningCustomerOtpSecret() {
  return process.env.RETURNING_CUSTOMER_OTP_SECRET?.trim() || "";
}

function returningCustomerOtpSecret() {
  const secret = normalizedReturningCustomerOtpSecret();
  if (!secret) {
    throw new Error("RETURNING_CUSTOMER_OTP_SECRET_MISSING");
  }
  return secret;
}

export function isReturningCustomerOtpConfigured() {
  return normalizedReturningCustomerOtpSecret().length > 0;
}

export function hashReturningCustomerOtp(token: string, otpCode: string) {
  return createHash("sha256")
    .update(`${token}:${otpCode}:${returningCustomerOtpSecret()}`)
    .digest("hex");
}
