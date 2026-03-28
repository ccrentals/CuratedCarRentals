import assert from "node:assert/strict";
import test from "node:test";

import {
  hashReturningCustomerOtp,
  isReturningCustomerOtpConfigured,
} from "@/lib/security/returningCustomerOtp";

test("returning-customer OTP helper uses only RETURNING_CUSTOMER_OTP_SECRET", () => {
  const previousOtp = process.env.RETURNING_CUSTOMER_OTP_SECRET;
  const previousCsrf = process.env.CSRF_SECRET;
  const previousAdmin = process.env.ADMIN_SESSION_SECRET;

  process.env.RETURNING_CUSTOMER_OTP_SECRET = "otp-secret-a";
  process.env.CSRF_SECRET = "csrf-secret";
  process.env.ADMIN_SESSION_SECRET = "admin-secret";

  try {
    const first = hashReturningCustomerOtp("challenge", "123456");
    process.env.CSRF_SECRET = "different-csrf-secret";
    process.env.ADMIN_SESSION_SECRET = "different-admin-secret";
    const second = hashReturningCustomerOtp("challenge", "123456");
    assert.equal(first, second);
  } finally {
    if (previousOtp === undefined) delete process.env.RETURNING_CUSTOMER_OTP_SECRET;
    else process.env.RETURNING_CUSTOMER_OTP_SECRET = previousOtp;
    if (previousCsrf === undefined) delete process.env.CSRF_SECRET;
    else process.env.CSRF_SECRET = previousCsrf;
    if (previousAdmin === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previousAdmin;
  }
});

test("returning-customer OTP helper fails closed when dedicated secret is missing", () => {
  const previousOtp = process.env.RETURNING_CUSTOMER_OTP_SECRET;
  const previousCsrf = process.env.CSRF_SECRET;
  const previousAdmin = process.env.ADMIN_SESSION_SECRET;

  delete process.env.RETURNING_CUSTOMER_OTP_SECRET;
  process.env.CSRF_SECRET = "csrf-secret";
  process.env.ADMIN_SESSION_SECRET = "admin-secret";

  try {
    assert.equal(isReturningCustomerOtpConfigured(), false);
    assert.throws(
      () => hashReturningCustomerOtp("challenge", "123456"),
      /RETURNING_CUSTOMER_OTP_SECRET_MISSING/,
    );
  } finally {
    if (previousOtp === undefined) delete process.env.RETURNING_CUSTOMER_OTP_SECRET;
    else process.env.RETURNING_CUSTOMER_OTP_SECRET = previousOtp;
    if (previousCsrf === undefined) delete process.env.CSRF_SECRET;
    else process.env.CSRF_SECRET = previousCsrf;
    if (previousAdmin === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previousAdmin;
  }
});
