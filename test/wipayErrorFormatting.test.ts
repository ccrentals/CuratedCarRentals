import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPaymentMetadataError,
  formatStoredWiPayError,
  sanitizePaymentMetadataForUi,
} from "@/lib/payments/formatWipayError";

test("formats HTTP 522 HTML responses into a readable WiPay availability message", () => {
  assert.deepEqual(
    formatStoredWiPayError(`HTTP 522: <!DOCTYPE html><html lang="en-US"><head></head><body></body></html>`),
    {
      title: "WiPay unavailable (HTTP 522)",
      detail: "Provider timeout / upstream unavailable",
    },
  );
});

test("formats timeout errors into a readable timeout message", () => {
  assert.deepEqual(
    formatStoredWiPayError(
      "WiPay request timed out after 12000ms (https://jm.wipayfinancial.com/plugins/payments/request)",
    ),
    {
      title: "WiPay unavailable (timeout)",
      detail: "Provider did not respond before the request timeout",
    },
  );
});

test("formats generic 5xx and 4xx errors into readable request status messages", () => {
  assert.deepEqual(formatStoredWiPayError("HTTP 500: Internal Server Error"), {
    title: "WiPay unavailable (HTTP 500)",
    detail: "Provider error / upstream unavailable",
  });

  assert.deepEqual(formatStoredWiPayError("HTTP 400: Bad Request"), {
    title: "WiPay request failed (HTTP 400)",
    detail: "Provider rejected the request",
  });
});

test("formats HTML error pages without a status into an unexpected page message", () => {
  assert.deepEqual(
    formatStoredWiPayError('<!DOCTYPE html><html class="no-js"><body>Error</body></html>'),
    {
      title: "WiPay returned an unexpected error page",
      detail: "Provider returned an invalid payment response",
    },
  );
});

test("falls back to a generic provider error when no known pattern matches", () => {
  assert.deepEqual(formatStoredWiPayError("Something went wrong upstream"), {
    title: "WiPay request failed",
    detail: "Payment provider error",
  });
});

test("sanitizes payment metadata for UI logs and display", () => {
  const metadata = {
    payment_type: "deposit",
    error: {
      message:
        'HTTP 522: <!DOCTYPE html><html class="no-js ie7 oldie" lang="en-US"><head></head><body></body></html>',
    },
    response: { message: "should be hidden" },
    raw: { reasonDescription: "should also be hidden" },
    hosted_page_url: "https://jm.wipayfinancial.com/test",
  };

  assert.deepEqual(formatPaymentMetadataError(metadata), {
    title: "WiPay unavailable (HTTP 522)",
    detail: "Provider timeout / upstream unavailable",
  });

  assert.deepEqual(sanitizePaymentMetadataForUi(metadata), {
    payment_type: "deposit",
    error: {
      title: "WiPay unavailable (HTTP 522)",
      detail: "Provider timeout / upstream unavailable",
    },
    hosted_page_url: "https://jm.wipayfinancial.com/test",
  });
});
