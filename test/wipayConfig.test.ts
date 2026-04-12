import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRequestParams,
  getWiPayCountryCode,
  getWiPayRequestEndpoint,
  requestHostedPageUrl,
} from "@/lib/wipay";

async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T> | T) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const restore = () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    return await fn();
  } finally {
    restore();
  }
}

test("WiPay country code defaults to JM and supports country-specific endpoints", async () => {
  await withEnv({ WIPAY_COUNTRY_CODE: undefined }, async () => {
    assert.equal(getWiPayCountryCode(), "JM");
    assert.equal(
      getWiPayRequestEndpoint(),
      "https://jm.wipayfinancial.com/plugins/payments/request",
    );
  });

  await withEnv({ WIPAY_COUNTRY_CODE: "TT" }, async () => {
    assert.equal(getWiPayCountryCode(), "TT");
    assert.equal(
      getWiPayRequestEndpoint(),
      "https://tt.wipayfinancial.com/plugins/payments/request",
    );
  });
});

test("buildRequestParams uses the selected WiPay country code", async () => {
  await withEnv(
    {
      WIPAY_ACCOUNT_NUMBER: "1234567890",
      WIPAY_API_KEY: "test-api-key",
      WIPAY_COUNTRY_CODE: "BB",
      WIPAY_ENV: "sandbox",
      WIPAY_FEE_STRUCTURE: "merchant_absorb",
      WIPAY_ORIGIN: "curated-car-rentals",
    },
    async () => {
      const params = buildRequestParams({
        orderId: "order-123",
        amountDecimal: "10.00",
        responseUrl: "https://example.com/return",
        name: "John Doe",
      });

      assert.equal(params.country_code, "BB");
      assert.equal(params.account_number, "1234567890");
      assert.equal(params.order_id, "order-123");
    },
  );
});

test("requestHostedPageUrl surfaces timeout errors clearly", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    return await new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        reject(error);
      };

      if (signal?.aborted) {
        abort();
        return;
      }

      signal?.addEventListener("abort", abort, { once: true });
    });
  }) as typeof fetch;

  try {
    await withEnv(
      {
        WIPAY_COUNTRY_CODE: "JM",
      },
      async () => {
        await assert.rejects(
          () => requestHostedPageUrl({ order_id: "test" }, { timeoutMs: 10 }),
          /WiPay request timed out after 10ms/,
        );
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
