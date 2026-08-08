import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWiPayAvailable,
  getPublicPaymentProvider,
  getStripePaymentMode,
  isStripeLiveMode,
  isStripeTestMode,
} from "../src/lib/payments/provider";
import { toStripeJmdMinorUnits } from "../src/lib/payments/stripe";

const saved = { ...process.env };
function setEnv(values: Record<string, string | undefined>) {
  for (const key of ["PAYMENT_PROVIDER", "STRIPE_TEST_MODE", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "CONTEXT", "NETLIFY_CONTEXT", "BRANCH", "NODE_ENV", "NEXT_PUBLIC_SITE_ENV", "SITE_URL"]) delete process.env[key];
  Object.assign(process.env, values);
}
test.after(() => { process.env = saved; });

test("JMD Checkout converts whole-JMD booking amounts into Stripe minor units", () => {
  assert.equal(toStripeJmdMinorUnits(7000), 700000);
  assert.equal(toStripeJmdMinorUnits(20000), 2000000);
  assert.throws(() => toStripeJmdMinorUnits(0));
  assert.throws(() => toStripeJmdMinorUnits(12.5));
  assert.throws(() => toStripeJmdMinorUnits(Number.MAX_SAFE_INTEGER));
});

test("Stripe is enabled for staging with a test key", () => {
  setEnv({ PAYMENT_PROVIDER: "stripe", STRIPE_TEST_MODE: "true", STRIPE_SECRET_KEY: "sk_test_example", STRIPE_WEBHOOK_SECRET: "whsec_example", BRANCH: "staging", NODE_ENV: "production" });
  assert.equal(isStripeTestMode(), true);
  assert.equal(getPublicPaymentProvider(), "STRIPE");
  setEnv({ PAYMENT_PROVIDER: "stripe", STRIPE_TEST_MODE: "true", STRIPE_SECRET_KEY: "sk_live_example", BRANCH: "staging" });
  assert.throws(() => getPublicPaymentProvider());
  setEnv({ PAYMENT_PROVIDER: "stripe", STRIPE_TEST_MODE: "true", STRIPE_SECRET_KEY: "sk_test_example", CONTEXT: "production" });
  assert.throws(() => getPublicPaymentProvider());
});

test("Stripe is enabled for production only with a live key", () => {
  setEnv({ PAYMENT_PROVIDER: "stripe", STRIPE_TEST_MODE: "false", STRIPE_SECRET_KEY: "sk_live_example", STRIPE_WEBHOOK_SECRET: "whsec_example", CONTEXT: "production" });
  assert.equal(isStripeLiveMode(), true);
  assert.equal(getStripePaymentMode(), "live");
  assert.equal(getPublicPaymentProvider(), "STRIPE");

  setEnv({ PAYMENT_PROVIDER: "stripe", STRIPE_TEST_MODE: "true", STRIPE_SECRET_KEY: "sk_test_example", STRIPE_WEBHOOK_SECRET: "whsec_example", CONTEXT: "production" });
  assert.throws(() => getPublicPaymentProvider(), /requires STRIPE_TEST_MODE=false/);
});

test("Stripe recognizes the production branch when Netlify runtime context is unavailable", () => {
  setEnv({
    PAYMENT_PROVIDER: "stripe",
    STRIPE_TEST_MODE: "false",
    STRIPE_SECRET_KEY: "sk_live_example",
    STRIPE_WEBHOOK_SECRET: "whsec_example",
    SITE_URL: "https://curatedcarrentals.com",
    BRANCH: "main",
  });

  assert.equal(getPublicPaymentProvider(), "STRIPE");
});

test("Stripe accepts a test key with harmless environment whitespace", () => {
  setEnv({
    PAYMENT_PROVIDER: "stripe",
    CONTEXT: "branch-deploy",
    SITE_URL: "https://staging--ccrentals.netlify.app",
    STRIPE_TEST_MODE: "true",
    STRIPE_SECRET_KEY: "  sk_test_example  ",
  });
  assert.equal(getPublicPaymentProvider(), "STRIPE");
});

test("Stripe recognizes the exact staging request host when runtime deploy variables are unavailable", () => {
  setEnv({
    PAYMENT_PROVIDER: "stripe",
    STRIPE_TEST_MODE: "true",
    STRIPE_SECRET_KEY: "sk_test_example",
  });
  assert.equal(
    getPublicPaymentProvider("https://staging--ccrentals.netlify.app/api/payments/start"),
    "STRIPE",
  );
});

test("Stripe rejects a non-staging deployment even when a public environment marker is set", () => {
  setEnv({
    PAYMENT_PROVIDER: "stripe",
    STRIPE_TEST_MODE: " true ",
    STRIPE_SECRET_KEY: "sk_test_example",
    NEXT_PUBLIC_SITE_ENV: "staging",
  });
  assert.throws(() => getPublicPaymentProvider());
});

test("WiPay remains the safe default", () => {
  setEnv({ PAYMENT_PROVIDER: undefined });
  assert.equal(getPublicPaymentProvider(), "WIPAY");
});

test("staging cannot fall back to WiPay or call legacy WiPay payment routes", () => {
  setEnv({
    PAYMENT_PROVIDER: undefined,
    CONTEXT: "branch-deploy",
    SITE_URL: "https://staging--ccrentals.netlify.app",
  });
  assert.throws(() => getPublicPaymentProvider(), /WiPay is disabled/);
  assert.throws(() => assertWiPayAvailable(), /WiPay is disabled/);
});

test("Stripe rejects other Netlify branch deploys", () => {
  setEnv({
    PAYMENT_PROVIDER: "stripe",
    CONTEXT: "branch-deploy",
    SITE_URL: "https://feature--ccrentals.netlify.app",
    STRIPE_TEST_MODE: "true",
    STRIPE_SECRET_KEY: "sk_test_example",
  });
  assert.throws(() => getPublicPaymentProvider(), /only for the staging or production deployment/);
});
