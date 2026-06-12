import assert from "node:assert/strict";
import test from "node:test";

import { resolveBookingResendRecipient } from "@/lib/notifications/adminEmails";

test("booking customer resend uses the current customer email instead of the historical recipient", () => {
  assert.equal(
    resolveBookingResendRecipient({
      recipientType: "customer",
      originalRecipientEmail: "old-address@example.com",
      currentCustomerEmail: "current-address@example.com",
    }),
    "current-address@example.com",
  );
});

test("booking internal resend preserves the original internal recipient", () => {
  assert.equal(
    resolveBookingResendRecipient({
      recipientType: "internal",
      originalRecipientEmail: "operations@example.com",
      currentCustomerEmail: "customer@example.com",
    }),
    "operations@example.com",
  );
});

test("booking internal resend safely falls back when historical recipient is missing", () => {
  assert.equal(
    resolveBookingResendRecipient({
      recipientType: "internal",
      originalRecipientEmail: null,
      currentCustomerEmail: "customer@example.com",
    }),
    "customer@example.com",
  );
});
