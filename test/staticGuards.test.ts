import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("RBAC: dangerous admin routes contain an explicit 403 Forbidden guard", () => {
  const files = [
    "src/app/api/admin/users/route.ts",
    "src/app/api/admin/users/[userId]/route.ts",
    "src/app/api/admin/payments/[paymentId]/route.ts",
    "src/app/api/admin/payments/[paymentId]/refund/route.ts",
    "src/app/api/admin/bookings/[id]/route.ts",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /status:\s*403|{ status: 403 }/);
    assert.match(code, /Forbidden/);
  }
});

test("Idempotency: WiPay webhook uses webhook_events insert gate and short-circuits duplicates", () => {
  const code = read("src/app/api/payments/wipay/webhook/route.ts");
  assert.match(code, /insert into webhook_events/i);
  assert.match(code, /on conflict\s*\(provider,\s*event_id\)\s*do nothing/i);
  assert.match(code, /duplicate/i);
});

test("WiPay callbacks use canonical SITE_URL rather than request-origin fallbacks", () => {
  const returnRoute = read("src/app/api/payments/wipay/return/route.ts");
  const paymentStart = read("src/lib/payments/publicPaymentStart.ts");

  assert.match(returnRoute, /getCanonicalSiteUrl\(/);
  assert.doesNotMatch(returnRoute, /request\.url\)\.origin/);
  assert.doesNotMatch(returnRoute, /SITE_URL\s*\?\?\s*url\.origin/);

  assert.match(paymentStart, /buildCanonicalSiteUrl\(\"\/api\/payments\/wipay\/return\"\)/);
  assert.doesNotMatch(paymentStart, /request\.url\)\.origin/);
});

test("Stripe admin reconciliation uses the forwarded public payment URL", () => {
  const route = read("src/app/api/admin/payments/[paymentId]/reconcile/route.ts");
  assert.match(route, /getPublicPaymentRequestUrl\(request\)/);
  assert.match(route, /getStripeClient\(paymentRequestUrl\)/);
  assert.match(route, /reconcileStripeCheckoutSession\(session, "admin", paymentRequestUrl\)/);
});

test("Stripe refunds use the forwarded public payment URL and are not test-only", () => {
  const route = read("src/app/api/admin/payments/[paymentId]/refund/route.ts");
  assert.match(route, /getPublicPaymentRequestUrl\(request\)/);
  assert.match(route, /getStripeClient\(paymentRequestUrl\)\.refunds\.create/);
  assert.match(route, /stripe-refund-/);
  assert.doesNotMatch(route, /stripe-test-refund|staging_test/);
});

test("Admin logout redirects to canonical SITE_URL rather than the deployment hostname", () => {
  const logoutRoute = read("src/app/api/admin/logout/route.ts");

  assert.match(logoutRoute, /getCanonicalSiteUrl\(\)/);
  assert.match(logoutRoute, /new URL\(redirectUrl, getCanonicalSiteUrl\(\)\)/);
  assert.doesNotMatch(logoutRoute, /new URL\(redirectUrl, request\.url\)/);
});

test("Returning-customer verification accepts stored legal IDs and does not require birthday", () => {
  const startRoute = read("src/app/api/public/returning-customer/start/route.ts");
  const verifyRoute = read("src/app/api/public/returning-customer/verify/route.ts");
  const wizard = read("src/components/booking/PublicBookingWizard.tsx");

  assert.match(startRoute, /legal_id_number/);
  assert.match(verifyRoute, /legal_id_number/);
  assert.match(verifyRoute, /otpCode && lastNameInput/);
  assert.doesNotMatch(verifyRoute, /birthdayInput/);
  assert.doesNotMatch(wizard, /returningBirthday/);
});

test("Pricing SSoT: quote preview and booking create use the shared quote snapshot builder", () => {
  const files = [
    "src/app/api/public/pricing/quote/route.ts",
    "src/app/api/public/promos/validate/route.ts",
    "src/app/api/public/bookings/route.ts",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /buildQuotePricingSnapshot\(/);
  }
});

test("Pricing SSoT: stored booking pricing is reused by booking follow-up and WiPay routes", () => {
  const files = [
    "src/app/api/public/bookings/route.ts",
    "src/app/api/public/bookings/[id]/promo/route.ts",
    "src/app/api/public/bookings/[id]/pay-on-pickup/route.ts",
    "src/lib/payments/publicPaymentStart.ts",
    "src/lib/payments/recalculateBooking.ts",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /computeBookingPricingFromStoredSnapshot\(/);
  }

  const routeFiles = [
    "src/app/api/payments/wipay/start/route.ts",
    "src/app/api/payments/wipay/full/start/route.ts",
    "src/app/api/payments/wipay/custom/start/route.ts",
    "src/app/api/payments/wipay/balance/start/route.ts",
  ];

  for (const file of routeFiles) {
    const code = read(file);
    assert.match(code, /startPublicWipayPayment\(/);
  }
});

test("Pricing SSoT: insurance-aware pricing is wired into public quote and booking routes", () => {
  const files = [
    "src/app/api/public/promos/validate/route.ts",
    "src/app/api/public/bookings/route.ts",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /insurance/i);
  }
});

test("Entitlement SSoT wiring: public availability and payment reconciliation use entitlement helper", () => {
  const publicVehicles = read("src/lib/publicVehicles.ts");
  assert.match(publicVehicles, /evaluateVehicleAvailability/);

  const publicBookingsCreate = read("src/app/api/public/bookings/route.ts");
  assert.match(publicBookingsCreate, /isPublicVehicleUnavailableForWindow/);

  const wipayReconcile = read("src/lib/payments/wipayReconcile.ts");
  assert.match(wipayReconcile, /maybeEntitleBookingAfterPayment/);
});

test("Upcoming SSoT wiring: dashboard + bookings SQL filters and calendar/day labels use shared helpers", () => {
  const bookingsList = read("src/lib/bookings/adminBookingsList.ts");
  assert.match(bookingsList, /from \"@\/lib\/bookings\/upcoming\"/);
  assert.match(bookingsList, /buildUpcomingWhereSql\(/);
  assert.match(bookingsList, /deriveBookingPhase\(/);
  assert.match(bookingsList, /export async function fetchDashboardBookingSnapshot/);
  assert.match(bookingsList, /fetchAdminBookingsPage\(/);

  const dashboard = read("src/app/admin/(protected)/page.tsx");
  assert.match(dashboard, /from \"@\/lib\/bookings\/upcoming\"/);
  assert.match(dashboard, /buildUpcomingWhereSql\(/);
  assert.match(dashboard, /fetchDashboardBookingSnapshot/);
  assert.match(dashboard, /fetchActiveFleetSnapshot/);
  assert.doesNotMatch(dashboard, /select count\(\*\) from vehicles where status = 'AVAILABLE'/);
  assert.doesNotMatch(dashboard, /const vehiclesResult = await dbQuery/);
  assert.doesNotMatch(dashboard, /const bookingsResult = await dbQuery/);
  assert.doesNotMatch(dashboard, /const pendingResult = await dbQuery/);
  assert.doesNotMatch(dashboard, /const confirmedResult = await dbQuery/);

  const calendarView = read("src/components/admin/CalendarView.tsx");
  assert.match(calendarView, /from \"@\/lib\/vehicles\/vehicleStatus\"/);
  assert.match(calendarView, /deriveBookingPhase\(/);

  const vehiclesPage = read("src/app/admin/(protected)/vehicles/page.tsx");
  assert.match(vehiclesPage, /hydrateVehiclesWithDerivedStatus/);
});

test("Dashboard upcoming context links to bookings with Upcoming scope", () => {
  const dashboard = read("src/app/admin/(protected)/page.tsx");
  assert.match(dashboard, /\/admin\/bookings\?scope=upcoming/);
});

test("Admin bookings API forwards upcoming scope parameters", () => {
  const apiRoute = read("src/app/api/admin/bookings/route.ts");
  assert.match(apiRoute, /scope:\s*searchParams\.get\(\"scope\"\)/);
  assert.match(apiRoute, /sortBy:\s*searchParams\.get\(\"sortBy\"\)/);
  assert.match(apiRoute, /sortDir:\s*searchParams\.get\(\"sortDir\"\)/);
});

test("Maintenance SSoT wiring: maintenance APIs use centralized maintenance helper", () => {
  const listRoute = read("src/app/api/admin/vehicles/[id]/maintenance/route.ts");
  assert.match(listRoute, /computeMaintenanceRecordTotal\(/);
  assert.match(listRoute, /getMaintenanceDueState\(/);

  const detailRoute = read("src/app/api/admin/vehicles/[id]/maintenance/[recordId]/route.ts");
  assert.match(detailRoute, /computeMaintenanceRecordTotal\(/);
  assert.match(detailRoute, /getMaintenanceDueState\(/);
});

test("Blockouts linkage wiring: calendar and admin blockout APIs use shared blockout service", () => {
  const blockoutsApi = read("src/app/api/admin/blockouts/route.ts");
  assert.match(blockoutsApi, /from \"@\/lib\/blockouts\/shared\"/);
  assert.match(blockoutsApi, /listBlockouts\(/);

  const calendarPage = read("src/app/admin/(protected)/calendar/page.tsx");
  assert.match(calendarPage, /from \"@\/lib\/blockouts\/shared\"/);
  assert.match(calendarPage, /listBlockouts\(/);
});

test("Settings SSoT: requireRestoreReason consumers use loadAdminSettings", () => {
  const paymentsRoute = read("src/app/api/admin/payments/[paymentId]/route.ts");
  assert.match(paymentsRoute, /from \"@\/lib\/adminSettings\"/);
  assert.match(paymentsRoute, /loadAdminSettings\(/);
  assert.doesNotMatch(paymentsRoute, /select content from admin_documents where key = 'settings'/i);

  const bookingPage = read("src/app/admin/(protected)/bookings/[id]/page.tsx");
  assert.match(bookingPage, /from \"@\/lib\/adminSettings\"/);
  assert.match(bookingPage, /loadAdminSettings\(/);
  assert.doesNotMatch(bookingPage, /select content from admin_documents where key = 'settings'/i);
});

test("Turnstile coverage: protected public submit routes call shared verifier", () => {
  const files = [
    "src/app/api/public/contact/route.ts",
    "src/app/api/public/bookings/route.ts",
    "src/app/api/public/returning-customer/start/route.ts",
    "src/app/api/public/returning-customer/verify/route.ts",
    "src/app/api/public/auth/clerk-account-setup/route.ts",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /verifyTurnstileToken\(/);
    assert.match(code, /extractTurnstileToken\(/);
  }
});

test("Returning-customer OTP uses dedicated secret only", () => {
  const helper = read("src/lib/security/returningCustomerOtp.ts");
  assert.match(helper, /RETURNING_CUSTOMER_OTP_SECRET_MISSING/);
  assert.doesNotMatch(helper, /CSRF_SECRET/);
  assert.doesNotMatch(helper, /ADMIN_SESSION_SECRET/);

  const startRoute = read("src/app/api/public/returning-customer/start/route.ts");
  const verifyRoute = read("src/app/api/public/returning-customer/verify/route.ts");

  assert.match(startRoute, /hashReturningCustomerOtp\(/);
  assert.match(verifyRoute, /hashReturningCustomerOtp\(/);
  assert.doesNotMatch(startRoute, /CSRF_SECRET|ADMIN_SESSION_SECRET|ccr-returning-customer/);
  assert.doesNotMatch(verifyRoute, /CSRF_SECRET|ADMIN_SESSION_SECRET|ccr-returning-customer/);
});

test("Booking access token flow is independent from private-file env secrets", () => {
  const helper = read("src/lib/bookings/privateAccess.ts");
  const bookingRoute = read("src/app/api/public/bookings/route.ts");

  assert.doesNotMatch(helper, /BOOKING_PRIVATE_FILE_SECRET|BOOKING_PRIVATE_FILE_SECRET_MISSING/);
  assert.doesNotMatch(bookingRoute, /Booking access is temporarily unavailable/);
  assert.match(bookingRoute, /createBookingAccessToken\(submissionKey\)/);
  assert.match(bookingRoute, /hashBookingSubmissionKey\(submissionKey\)/);
});

test("Booking emails use public references and keep overriding booking details out of customer notices", () => {
  const email = read("src/lib/notifications/email.ts");

  assert.match(email, /resolveBookingReference\(input\.bookingId\)/);
  assert.match(email, /resolveBookingReferences\(\[\s*input\.bookingId,\s*input\.overriddenByBookingId,\s*\]\)/);
  assert.doesNotMatch(email, /View Paid Booking/);
  assert.doesNotMatch(email, /input\.overriddenByBookingId\.slice\(0,\s*8\)/);
});

test("Critical booking emails do not require PDF attachments to send", () => {
  const email = read("src/lib/notifications/email.ts");

  assert.match(email, /buildOptionalInvoiceEmailAttachment/);
  assert.match(email, /buildOptionalRentalAgreementEmailAttachment/);
  assert.doesNotMatch(email, /buildRequiredInvoiceAttachment/);
  assert.doesNotMatch(email, /buildRequiredRentalAgreementAttachment/);
  assert.match(email, /invoice attachment is temporarily unavailable/i);
  assert.match(email, /rental agreement attachment is temporarily unavailable/i);
});
