import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminQuoteConvertPost } from "@/app/api/admin/quotes/[id]/convert-to-booking/route";
import { QuoteOpsError } from "@/lib/quotes/quoteOps";

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: 999999999,
    issuedAt: 999999000,
  };
}

test("admin quotes convert API: converts quote and returns booking id", async () => {
  const response = await handleAdminQuoteConvertPost(
    new Request("http://localhost/api/admin/quotes/c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2/convert-to-booking", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      convertQuote: async () => ({
        bookingId: "f37f8ec6-0996-4143-b3e5-6fc06b6de99f",
        alreadyConverted: false,
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    bookingId: string;
    bookingUrl: string;
  };

  assert.equal(body.ok, true);
  assert.equal(body.bookingId, "f37f8ec6-0996-4143-b3e5-6fc06b6de99f");
  assert.equal(body.bookingUrl, "/admin/bookings/f37f8ec6-0996-4143-b3e5-6fc06b6de99f");
});

test("admin quotes convert API: blocks conversion when vehicle availability fails", async () => {
  const response = await handleAdminQuoteConvertPost(
    new Request("http://localhost/api/admin/quotes/c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2/convert-to-booking", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      convertQuote: async () => {
        throw new QuoteOpsError(
          "VEHICLE_UNAVAILABLE",
          "Vehicle is no longer available for the selected rental window.",
          409,
        );
      },
    },
  );

  assert.equal(response.status, 409);
  const body = (await response.json()) as { ok: boolean; code: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "VEHICLE_UNAVAILABLE");
});
