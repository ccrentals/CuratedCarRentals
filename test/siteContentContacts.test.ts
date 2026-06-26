import assert from "node:assert/strict";
import test from "node:test";

import { siteContent } from "@/data/content";

test("site contact ordering keeps the primary phone first", () => {
  assert.equal(siteContent.phone, "+1 (876) 379-7163");
  assert.deepEqual(siteContent.phones[0], {
    label: "+1 (876) 379-7163 (Jamaica)",
    href: "tel:+18763797163",
  });
});

test("site contact ordering keeps the primary WhatsApp first", () => {
  assert.deepEqual(siteContent.whatsapp, {
    label: "+1 (876) 379-7163",
    href: "https://wa.me/18763797163",
  });
  assert.deepEqual(siteContent.whatsapps[0], siteContent.whatsapp);
});
