import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminQuotePdfGet } from "@/app/api/admin/quotes/[id]/pdf/route";

function adminSession() {
  return {
    userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    role: "ADMIN",
    expiresAt: 999999999,
    issuedAt: 999999000,
  };
}

test("admin quotes PDF API: returns PDF response for authorized admin", async () => {
  const response = await handleAdminQuotePdfGet(
    new Request("http://localhost/api/admin/quotes/quote-id/pdf"),
    { params: Promise.resolve({ id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2" }) },
    {
      getSession: async () => adminSession(),
      getQuote: async () => ({
        id: "c3ad4e53-f14f-4ac9-98fd-f4bacf1ec3d2",
        createdAt: "2026-02-22T12:00:00.000Z",
        updatedAt: "2026-02-22T12:00:00.000Z",
        status: "DRAFT",
        expiresAt: "2026-03-01T00:00:00.000Z",
        customerFullName: "Damian Thompson",
        customerEmail: "damian@example.com",
        customerPhone: "+1 876 555 0144",
        startAt: "2026-03-10T10:00:00.000Z",
        endAt: "2026-03-12T10:00:00.000Z",
        pickupLocationId: null,
        dropoffLocationId: null,
        pickupLocationText: "Montego Bay Airport",
        dropoffLocationText: "Montego Bay Airport",
        vehicleId: "6f11f0cf-cedf-4db3-a5fd-64bfe7fded1e",
        vehicleLabel: "Nissan X-Trail",
        vehicleClass: "SUV",
        pricingJson: {},
        baseTotalCents: 24000,
        insuranceTotalCents: 2400,
        discountTotalCents: 1000,
        subtotalCents: 26400,
        totalCents: 25400,
        depositRequiredCents: 8000,
        amountDueCents: 25400,
        promoCode: "SAVE10",
        insurancePlanId: null,
        insuranceEnabled: true,
        tags: [],
        comments: null,
        commissionPartnerName: null,
        clientPaysAtPartner: false,
        rackPriceCents: 24000,
        createdByAdminUserId: null,
        lastEmailedAt: null,
        lastEmailedTo: null,
        convertedBookingId: null,
      }),
      buildPdf: () => Buffer.from("%PDF-1.4\nmock", "utf8"),
      recordEvent: async () => undefined,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  const disposition = response.headers.get("content-disposition") ?? "";
  assert.equal(disposition.includes("Quote-c3ad4e53.pdf"), true);
});
