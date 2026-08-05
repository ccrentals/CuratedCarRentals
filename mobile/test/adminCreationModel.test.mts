import assert from "node:assert/strict";
import test from "node:test";

import model from "../src/admin/adminCreationModel.ts";
import type { AdminBookingLocation } from "../src/admin/api";

const office: AdminBookingLocation = { id: "11111111-1111-4111-8111-111111111111", label: "Office", locationTypeKey: "OFFICE", pickupLabel: "Kingston office", dropoffLabel: "Kingston office", appliesToPickup: true, appliesToDropoff: true, isActive: true, sortOrder: 1, fieldSchema: [] };
const airport: AdminBookingLocation = { id: "22222222-2222-4222-8222-222222222222", label: "Airport", locationTypeKey: "AIRPORT", pickupLabel: "Airport arrival", dropoffLabel: "Airport departure", appliesToPickup: true, appliesToDropoff: true, isActive: true, sortOrder: 2, fieldSchema: [{ key: "flight_date", label: "Flight date", inputType: "date", required: true, appliesTo: "both", defaultSource: "pickup_date" }, { key: "flight_number", label: "Flight number", inputType: "text", required: true, appliesTo: "both", defaultSource: null }] };

test("admin creation model builds dynamic location evidence with Jamaica defaults", () => {
  const selection = model.buildLocationSelection({ locations: [office, airport], pickupTypeKey: "AIRPORT", dropoffTypeKey: "OFFICE", pickupValues: { flight_number: "JM 100" }, dropoffValues: {}, context: { pickupDate: "2026-08-10", pickupTime: "09:00", dropoffDate: "2026-08-12", dropoffTime: "11:00" } });
  assert.equal(selection.pickupValues.flight_date, "2026-08-10");
  assert.equal(selection.pickupText, "Airport arrival");
  assert.equal((selection.details.pickup as any).fieldLabels.flight_number, "Flight number");
  assert.equal(model.validateLocation(selection.pickup, "pickup", selection.pickupValues), null);
});

test("admin creation model distinguishes configured locations that share a type", () => {
  const secondOffice = { ...office, id: "44444444-4444-4444-8444-444444444444", label: "Airport office", pickupLabel: "Airport office pickup" };
  assert.equal(model.locationForType([office, secondOffice], secondOffice.id!, "pickup")?.pickupLabel, "Airport office pickup");
});

test("admin creation model prepares a complete quote payload", () => {
  const result = model.prepareQuoteCreate({ clientRequestId: "77777777-7777-4777-8777-777777777777", customerFullName: "Ada Lovelace", customerEmail: "ADA@example.com", customerPhone: "8765551111", pickupDate: "2026-08-10", pickupTime: "09:00", dropoffDate: "2026-08-12", dropoffTime: "11:00", locations: [office], pickupTypeKey: "OFFICE", dropoffTypeKey: "OFFICE", pickupValues: {}, dropoffValues: {}, vehicleId: "33333333-3333-4333-8333-333333333333", insuranceEnabled: false, insurancePlanId: null, promoCode: " island10 ", tags: "VIP, airport, VIP", comments: "Call before arrival", expiresDate: "2026-08-05", commissionPartnerName: "Hotel partner", clientPaysAtPartner: true, rackPrice: "75,000" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.payload.startAt, "2026-08-10T14:00:00.000Z");
  assert.equal(result.payload.customerEmail, "ada@example.com");
  assert.equal(result.payload.clientRequestId, "77777777-7777-4777-8777-777777777777");
  assert.deepEqual(result.payload.tags, ["VIP", "airport"]);
  assert.equal(result.payload.promoCode, "ISLAND10");
  assert.equal(result.payload.rackPriceCents, 75000);
});

test("admin creation model blocks missing dynamic fields and invalid windows", () => {
  const base = { clientRequestId: "77777777-7777-4777-8777-777777777777", customerFullName: "Ada Lovelace", customerEmail: "ada@example.com", customerPhone: "", pickupDate: "2026-08-10", pickupTime: "09:00", dropoffDate: "2026-08-09", dropoffTime: "11:00", locations: [airport], pickupTypeKey: "AIRPORT", dropoffTypeKey: "AIRPORT", pickupValues: {}, dropoffValues: {}, vehicleId: "vehicle", insuranceEnabled: false, insurancePlanId: null, promoCode: "", tags: "", comments: "", expiresDate: "", commissionPartnerName: "", clientPaysAtPartner: false, rackPrice: "" };
  assert.equal(model.prepareQuoteCreate(base).ok, false);
  assert.equal(model.prepareQuoteCreate({ ...base, dropoffDate: "2026-08-12" }).ok, false);
  const partnerResult = model.prepareQuoteCreate({ ...base, dropoffDate: "2026-08-12", pickupValues: { flight_number: "JM 100" }, dropoffValues: { flight_number: "JM 101" }, clientPaysAtPartner: true });
  assert.equal(partnerResult.ok, false);
  if (!partnerResult.ok) assert.match(partnerResult.error, /commission partner/i);
});

test("admin creation model prepares a booking without creating payment state", () => {
  const result = model.prepareBookingCreate({ clientRequestId: "66666666-6666-4666-8666-666666666666", customerId: "55555555-5555-4555-8555-555555555555", customerFullName: "Ada Lovelace", customerEmail: "ADA@example.com", customerPhone: "876-555-1111", pickupDate: "2026-08-10", dropoffDate: "2026-08-13", minimumDays: 3, todayDate: "2026-08-01", locations: [office], pickupTypeKey: office.id!, dropoffTypeKey: office.id!, pickupValues: {}, dropoffValues: {}, vehicleId: "33333333-3333-4333-8333-333333333333", insuranceSelected: false, insurancePlanId: null, promoCode: " island10 " });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.payload.customerId, "55555555-5555-4555-8555-555555555555");
  assert.equal(result.payload.clientRequestId, "66666666-6666-4666-8666-666666666666");
  assert.equal(result.payload.email, "ada@example.com");
  assert.equal(result.payload.promoCode, "ISLAND10");
  assert.equal("payment" in result.payload, false);
});

test("admin creation model enforces Jamaica booking date, minimum stay, and payment inputs", () => {
  const base = { clientRequestId: "66666666-6666-4666-8666-666666666666", customerFullName: "Ada Lovelace", customerEmail: "ada@example.com", customerPhone: "8765551111", pickupDate: "2026-08-10", dropoffDate: "2026-08-12", minimumDays: 3, todayDate: "2026-08-01", locations: [office], pickupTypeKey: "OFFICE", dropoffTypeKey: "OFFICE", pickupValues: {}, dropoffValues: {}, vehicleId: "33333333-3333-4333-8333-333333333333", insuranceSelected: false, insurancePlanId: null, promoCode: "" };
  assert.equal(model.prepareBookingCreate(base).ok, false);
  assert.equal(model.prepareBookingCreate({ ...base, pickupDate: "2026-07-31", dropoffDate: "2026-08-04" }).ok, false);
  assert.equal(model.prepareManualPayment({ amount: "0", method: "CASH", reference: "", note: "" }).ok, false);
  const payment = model.prepareManualPayment({ amount: "15,000", method: "BANK_TRANSFER", reference: "RCPT-1", note: "Deposit" });
  assert.equal(payment.ok, true);
  if (payment.ok) assert.deepEqual(payment.payload, { amount: 15000, method: "BANK_TRANSFER", reference: "RCPT-1", note: "Deposit" });
});
