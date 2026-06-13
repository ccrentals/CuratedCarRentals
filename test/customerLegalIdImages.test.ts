import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CUSTOMER_ID_IMAGE_POLICY,
  CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
} from "@/lib/customers/privateFiles";
import { hasRequiredAdminAccess } from "@/lib/auth/roles";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("customer private-file migration backfills ownership and permits profile uploads", () => {
  const migration = read("migrations/048_customer_private_file_ownership.sql");

  assert.match(migration, /add column if not exists customer_id uuid references customers/);
  assert.match(migration, /set customer_id = b\.customer_id/);
  assert.match(migration, /create trigger booking_private_files_customer_owner/);
  assert.match(migration, /if new\.customer_id is null and new\.booking_id is not null/);
  assert.match(migration, /alter column booking_id drop not null/);
  assert.match(migration, /alter column customer_id set not null/);
});

test("customer ID policy preserves image-only 10 MB validation without a cumulative cap", () => {
  assert.equal(CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE, "DRIVERS_LICENSE");
  assert.equal(CUSTOMER_ID_IMAGE_POLICY.imagesOnly, true);
  assert.equal(CUSTOMER_ID_IMAGE_POLICY.maxBytes, 10 * 1024 * 1024);
  assert.ok(CUSTOMER_ID_IMAGE_POLICY.maxCount > 1);
});

test("all authenticated admin portal roles can manage customer ID images", () => {
  assert.equal(hasRequiredAdminAccess("OPERATIONS", "operations"), true);
  assert.equal(hasRequiredAdminAccess("ADMIN", "operations"), true);
  assert.equal(hasRequiredAdminAccess("DEVELOPER", "operations"), true);
  assert.equal(hasRequiredAdminAccess(null, "operations"), false);
});

test("customer private-file APIs require auth, CSRF, ownership scoping, and safe cleanup", () => {
  const collectionRoute = read("src/app/api/admin/customers/[id]/private-files/route.ts");
  const itemRoute = read(
    "src/app/api/admin/customers/[id]/private-files/[fileId]/route.ts",
  );

  assert.match(collectionRoute, /requireOperationsAccess/);
  assert.match(collectionRoute, /requireCsrf/);
  assert.match(collectionRoute, /validateUploadcareFiles\(references, CUSTOMER_ID_IMAGE_POLICY\)/);
  assert.match(collectionRoute, /customer_id = \$1::uuid/);
  assert.match(collectionRoute, /already attached to this customer/);
  assert.match(collectionRoute, /source: "admin_customer_profile"/);

  assert.match(itemRoute, /bpf\.customer_id = \$2::uuid/);
  assert.match(itemRoute, /parseSafePrivateBookingImageDataUrl/);
  assert.match(itemRoute, /x-content-type-options": "nosniff"/);
  assert.match(itemRoute, /count\(\*\) from booking_private_files/);
  assert.match(itemRoute, /deleteUploadcareFile/);
  assert.match(itemRoute, /MEDIA_SHARED_PRESERVE/);
});

test("customer profile appends uploads and related bookings show the shared library", () => {
  const manager = read("src/components/admin/CustomerLegalIdImagesManager.tsx");
  const customerPage = read("src/app/admin/(protected)/customers/[id]/page.tsx");
  const bookingPage = read("src/app/admin/(protected)/bookings/[id]/page.tsx");
  const bookingClient = read("src/components/admin/AdminBookingDetailClient.tsx");

  assert.match(manager, /setItems\(\(current\) => \[\.\.\.added, \.\.\.current\]\)/);
  assert.match(manager, /Upload ID images/);
  assert.match(manager, /window\.confirm/);
  assert.match(customerPage, /CustomerLegalIdImagesManager/);
  assert.match(bookingPage, /where bpf\.customer_id = \$1/);
  assert.match(bookingClient, /initialItems=\{customerIdImages\}/);
});

test("future booking wizard private files store customer ownership and normalized tags", () => {
  const route = read("src/app/api/public/bookings/route.ts");

  assert.match(route, /booking_private_files \(customer_id, booking_id/);
  assert.match(route, /customerId: customerUpsert\.customerId/);
  assert.match(route, /customerPublicId/);
  assert.match(route, /bookingPublicId: bookingInsert\.rows\[0\]\.public_id/);
  assert.match(route, /documentType: "DRIVERS_LICENSE"/);
  assert.match(route, /source: "public_booking_wizard"/);
});
