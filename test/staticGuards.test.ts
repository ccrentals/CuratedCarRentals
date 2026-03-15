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
  assert.match(
    publicVehicles,
    /listAvailableVehiclesWithAvailabilityRules|listAvailableVehiclesEntitlementBased/,
  );
  assert.match(
    publicVehicles,
    /isVehicleUnavailableWithAvailabilityRules|isVehicleUnavailableEntitlementBased/,
  );

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

  const dashboard = read("src/app/admin/(protected)/page.tsx");
  assert.match(dashboard, /from \"@\/lib\/bookings\/upcoming\"/);
  assert.match(dashboard, /buildUpcomingWhereSql\(/);

  const calendarView = read("src/components/admin/CalendarView.tsx");
  assert.match(calendarView, /from \"@\/lib\/vehicles\/vehicleStatus\"/);
  assert.match(calendarView, /deriveBookingPhase\(/);
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
