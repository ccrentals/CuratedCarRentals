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

test("Pricing SSoT: booking create, promo preview, and WiPay starts use computeBookingPricing", () => {
  const files = [
    "src/app/api/public/bookings/route.ts",
    "src/app/api/public/promos/validate/route.ts",
    "src/app/api/payments/wipay/start/route.ts",
    "src/app/api/payments/wipay/full/start/route.ts",
    "src/app/api/payments/wipay/custom/start/route.ts",
    "src/app/api/payments/wipay/balance/start/route.ts",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /computeBookingPricing\(/);
  }
});

test("Pricing SSoT: insurance-aware pricing is wired into promo + WiPay routes", () => {
  const files = [
    "src/app/api/public/promos/validate/route.ts",
    "src/app/api/payments/wipay/start/route.ts",
    "src/app/api/payments/wipay/full/start/route.ts",
    "src/app/api/payments/wipay/custom/start/route.ts",
    "src/app/api/payments/wipay/balance/start/route.ts",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /insurance/i);
  }
});

test("Entitlement SSoT wiring: public availability and payment reconciliation use entitlement helper", () => {
  const publicVehicles = read("src/lib/publicVehicles.ts");
  assert.match(publicVehicles, /listAvailableVehiclesEntitlementBased/);
  assert.match(publicVehicles, /isVehicleUnavailableEntitlementBased/);

  const publicBookingsCreate = read("src/app/api/public/bookings/route.ts");
  assert.match(publicBookingsCreate, /isPublicVehicleUnavailableForWindow/);

  const wipayReconcile = read("src/lib/payments/wipayReconcile.ts");
  assert.match(wipayReconcile, /maybeEntitleBookingAfterPayment/);
});

test("Upcoming SSoT wiring: dashboard, bookings list, and calendar use shared upcoming helper", () => {
  const bookingsList = read("src/lib/bookings/adminBookingsList.ts");
  assert.match(bookingsList, /from \"@\/lib\/bookings\/upcoming\"/);
  assert.match(bookingsList, /buildUpcomingWhereSql\(/);

  const dashboard = read("src/app/admin/(protected)/page.tsx");
  assert.match(dashboard, /from \"@\/lib\/bookings\/upcoming\"/);
  assert.match(dashboard, /buildUpcomingWhereSql\(/);

  const calendarView = read("src/components/admin/CalendarView.tsx");
  assert.match(calendarView, /from \"@\/lib\/bookings\/upcoming\"/);
  assert.match(calendarView, /isUpcomingBooking\(/);
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
