import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bookingPagePath = new URL(
  "../src/app/admin/(protected)/bookings/[id]/page.tsx",
  import.meta.url,
);
const bookingClientPath = new URL(
  "../src/components/admin/AdminBookingDetailClient.tsx",
  import.meta.url,
);

test("booking detail loads the linked customer id for the customer profile action", async () => {
  const source = await readFile(bookingPagePath, "utf8");

  assert.match(source, /customer_id: string/);
  assert.match(source, /select b\.id, b\.public_id, b\.customer_id/);
  assert.match(source, /select b\.id, b\.id as public_id, b\.customer_id/);
  assert.match(source, /customerId=\{booking\.customer_id\}/);
});

test("customer and vehicle panel links to the customer profile and emphasizes labels", async () => {
  const source = await readFile(bookingClientPath, "utf8");

  assert.match(source, /href=\{`\/admin\/customers\/\$\{customerId\}`\}/);
  assert.match(source, />\s*Update customer\s*</);
  assert.match(
    source,
    /text-xs font-bold uppercase text-\[var\(--ccr-text\)\]">Customer</,
  );
  assert.match(
    source,
    /font-normal text-\[var\(--ccr-muted\)\]">\{detail\.customer\.name\}</,
  );
  assert.match(
    source,
    /font-normal text-\[var\(--ccr-muted\)\]">\s*\{detail\.customer\.driversLicenseNumber\}/,
  );
});
