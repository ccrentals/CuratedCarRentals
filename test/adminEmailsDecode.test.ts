import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeEmailRecordId,
  statusFromResendLastEvent,
} from "@/lib/notifications/adminEmails";

test("decodeEmailRecordId accepts route-encoded record ids", () => {
  assert.deepEqual(
    decodeEmailRecordId("dispatch%3Add27d62e-60c0-4ab6-8da7-112b41b3e8c1"),
    {
      kind: "dispatch",
      rawId: "dd27d62e-60c0-4ab6-8da7-112b41b3e8c1",
    },
  );
});

test("Resend provider events map to admin delivery statuses", () => {
  assert.equal(statusFromResendLastEvent("delivered"), "DELIVERED");
  assert.equal(statusFromResendLastEvent("bounced"), "BOUNCED");
  assert.equal(statusFromResendLastEvent("delivery_delayed"), "DELIVERY_ISSUE");
  assert.equal(statusFromResendLastEvent("sent"), null);
});
