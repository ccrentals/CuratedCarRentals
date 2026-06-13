import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { MAX_DRIVERS_LICENSE_IMAGES } from "@/lib/bookings/privateFiles";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("driver's license upload supports a bounded multi-image selection", () => {
  const wizard = read("src/components/booking/PublicBookingWizard.tsx");

  assert.equal(MAX_DRIVERS_LICENSE_IMAGES, 4);
  assert.match(wizard, /driversLicenseImageUrls/);
  assert.match(wizard, /driversLicenseDataUrls: driversLicenseImageUrls/);
  assert.match(wizard, /type="file"[\s\S]*?accept="image\/\*"[\s\S]*?multiple/);
  assert.match(wizard, /setDriversLicenseImageUrls\(\(current\) => \[\.\.\.current, \.\.\.dataUrls\]\)/);
  assert.match(wizard, /current\.filter\(\(_, imageIndex\) => imageIndex !== index\)/);
});

test("public booking API validates and stores every driver's license image", () => {
  const route = read("src/app/api/public/bookings/route.ts");

  assert.match(route, /driversLicenseDataUrls\.length > MAX_DRIVERS_LICENSE_IMAGES/);
  assert.match(route, /parsedDriversLicenseImages\.some\(\(image\) => !image\)/);
  assert.match(
    route,
    /for \(const \[index, parsedDriversLicenseImage\] of parsedDriversLicenseImages\.entries\(\)\)/,
  );
  assert.match(route, /imageCount: parsedDriversLicenseImages\.length/);
});

test("secure private-file routes scope reads to an optional file ID", () => {
  const routes = [
    "src/app/admin/(protected)/bookings/[id]/private-files/[documentType]/route.ts",
    "src/app/api/public/bookings/[id]/private-files/[documentType]/route.ts",
  ];

  for (const routePath of routes) {
    const route = read(routePath);
    assert.match(route, /searchParams\.get\("fileId"\)/);
    assert.match(route, /\(\$3::uuid is null or id = \$3::uuid\)/);
    assert.match(route, /\[bookingId, documentType, fileId \|\| null\]/);
  }
});

test("customer profile exposes every driver's license image independently", () => {
  const page = read("src/app/admin/(protected)/customers/[id]/page.tsx");

  assert.match(page, /bpf\.customer_id/);
  assert.match(page, /driversLicenseDocuments\.push\(\{/);
  assert.match(page, /CustomerLegalIdImagesManager/);
  assert.match(
    page,
    /openUrl: `\/api\/admin\/customers\/\$\{row\.customer_id\}\/private-files\/\$\{row\.id\}`/,
  );
});
