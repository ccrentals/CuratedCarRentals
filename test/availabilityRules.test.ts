import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateVehicleAvailabilityRules,
  isVehicleUnavailableWithAvailabilityRules,
  listAvailableVehiclesWithAvailabilityRules,
  type VehicleAvailabilityRules,
} from "@/lib/bookings/availabilityRules";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

function baseRules(overrides: Partial<VehicleAvailabilityRules> = {}): VehicleAvailabilityRules {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    vehicleId: VEHICLE_ID,
    advanceNoticeHours: 0,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    allowedPickupStartHour: null,
    allowedPickupEndHour: null,
    allowedDropoffStartHour: null,
    allowedDropoffEndHour: null,
    isActive: true,
    createdAt: "2026-02-26T00:00:00.000Z",
    updatedAt: "2026-02-26T00:00:00.000Z",
    ...overrides,
  };
}

test("availability rules evaluator: blocks pickup inside advance notice window", () => {
  const now = new Date("2026-03-10T10:00:00.000Z");
  const result = evaluateVehicleAvailabilityRules({
    rules: baseRules({ advanceNoticeHours: 4 }),
    startAt: "2026-03-10T12:00:00.000Z",
    endAt: "2026-03-10T15:00:00.000Z",
    now,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasons.some((reason) => reason.includes("at least 4 hour")), true);
});

test("availability rules evaluator: blocks pickup/dropoff hours outside allowed range", () => {
  const result = evaluateVehicleAvailabilityRules({
    rules: baseRules({
      allowedPickupStartHour: 9,
      allowedPickupEndHour: 17,
      allowedDropoffStartHour: 10,
      allowedDropoffEndHour: 18,
    }),
    startAt: "2026-03-10T08:00:00.000Z",
    endAt: "2026-03-11T00:00:00.000Z",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasons.some((reason) => reason.includes("Pickup time")), true);
  assert.equal(result.reasons.some((reason) => reason.includes("Dropoff time")), true);
});

test("availability rules evaluator: interprets hour windows in Jamaica time", () => {
  const result = evaluateVehicleAvailabilityRules({
    rules: baseRules({
      allowedPickupStartHour: 9,
      allowedPickupEndHour: 9,
      allowedDropoffStartHour: 18,
      allowedDropoffEndHour: 18,
    }),
    startAt: "2026-03-10T14:00:00.000Z",
    endAt: "2026-03-10T23:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
});

test("availability rules evaluator: inactive rules preserve the raw rental window", () => {
  const startAt = "2026-03-10T10:00:00.000Z";
  const endAt = "2026-03-10T12:00:00.000Z";
  const result = evaluateVehicleAvailabilityRules({
    rules: baseRules({
      advanceNoticeHours: 24,
      bufferBeforeMinutes: 60,
      bufferAfterMinutes: 45,
      allowedPickupStartHour: 23,
      allowedPickupEndHour: 23,
      allowedDropoffStartHour: 23,
      allowedDropoffEndHour: 23,
      isActive: false,
    }),
    startAt,
    endAt,
    now: new Date("2026-03-10T09:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.normalized?.effectiveStartAt, startAt);
  assert.equal(result.normalized?.effectiveEndAt, endAt);
});

test("availability rules enforcement: buffer-expanded window blocks adjacent booking conflicts", async () => {
  const expectedEffectiveStart = "2026-03-10T09:00:00.000Z";
  const expectedEffectiveEnd = "2026-03-10T12:00:00.000Z";

  const result = await isVehicleUnavailableWithAvailabilityRules(
    {
      vehicleId: VEHICLE_ID,
      startAt: "2026-03-10T10:00:00.000Z",
      endAt: "2026-03-10T12:00:00.000Z",
    },
    {
      includeBlockouts: true,
      client: {
        query: async <T>(text: string, params: unknown[] = []) => {
          if (/from vehicle_availability_rules/i.test(text)) {
            return {
              rows: [
                {
                  id: "22222222-2222-4222-8222-222222222222",
                  vehicle_id: VEHICLE_ID,
                  advance_notice_hours: 0,
                  buffer_before_minutes: 60,
                  buffer_after_minutes: 0,
                  allowed_pickup_start_hour: null,
                  allowed_pickup_end_hour: null,
                  allowed_dropoff_start_hour: null,
                  allowed_dropoff_end_hour: null,
                  is_active: true,
                  created_at: "2026-02-26T00:00:00.000Z",
                  updated_at: "2026-02-26T00:00:00.000Z",
                } as T,
              ],
              rowCount: 1,
            };
          }

          if (/from bookings b join vehicles v on v.id = b.vehicle_id/i.test(text)) {
            assert.equal(params[1], expectedEffectiveStart);
            assert.equal(params[2], expectedEffectiveEnd);
            return {
              rows: [
                {
                  id: "33333333-3333-4333-8333-333333333333",
                  status: "CONFIRMED",
                  vehicle_id: VEHICLE_ID,
                  start_date: "2026-03-10",
                  end_date: "2026-03-10",
                  start_at: "2026-03-10T08:45:00.000Z",
                  end_at: "2026-03-10T09:30:00.000Z",
                  amount_paid: 5000,
                  deposit_required: 5000,
                } as T,
              ],
              rowCount: 1,
            };
          }

          if (/from blockouts bo/i.test(text)) {
            return { rows: [] as T[], rowCount: 0 };
          }

          return { rows: [] as T[], rowCount: 0 };
        },
      },
    },
  );

  assert.equal(result.unavailable, true);
  assert.equal(
    result.reasons.some((reason) => reason.includes("booking/blockout buffer")),
    true,
  );
  assert.equal(result.normalized?.effectiveStartAt, expectedEffectiveStart);
  assert.equal(result.normalized?.effectiveEndAt, expectedEffectiveEnd);
});

test("availability rules enforcement: inactive rules skip buffer expansion during conflict checks", async () => {
  const startAt = "2026-03-10T10:00:00.000Z";
  const endAt = "2026-03-10T12:00:00.000Z";

  const result = await isVehicleUnavailableWithAvailabilityRules(
    {
      vehicleId: VEHICLE_ID,
      startAt,
      endAt,
    },
    {
      includeBlockouts: true,
      rulesOverride: baseRules({
        advanceNoticeHours: 24,
        bufferBeforeMinutes: 60,
        bufferAfterMinutes: 30,
        allowedPickupStartHour: 23,
        allowedPickupEndHour: 23,
        allowedDropoffStartHour: 23,
        allowedDropoffEndHour: 23,
        isActive: false,
      }),
      client: {
        query: async <T>(text: string, params: unknown[] = []) => {
          if (/from bookings b join vehicles v on v.id = b.vehicle_id/i.test(text)) {
            assert.equal(params[1], startAt);
            assert.equal(params[2], endAt);
            return { rows: [] as T[], rowCount: 0 };
          }
          if (/from blockouts bo/i.test(text)) {
            return { rows: [] as T[], rowCount: 0 };
          }
          return { rows: [] as T[], rowCount: 0 };
        },
      },
    },
  );

  assert.equal(result.unavailable, false);
  assert.equal(result.normalized?.effectiveStartAt, startAt);
  assert.equal(result.normalized?.effectiveEndAt, endAt);
});

test("availability rules list: excludes vehicles blocked by rule precheck before conflict query", async () => {
  const now = new Date("2026-03-10T10:00:00.000Z");
  const firstVehicleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const secondVehicleId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const queriedVehicleIds: string[] = [];

  const available = await listAvailableVehiclesWithAvailabilityRules(
    [{ id: firstVehicleId }, { id: secondVehicleId }],
    {
      startAt: "2026-03-10T11:00:00.000Z",
      endAt: "2026-03-10T13:00:00.000Z",
    },
    {
      now,
      client: {
        query: async <T>(text: string, params: unknown[] = []) => {
          if (/from vehicle_availability_rules/i.test(text)) {
            return {
              rows: [
                {
                  id: "rule-1",
                  vehicle_id: firstVehicleId,
                  advance_notice_hours: 24,
                  buffer_before_minutes: 0,
                  buffer_after_minutes: 0,
                  allowed_pickup_start_hour: null,
                  allowed_pickup_end_hour: null,
                  allowed_dropoff_start_hour: null,
                  allowed_dropoff_end_hour: null,
                  is_active: true,
                  created_at: "2026-02-26T00:00:00.000Z",
                  updated_at: "2026-02-26T00:00:00.000Z",
                } as T,
              ],
              rowCount: 1,
            };
          }

          if (/from bookings b join vehicles v on v.id = b.vehicle_id/i.test(text)) {
            queriedVehicleIds.push(String(params[0]));
            return { rows: [] as T[], rowCount: 0 };
          }
          if (/from blockouts bo/i.test(text)) {
            return { rows: [] as T[], rowCount: 0 };
          }
          return { rows: [] as T[], rowCount: 0 };
        },
      },
    },
  );

  assert.deepEqual(available.map((vehicle) => vehicle.id), [secondVehicleId]);
  assert.deepEqual(queriedVehicleIds, [secondVehicleId]);
});
