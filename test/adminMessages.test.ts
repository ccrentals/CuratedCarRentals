import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_MESSAGE_SOURCE_OPTIONS,
  humanizeAdminMessageSource,
  normalizeAdminMessageSourceFilter,
} from "@/lib/messages/adminMessages";

test("admin messages: home page contact is a first-class source option", () => {
  const option = ADMIN_MESSAGE_SOURCE_OPTIONS.find((entry) => entry.value === "home_page_contact");

  assert.ok(option);
  assert.equal(option?.label, "Home contact form");
  assert.equal(normalizeAdminMessageSourceFilter("home_page_contact"), "home_page_contact");
  assert.equal(humanizeAdminMessageSource("home_page_contact"), "Home contact form");
});
