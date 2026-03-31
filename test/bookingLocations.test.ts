import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOKING_LOCATION_LABELS,
  buildBookingLocationConfigs,
  createBookingLocationDetails,
  formatBookingLocationAdminNote,
  getBookingLocationAdminBadgeLabel,
  getBookingLocationDisplayLabel,
  inferBookingLocationType,
  readBookingLocationDetails,
} from "@/lib/bookings/bookingLocations";

test("booking locations helper returns exact phase-one configs", () => {
  const configs = buildBookingLocationConfigs([
    {
      id: "airport-id",
      label: BOOKING_LOCATION_LABELS.AIRPORT,
      allow_pickup: true,
      allow_dropoff: true,
      is_active: true,
      sort_order: 7,
    },
  ]);

  assert.deepEqual(
    configs.map((config) => ({
      type: config.locationType,
      pickupLabel: config.pickupLabel,
      dropoffLabel: config.dropoffLabel,
      dbBacked: config.dbBacked,
    })),
    [
      {
        type: "OFFICE",
        pickupLabel: BOOKING_LOCATION_LABELS.OFFICE,
        dropoffLabel: BOOKING_LOCATION_LABELS.OFFICE,
        dbBacked: false,
      },
      {
        type: "AIRPORT",
        pickupLabel: BOOKING_LOCATION_LABELS.AIRPORT,
        dropoffLabel: BOOKING_LOCATION_LABELS.AIRPORT,
        dbBacked: true,
      },
      {
        type: "CUSTOM_ADDRESS",
        pickupLabel: BOOKING_LOCATION_LABELS.PICKUP_CUSTOM,
        dropoffLabel: BOOKING_LOCATION_LABELS.DROPOFF_CUSTOM,
        dbBacked: false,
      },
    ],
  );
});

test("booking locations helper infers internal type from exact and legacy labels", () => {
  assert.equal(inferBookingLocationType({ label: BOOKING_LOCATION_LABELS.OFFICE }), "OFFICE");
  assert.equal(inferBookingLocationType({ label: BOOKING_LOCATION_LABELS.AIRPORT }), "AIRPORT");
  assert.equal(inferBookingLocationType({ label: "Kingston International Airport" }), "AIRPORT");
  assert.equal(inferBookingLocationType({ label: "Some villa in St. Ann" }), "CUSTOM_ADDRESS");
});

test("booking locations helper returns side-specific custom labels and admin badge labels", () => {
  assert.equal(getBookingLocationDisplayLabel("CUSTOM_ADDRESS", "pickup"), "Pick up Address");
  assert.equal(getBookingLocationDisplayLabel("CUSTOM_ADDRESS", "dropoff"), "Return Address");
  assert.equal(getBookingLocationAdminBadgeLabel("OFFICE"), "Old Hope Road");
  assert.equal(getBookingLocationAdminBadgeLabel("AIRPORT"), "Airport");
  assert.equal(getBookingLocationAdminBadgeLabel("CUSTOM_ADDRESS"), "Custom address");
});

test("booking locations helper creates and reads structured location details", () => {
  const details = createBookingLocationDetails({
    pickup: {
      type: "AIRPORT",
      label: BOOKING_LOCATION_LABELS.AIRPORT,
      flightDate: "2026-03-30",
      flightTime: "08:59",
      flightNumber: "BW123",
      airline: "Caribbean Airlines",
      locationId: "airport-id",
    },
    dropoff: {
      type: "CUSTOM_ADDRESS",
      label: BOOKING_LOCATION_LABELS.DROPOFF_CUSTOM,
      address: "12 Hope Road, Kingston",
    },
  });

  assert.equal(details.pickup.type, "AIRPORT");
  assert.equal(details.pickup.flightNumber, "BW123");
  assert.equal(details.dropoff.address, "12 Hope Road, Kingston");

  const restored = readBookingLocationDetails(
    { booking_location_details: details },
    {
      pickupLabel: BOOKING_LOCATION_LABELS.AIRPORT,
      dropoffLabel: BOOKING_LOCATION_LABELS.DROPOFF_CUSTOM,
      pickupLocationId: "airport-id",
      dropoffLocationId: null,
    },
  );

  assert.equal(restored.pickup.locationId, "airport-id");
  assert.equal(restored.dropoff.type, "CUSTOM_ADDRESS");
  assert.equal(restored.dropoff.label, BOOKING_LOCATION_LABELS.DROPOFF_CUSTOM);
});

test("booking locations helper formats admin summary note from structured details", () => {
  const message = formatBookingLocationAdminNote(
    createBookingLocationDetails({
      pickup: {
        type: "OFFICE",
        label: BOOKING_LOCATION_LABELS.OFFICE,
      },
      dropoff: {
        type: "AIRPORT",
        label: BOOKING_LOCATION_LABELS.AIRPORT,
        flightDate: "2026-04-01",
        flightTime: "11:00",
      },
    }),
  );

  assert.match(message, /Pickup: 168 1\/2 Old Hope Road, Kingston Jamaica/);
  assert.match(message, /Dropoff: Norman Manley Airport/);
  assert.match(message, /Date 2026-04-01/);
});
