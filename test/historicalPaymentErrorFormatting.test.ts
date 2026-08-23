import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPaymentMetadataError,
  formatStoredHistoricalPaymentError,
  sanitizePaymentMetadataForUi,
} from "@/lib/payments/formatHistoricalPaymentError";

test("formats HTTP 522 HTML responses into a readable historical WiPay availability message", () => {
  assert.deepEqual(
    formatStoredHistoricalPaymentError(
      `HTTP 522: <!DOCTYPE html><html lang="en-US"><head></head><body></body></html>`,
    ),
    {
      title: "WiPay unavailable (HTTP 522)",
      detail: "Provider timeout / upstream unavailable",
    },
  );
});

test("formats historical timeout errors into a readable timeout message", () => {
  assert.deepEqual(
    formatStoredHistoricalPaymentError(
      "WiPay request timed out after 12000ms (https://jm.wipayfinancial.com/plugins/payments/request)",
    ),
    {
      title: "WiPay unavailable (timeout)",
      detail: "Provider did not respond before the request timeout",
    },
  );
});

test("formats historical 5xx and 4xx errors into readable request status messages", () => {
  assert.deepEqual(formatStoredHistoricalPaymentError("HTTP 500: Internal Server Error"), {
    title: "WiPay unavailable (HTTP 500)",
    detail: "Provider error / upstream unavailable",
  });

  assert.deepEqual(formatStoredHistoricalPaymentError("HTTP 400: Bad Request"), {
    title: "WiPay request failed (HTTP 400)",
    detail: "Provider rejected the request",
  });
});

test("formats historical HTML error pages without a status into an unexpected page message", () => {
  assert.deepEqual(
    formatStoredHistoricalPaymentError('<!DOCTYPE html><html class="no-js"><body>Error</body></html>'),
    {
      title: "WiPay returned an unexpected error page",
      detail: "Provider returned an invalid payment response",
    },
  );
});

test("falls back to a generic provider error when no known historical pattern matches", () => {
  assert.deepEqual(formatStoredHistoricalPaymentError("Something went wrong upstream"), {
    title: "WiPay request failed",
    detail: "Payment provider error",
  });
});

test("sanitizes historical payment metadata for UI logs and display", () => {
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

  assert.deepEqual(formatPaymentMetadataError(metadata, "WIPAY"), {
    title: "WiPay unavailable (HTTP 522)",
    detail: "Provider timeout / upstream unavailable",
  });

  assert.deepEqual(sanitizePaymentMetadataForUi(metadata, "WIPAY"), {
    payment_type: "deposit",
    error: {
      title: "WiPay unavailable (HTTP 522)",
      detail: "Provider timeout / upstream unavailable",
    },
    hosted_page_url: "https://jm.wipayfinancial.com/test",
  });
});

test("labels current provider errors without relabelling them as WiPay", () => {
  const metadata = {
    error: {
      message: "HTTP 500: Internal Server Error",
    },
    response: { message: "should be hidden" },
  };

  assert.deepEqual(formatPaymentMetadataError(metadata, "STRIPE"), {
    title: "Stripe unavailable (HTTP 500)",
    detail: "Provider error / upstream unavailable",
  });

  assert.deepEqual(sanitizePaymentMetadataForUi(metadata, "STRIPE"), {
    error: {
      title: "Stripe unavailable (HTTP 500)",
      detail: "Provider error / upstream unavailable",
    },
  });
});
