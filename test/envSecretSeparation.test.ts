import assert from "node:assert/strict";
import test from "node:test";

import { validateEnv } from "@/lib/env";
import { getHealthSnapshot } from "@/lib/health";

function restoreEnv(key: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

test("env validation surfaces missing RETURNING_CUSTOMER_OTP_SECRET separately", () => {
  const previousOtp = process.env.RETURNING_CUSTOMER_OTP_SECRET;

  delete process.env.RETURNING_CUSTOMER_OTP_SECRET;

  try {
    const env = validateEnv();
    assert.match(env.publicRecovery.missing.join(","), /RETURNING_CUSTOMER_OTP_SECRET/);
  } finally {
    restoreEnv("RETURNING_CUSTOMER_OTP_SECRET", previousOtp);
  }
});

test("health snapshot is not ok when RETURNING_CUSTOMER_OTP_SECRET is missing", async () => {
  const previousOtp = process.env.RETURNING_CUSTOMER_OTP_SECRET;
  const previousDb = process.env.DATABASE_URL;
  const previousAdmin = process.env.ADMIN_SESSION_SECRET;
  const previousSite = process.env.SITE_URL;
  const previousCsrf = process.env.CSRF_SECRET;

  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
  process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "admin-session-secret";
  process.env.SITE_URL = process.env.SITE_URL || "https://example.com";
  process.env.CSRF_SECRET = process.env.CSRF_SECRET || "csrf-secret";
  delete process.env.RETURNING_CUSTOMER_OTP_SECRET;

  try {
    const snapshot = await getHealthSnapshot();
    assert.equal(snapshot.env.publicRecovery.missing.includes("RETURNING_CUSTOMER_OTP_SECRET"), true);
    assert.equal(snapshot.ok, false);
  } finally {
    restoreEnv("RETURNING_CUSTOMER_OTP_SECRET", previousOtp);
    restoreEnv("DATABASE_URL", previousDb);
    restoreEnv("ADMIN_SESSION_SECRET", previousAdmin);
    restoreEnv("SITE_URL", previousSite);
    restoreEnv("CSRF_SECRET", previousCsrf);
  }
});
