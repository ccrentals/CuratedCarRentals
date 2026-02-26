import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateRangeDaysInclusive,
  calculateVehiclePerformanceKpis,
  handleVehiclePerformanceGet,
} from "@/app/api/admin/vehicles/[id]/performance/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

function adminSession() {
  return {
    userId: "99999999-9999-4999-8999-999999999999",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function samplePayload(start: string, end: string) {
  return {
    range: { start, end },
    kpis: {
      bookedDays: 4,
      availableDays: 10,
      utilizationPct: 40,
      revenueCents: 120000,
      depositCents: 30000,
      bookingCount: 2,
      avgBookingDays: 2,
      downtimeDays: 1,
      maintenanceBlockouts: 1,
    },
    breakdown: {
      byMonth: [
        {
          month: "2026-02",
          bookedDays: 4,
          downtimeDays: 1,
          bookingCount: 2,
          revenueCents: 120000,
        },
      ],
      recentBookings: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          start: "2026-02-11T10:00:00.000Z",
          end: "2026-02-13T10:00:00.000Z",
          status: "COMPLETED",
          customerName: "Jane Doe",
          totalCents: 60000,
          depositCents: 15000,
        },
      ],
    },
  };
}

test("vehicle performance API: requires auth", async () => {
  const response = await handleVehiclePerformanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/performance`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      vehicleExists: async () => true,
      fetchPerformance: async () => samplePayload("2026-01-01", "2026-03-31"),
    },
  );

  assert.equal(response.status, 401);
});

test("vehicle performance API: validates vehicle id", async () => {
  const response = await handleVehiclePerformanceGet(
    new Request("http://localhost/api/admin/vehicles/not-a-uuid/performance"),
    { params: Promise.resolve({ id: "not-a-uuid" }) },
    {
      getSession: async () => adminSession(),
      vehicleExists: async () => true,
      fetchPerformance: async () => samplePayload("2026-01-01", "2026-03-31"),
    },
  );

  assert.equal(response.status, 400);
});

test("vehicle performance API: returns 404 when vehicle is missing", async () => {
  let called = false;
  const response = await handleVehiclePerformanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/performance`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      vehicleExists: async () => false,
      fetchPerformance: async () => {
        called = true;
        return samplePayload("2026-01-01", "2026-03-31");
      },
    },
  );

  assert.equal(response.status, 404);
  assert.equal(called, false);
});

test("vehicle performance API: default range uses 90d preset", async () => {
  let capturedInput: {
    vehicleId: string;
    startDate: string;
    endDate: string;
    rangePreset: "30d" | "90d" | "365d" | "custom";
  } | null = null;

  const response = await handleVehiclePerformanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/performance`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      vehicleExists: async () => true,
      fetchPerformance: async (input) => {
        capturedInput = input;
        return samplePayload(input.startDate, input.endDate);
      },
    },
  );

  assert.equal(response.status, 200);
  assert.ok(capturedInput, "expected parsed input");
  const parsed = capturedInput as {
    vehicleId: string;
    startDate: string;
    endDate: string;
    rangePreset: "30d" | "90d" | "365d" | "custom";
  };

  assert.equal(parsed.vehicleId, VEHICLE_ID);
  assert.equal(parsed.rangePreset, "90d");
  assert.match(parsed.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(parsed.endDate, /^\d{4}-\d{2}-\d{2}$/);

  const body = (await response.json()) as {
    ok?: boolean;
    range?: { start?: string; end?: string };
    kpis?: { utilizationPct?: number; bookingCount?: number };
    breakdown?: { byMonth?: Array<{ month?: string }>; recentBookings?: Array<{ id?: string }> };
  };

  assert.equal(body.ok, true);
  assert.equal(body.range?.start, parsed.startDate);
  assert.equal(body.range?.end, parsed.endDate);
  assert.equal(body.kpis?.bookingCount, 2);
  assert.equal(body.breakdown?.byMonth?.[0]?.month, "2026-02");
  assert.equal(body.breakdown?.recentBookings?.[0]?.id, "22222222-2222-4222-8222-222222222222");
});

test("vehicle performance API: validates custom range params", async () => {
  const missingRangeResponse = await handleVehiclePerformanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/performance?range=custom`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      vehicleExists: async () => true,
      fetchPerformance: async () => samplePayload("2026-01-01", "2026-03-31"),
    },
  );

  assert.equal(missingRangeResponse.status, 400);

  const invalidRangeResponse = await handleVehiclePerformanceGet(
    new Request(
      `http://localhost/api/admin/vehicles/${VEHICLE_ID}/performance?range=custom&start=2026-03-12&end=2026-03-01`,
    ),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      vehicleExists: async () => true,
      fetchPerformance: async () => samplePayload("2026-01-01", "2026-03-31"),
    },
  );

  assert.equal(invalidRangeResponse.status, 400);
});

test("vehicle performance math: one booking and one maintenance blockout sanity", () => {
  const rangeDays = calculateRangeDaysInclusive("2026-03-01", "2026-03-07");
  assert.equal(rangeDays, 7);

  const kpis = calculateVehiclePerformanceKpis({
    rangeDays,
    bookedDays: 1,
    downtimeDays: 1,
    revenueCents: 35000,
    depositCents: 8000,
    bookingCount: 1,
    avgBookingDays: 1,
    maintenanceBlockouts: 1,
  });

  assert.equal(kpis.bookedDays, 1);
  assert.equal(kpis.downtimeDays, 1);
  assert.equal(kpis.availableDays, 6);
  assert.equal(kpis.bookingCount, 1);
  assert.equal(kpis.maintenanceBlockouts, 1);
  assert.equal(kpis.revenueCents, 35000);
  assert.equal(kpis.depositCents, 8000);
  assert.equal(kpis.utilizationPct, 16.67);
});
