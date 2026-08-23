import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "src/app/admin/(protected)/payments/page.tsx"),
  "utf8",
);

test("admin payments page reports Stripe configuration and recent Stripe attempts", () => {
  assert.match(source, /Stripe Diagnostics/);
  assert.match(source, /Latest Stripe Attempts/);
  assert.match(source, /where p\.provider = 'STRIPE'/);
  assert.match(source, /STRIPE_TEST_MODE/);
  assert.match(source, /STRIPE_SECRET_KEY/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET/);
});

test("admin payments page does not relabel historical providers or expose WiPay diagnostics", () => {
  assert.match(source, /if \(provider !== "MANUAL"\) return provider/);
  assert.doesNotMatch(source, /WiPay Diagnostics|Latest WiPay Attempts/i);
  assert.doesNotMatch(source, /WIPAY_ACCOUNT_NUMBER|WIPAY_API_KEY|WIPAY_FEE_STRUCTURE|WIPAY_ORIGIN/);
});
