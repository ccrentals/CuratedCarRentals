import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminQuotePatch } from "@/app/api/admin/quotes/[id]/route";
import { AdminQuoteError } from "@/lib/quotes/adminQuotes";
import {
  getQuoteStatusTransitionError,
  isQuoteStatusTransitionAllowed,
  type QuoteStatus,
} from "@/lib/quotes/lifecycle";

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: 999999999,
    issuedAt: 999999000,
  };
}

test("quote transition map: allows expected transitions", () => {
  const allowed: Array<[QuoteStatus, QuoteStatus]> = [
    ["DRAFT", "SENT"],
    ["DRAFT", "EXPIRED"],
    ["DRAFT", "CANCELLED"],
    ["SENT", "ACCEPTED"],
    ["SENT", "EXPIRED"],
    ["SENT", "CANCELLED"],
    ["ACCEPTED", "SENT"],
    ["ACCEPTED", "CONVERTED"],
    ["ACCEPTED", "EXPIRED"],
    ["ACCEPTED", "CANCELLED"],
    ["EXPIRED", "SENT"],
    ["EXPIRED", "ACCEPTED"],
    ["EXPIRED", "CANCELLED"],
    ["CANCELLED", "SENT"],
    ["CANCELLED", "ACCEPTED"],
    ["CANCELLED", "EXPIRED"],
  ];

  for (const [fromStatus, toStatus] of allowed) {
    assert.equal(
      isQuoteStatusTransitionAllowed(fromStatus, toStatus),
      true,
      `${fromStatus} -> ${toStatus} should be allowed`,
    );
    assert.equal(getQuoteStatusTransitionError(fromStatus, toStatus), null);
  }
});

test("quote transition map: disallows invalid transitions", () => {
  const disallowed: Array<[QuoteStatus, QuoteStatus]> = [
    ["SENT", "DRAFT"],
    ["CONVERTED", "DRAFT"],
    ["CONVERTED", "SENT"],
    ["CONVERTED", "EXPIRED"],
  ];

  for (const [fromStatus, toStatus] of disallowed) {
    assert.equal(
      isQuoteStatusTransitionAllowed(fromStatus, toStatus),
      false,
      `${fromStatus} -> ${toStatus} should be blocked`,
    );
    assert.equal(
      getQuoteStatusTransitionError(fromStatus, toStatus),
      `Invalid quote status transition: ${fromStatus} -> ${toStatus}`,
    );
  }
});

test("admin quote PATCH surfaces clear transition error message", async () => {
  const fromStatus: QuoteStatus = "SENT";
  const toStatus: QuoteStatus = "DRAFT";
  const expectedError = getQuoteStatusTransitionError(fromStatus, toStatus);
  assert.ok(expectedError);

  const response = await handleAdminQuotePatch(
    new Request("http://localhost/api/admin/quotes/c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        csrfToken: "token",
        status: toStatus,
      }),
    }),
    {
      params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }),
    },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getQuote: async () => null,
      patchQuote: async () => {
        throw new AdminQuoteError("INVALID_STATUS_TRANSITION", expectedError, 400);
      },
    },
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as { ok: boolean; error: string; code: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "INVALID_STATUS_TRANSITION");
  assert.equal(body.error, expectedError);
});
