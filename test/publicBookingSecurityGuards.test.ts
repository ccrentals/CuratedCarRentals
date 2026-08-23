import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("public booking pages use shared booking-access enforcement", () => {
  const files = [
    "src/app/(site)/bookings/[id]/page.tsx",
    "src/app/(site)/bookings/[id]/pay/page.tsx",
    "src/app/(site)/bookings/[id]/balance/page.tsx",
    "src/app/(site)/bookings/[id]/invoice/page.tsx",
    "src/app/(site)/payment/success/page.tsx",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /hasPublicBookingAccessForPage\(/);
  }
});

test("public booking pages accept reusable signed email links without relying on cookies", () => {
  const access = read("src/lib/bookings/publicAccess.ts");
  assert.match(access, /hasMatchingBookingEmailAccessSignature\(signature, bookingId, expectedHash\)/);

  const files = [
    "src/app/(site)/bookings/[id]/page.tsx",
    "src/app/(site)/bookings/[id]/pay/page.tsx",
    "src/app/(site)/bookings/[id]/balance/page.tsx",
    "src/app/(site)/bookings/[id]/invoice/page.tsx",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /typeof query\.sig === "string" \? query\.sig : null/);
    assert.match(code, /bookingAccess\.pricing_json,\s*signature,/);
  }
});

test("payment success page denies missing or unauthorized booking access", () => {
  const code = read("src/app/(site)/payment/success/page.tsx");
  assert.match(code, /if \(!bookingAccess\) {\s*notFound\(\);/);
  assert.match(code, /if \(!isAuthorized\) {\s*notFound\(\);/);
});

test("public booking mutation routes use shared booking-access enforcement", () => {
  const files = [
    "src/app/api/public/bookings/[id]/private-files/[documentType]/route.ts",
    "src/app/api/public/bookings/[id]/promo/route.ts",
    "src/app/api/public/bookings/[id]/pay-on-pickup/route.ts",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /hasPublicBookingAccessForRequest\(/);
  }
});

test("public booking creation uses submission-key idempotency guard", () => {
  const code = read("src/app/api/public/bookings/implementation.ts");
  assert.match(code, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(code, /public_submit_key_hash/);
  assert.match(code, /createBookingAccessToken\(submissionKey\)/);
});

test("public payment initiation is Stripe-only and uses the shared idempotent start helper", () => {
  const legacyRouteFiles = [
    "src/app/api/payments/wipay/start/route.ts",
    "src/app/api/payments/wipay/full/start/route.ts",
    "src/app/api/payments/wipay/custom/start/route.ts",
    "src/app/api/payments/wipay/balance/start/route.ts",
  ];

  for (const file of legacyRouteFiles) {
    assert.equal(fs.existsSync(path.join(process.cwd(), file)), false);
  }

  const route = read("src/app/api/payments/start/route.ts");
  assert.match(route, /startPublicPayment\(/);

  const helper = read("src/lib/payments/publicPaymentStart.ts");
  assert.match(helper, /status = 'INITIATED'/);
  assert.match(helper, /hosted_page_url/);
  assert.match(helper, /payment_in_progress/);
  assert.match(helper, /getPublicPaymentProvider\(paymentRequestUrl\)/);
  assert.doesNotMatch(helper, /WIPAY|buildRequestParams|requestHostedPageUrl/);
});
