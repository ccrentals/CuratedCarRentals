import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdminBookingDetailView,
  buildAdminBookingNotes,
} from "@/lib/bookings/adminBookingDetailView";

test("admin booking detail notes merge payment notes ahead of older admin notes", () => {
  const notes = buildAdminBookingNotes(
    [
      {
        note_id: "admin-1",
        message: "Location updated",
        created_at: "2026-03-30T10:00:00.000Z",
      },
    ],
    [
      {
        id: "pay-1",
        public_id: "PA100001",
        provider: "MANUAL",
        status: "SUCCEEDED",
        deposit_amount_cents: 1000,
        currency: "JMD",
        created_at: "2026-03-30T12:00:00.000Z",
        metadata_json: {
          method_label: "Cash",
          reference: "REF-1",
          note: "Paid on site",
        },
      },
    ],
  );

  assert.equal(notes.length, 2);
  assert.equal(notes[0]?.message, "Payment PA100001 (Cash) • Ref: REF-1 • Note: Paid on site");
  assert.equal(notes[1]?.message, "Location updated");
});

test("admin booking detail view builds a complete mutable detail payload", () => {
  const detail = buildAdminBookingDetailView({
    versionKey: "booking-1:1",
    bookingId: "booking-1",
    bookingPublicId: "BK100001",
    bookingStatus: "CONFIRMED",
    displayStatus: "CONFIRMED",
    isNonBlocking: false,
    isOverridden: false,
    isPaidInFull: false,
    isDepositPaid: true,
    vehicleId: "vehicle-1",
    vehicleLabel: "2020 Subaru XV",
    initialPromoCode: "WELCOME",
    initialInsuranceSelected: true,
    entitlement: "ENTITLED",
    paymentOptionLabel: "DEPOSIT",
    customPaymentAmountCents: null,
    cancellationReason: null,
    pickupDateTimeLabel: "Mar 30, 2026, 11:00 AM",
    dropoffDateTimeLabel: "Apr 1, 2026, 11:00 AM",
    pickupLocationSnapshot: "Norman Manley Airport",
    dropoffLocationSnapshot: "10 Harbour Street, Kingston",
    bookingLocationDetails: {
      pickup: {
        type: "Airport",
        typeKey: "AIRPORT",
        label: "Norman Manley Airport",
        values: {
          flight_arrival_date: "2026-03-30",
          flight_arrival_time: "11:00",
        },
        fieldLabels: {
          flight_arrival_date: "Flight Arrival Date",
          flight_arrival_time: "Flight Arrival Time",
        },
        locationId: "loc-airport",
      },
      dropoff: {
        type: "Custom address",
        typeKey: "CUSTOM_ADDRESS",
        label: "Return Address",
        values: {
          address: "10 Harbour Street, Kingston",
        },
        fieldLabels: {
          address: "Return Address",
        },
        locationId: null,
      },
    },
    customerName: "Damian Thompson",
    customerEmail: "damian@example.com",
    customerPhone: "876-555-1000",
    driversLicenseNumber: "DL12345",
    hasDriversLicenseDoc: true,
    hasSignatureDoc: false,
    days: 2,
    paidToDate: 5000,
    totalBeforePromo: 24000,
    total: 22000,
    insuranceSelected: true,
    paymentOption: "DEPOSIT",
    paymentStatus: "PARTIALLY_PAID",
    dailyRate: 12000,
    insurancePricePerDay: 1500,
    insuranceTotal: 3000,
    promoCode: "WELCOME",
    promoTotal: 2000,
    depositDue: 1000,
    balanceDue: 17000,
    refundRequired: false,
    notes: [
      {
        note_id: "admin-1",
        message: "Location updated",
        created_at: "2026-03-30T10:00:00.000Z",
      },
    ],
    form: {
      startDate: "2026-03-30",
      endDate: "2026-04-01",
      pickupTime: "11:00",
      dropoffTime: "11:00",
      customerName: "Damian Thompson",
      customerEmail: "damian@example.com",
      customerPhone: "876-555-1000",
      pickupLocationTypeKey: "AIRPORT",
      dropoffLocationTypeKey: "CUSTOM_ADDRESS",
      pickupLocationValues: {
        flight_arrival_date: "2026-03-30",
      },
      dropoffLocationValues: {
        address: "10 Harbour Street, Kingston",
      },
      disabled: false,
    },
  });

  assert.equal(detail.pickupLocationBadge, "Airport");
  assert.equal(detail.dropoffLocationBadge, "Custom address");
  assert.equal(detail.bookingDetails.pickupLocationLabel, "Norman Manley Airport");
  assert.deepEqual(detail.bookingDetails.pickupLocationLines, [
    "Flight Arrival Date: 2026-03-30",
    "Flight Arrival Time: 11:00",
  ]);
  assert.deepEqual(detail.bookingDetails.dropoffLocationLines, [
    "Return Address: 10 Harbour Street, Kingston",
  ]);
  assert.equal(detail.customer.driversLicenseNumber, "DL12345");
  assert.equal(detail.chargesSummary.balanceDue, 17000);
  assert.equal(detail.form.dropoffLocationTypeKey, "CUSTOM_ADDRESS");
});
