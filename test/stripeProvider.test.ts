import assert from "node:assert/strict";
import test from "node:test";

import { getPublicPaymentProvider, isStripeTestMode } from "../src/lib/payments/provider";
import { toStripeJmdMinorUnits } from "../src/lib/payments/stripe";

const saved = { ...process.env };
function setEnv(values: Record<string, string | undefined>) {
  for (const key of ["PAYMENT_PROVIDER", "STRIPE_TEST_MODE", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "CONTEXT", "NETLIFY_CONTEXT", "BRANCH", "NODE_ENV"]) delete process.env[key];
  Object.assign(process.env, values);
}
test.after(() => { process.env = saved; });

test("JMD Checkout uses the database's JMD minor units unchanged", () => {
  assert.equal(toStripeJmdMinorUnits(700000), 700000);
  assert.throws(() => toStripeJmdMinorUnits(0));
  assert.throws(() => toStripeJmdMinorUnits(12.5));
});

test("Stripe is enabled only for staging with a test key", () => {
  setEnv({ PAYMENT_PROVIDER: "stripe", STRIPE_TEST_MODE: "true", STRIPE_SECRET_KEY: "sk_test_example", STRIPE_WEBHOOK_SECRET: "whsec_example", BRANCH: "staging", NODE_ENV: "production" });
  assert.equal(isStripeTestMode(), true);
  assert.equal(getPublicPaymentProvider(), "STRIPE");
  setEnv({ PAYMENT_PROVIDER: "stripe", STRIPE_TEST_MODE: "true", STRIPE_SECRET_KEY: "sk_live_example", BRANCH: "staging" });
  assert.throws(() => getPublicPaymentProvider());
  setEnv({ PAYMENT_PROVIDER: "stripe", STRIPE_TEST_MODE: "true", STRIPE_SECRET_KEY: "sk_test_example", CONTEXT: "production" });
  assert.throws(() => getPublicPaymentProvider());
});

test("Stripe accepts a test key with harmless environment whitespace", () => {
  setEnv({
    PAYMENT_PROVIDER: "stripe",
    BRANCH: "staging",
    CONTEXT: "branch-deploy",
    STRIPE_TEST_MODE: "true",
    STRIPE_SECRET_KEY: "  sk_test_example  ",
  });
  assert.equal(getPublicPaymentProvider(), "STRIPE");
});

test("WiPay remains the safe default", () => {
  setEnv({ PAYMENT_PROVIDER: undefined });
  assert.equal(getPublicPaymentProvider(), "WIPAY");
});
