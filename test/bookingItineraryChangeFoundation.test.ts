import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { appendBookingItineraryChangeNote } from "../src/lib/bookings/bookingItineraryChangeNote";

test("booking itinerary preview and save share the production evaluator", async () => {
  const [previewRoute, mutationRoute, evaluator] = await Promise.all([
    readFile("src/app/api/admin/bookings/[id]/itinerary-preview/route.ts", "utf8"),
    readFile("src/app/api/admin/bookings/[id]/route.ts", "utf8"),
    readFile("src/lib/bookings/bookingItineraryChange.ts", "utf8"),
  ]);
  assert.match(previewRoute, /evaluateBookingItineraryChange/);
  assert.match(mutationRoute, /evaluateBookingItineraryChange/);
  assert.match(evaluator, /excludeBookingId: input\.booking\.id/);
  assert.match(evaluator, /buildQuotePricingSnapshot/);
  assert.match(evaluator, /includeBlockouts: true/);
  assert.match(evaluator, /publicEligibility: false/);
  assert.match(previewRoute, /insurancePricePerDay: evaluated\.summary\.insurancePricePerDay/);
});

test("booking itinerary preview explains vehicle-specific insurance repricing", async () => {
  const form = await readFile("src/components/admin/BookingUpdateForm.tsx", "utf8");
  assert.match(form, /Insurance remains selected and is recalculated using the selected vehicle/);
  assert.match(form, /formatCurrency\(preview\.insurancePricePerDay\)/);
  assert.doesNotMatch(form, /Number\(value \?\? 0\)\) \/ 100/);
});

test("booking itinerary mutation persists vehicle, insurance, audit, and notifications", async () => {
  const route = await readFile("src/app/api/admin/bookings/[id]/route.ts", "utf8");
  assert.match(route, /vehicle_id = \$15::uuid/);
  assert.match(route, /insurance_plan_id = \$17::uuid/);
  assert.match(route, /previous_vehicle_id/);
  assert.match(route, /next_vehicle_id/);
  assert.match(route, /sendBookingItineraryUpdatedEmail/);
  assert.match(route, /PICKED_UP.*RETURNED.*CANCELLED/);
});

test("booking itinerary mutation writes a detailed admin change note", async () => {
  const [route, noteBuilder] = await Promise.all([
    readFile("src/app/api/admin/bookings/[id]/route.ts", "utf8"),
    readFile("src/lib/bookings/bookingItineraryChangeNote.ts", "utf8"),
  ]);
  assert.match(route, /appendBookingItineraryChangeNote/);
  assert.match(noteBuilder, /Vehicle.*previousVehicle.*nextVehicle/s);
  assert.match(noteBuilder, /Booking total/);
  assert.match(noteBuilder, /Insurance/);
  assert.match(noteBuilder, /Refund review required/);
  assert.match(noteBuilder, /BOOKING_ITINERARY_UPDATED/);
});

test("booking change controls flow insurance and promo through preview, save, notes, and email", async () => {
  const [form, previewRoute, mutationRoute, evaluator, email] = await Promise.all([
    readFile("src/components/admin/BookingUpdateForm.tsx", "utf8"),
    readFile("src/app/api/admin/bookings/[id]/itinerary-preview/route.ts", "utf8"),
    readFile("src/app/api/admin/bookings/[id]/route.ts", "utf8"),
    readFile("src/lib/bookings/bookingItineraryChange.ts", "utf8"),
    readFile("src/lib/notifications/email.ts", "utf8"),
  ]);
  assert.match(form, /Insurance[\s\S]*Promo code[\s\S]*Customer name/);
  assert.match(form, /insuranceSelected: nextInsuranceSelected/);
  assert.match(form, /promoCode: nextPromoCode\.trim\(\)/);
  assert.match(previewRoute, /promoCode: evaluated\.summary\.promoCode/);
  assert.match(mutationRoute, /previous_promo_code/);
  assert.match(mutationRoute, /next_insurance_selected/);
  assert.match(evaluator, /input\.promoCode === undefined/);
  assert.match(email, /previousInsurance[\s\S]*nextPromo/);
});

test("booking change note describes promo replacement and insurance removal", () => {
  const pricing = appendBookingItineraryChangeNote({}, {
    previousVehicle: "Car A",
    nextVehicle: "Car A",
    previousPickupDateTime: "2026-07-12 11:00",
    nextPickupDateTime: "2026-07-12 11:00",
    previousDropoffDateTime: "2026-07-14 11:00",
    nextDropoffDateTime: "2026-07-14 11:00",
    previousPickupLocation: "Office",
    nextPickupLocation: "Office",
    previousDropoffLocation: "Office",
    nextDropoffLocation: "Office",
    previousCustomerName: "Customer",
    nextCustomerName: "Customer",
    previousCustomerEmail: "customer@example.com",
    nextCustomerEmail: "customer@example.com",
    previousCustomerPhone: "123",
    nextCustomerPhone: "123",
    previousSummary: {
      insuranceSelected: true,
      insurancePricePerDay: 2800,
      insuranceTotal: 5600,
      promoCode: "SAVE10",
      promoDiscount: 1000,
      total: 17600,
      netPaidToDate: 0,
      balanceDue: 17600,
      refundRequired: false,
    },
    nextSummary: {
      insuranceSelected: false,
      insurancePricePerDay: 0,
      insuranceTotal: 0,
      promoCode: "SAVE20",
      promoDiscount: 2000,
      total: 11000,
      netPaidToDate: 0,
      balanceDue: 11000,
      refundRequired: false,
    },
    userId: "admin",
    createdAt: "2026-07-13T00:00:00.000Z",
  });
  const note = (pricing.admin_notes as Array<{ message: string }>)[0]?.message ?? "";
  assert.match(note, /Insurance: JMD 2,800\.00\/day.*-> Not selected/);
  assert.match(note, /Promo: SAVE10.*-> SAVE20/);
});
