import assert from "node:assert/strict";
import test from "node:test";

import { overrideOverlappingNonBlockingBookings } from "@/lib/bookings/holds";
import type { Queryable } from "@/lib/payments/pricing";

type MockResponse = {
  rows: unknown[];
  rowCount: number;
};

function createMockDb(responses: MockResponse[]) {
  const calls: Array<{ text: string; params: unknown[] | undefined }> = [];
  const queue = [...responses];

  const db: Queryable = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      const next = queue.shift();
      if (!next) {
        throw new Error(`Unexpected query: ${text}`);
      }
      return next;
    },
  };

  return { db, calls };
}

test("overrideOverlappingNonBlockingBookings: paid booking overrides overlapping unpaid bookings", async () => {
  const { db, calls } = createMockDb([
    { rows: [{}], rowCount: 1 }, // advisory lock
    { rows: [], rowCount: 0 }, // no blocking conflicts
    {
      rows: [
        {
          id: "booking-unpaid-1",
          start_date: "2026-03-19",
          end_date: "2026-03-21",
          pickup_location: "Montego Bay",
          pricing_json: { payment_status: "UNPAID", amount_paid: 0 },
          customer_name: "Test Customer",
          customer_email: "test@example.com",
          vehicle_make: "Toyota",
          vehicle_model: "Yaris",
        },
      ],
      rowCount: 1,
    },
    { rows: [], rowCount: 1 }, // update cancelled row
  ]);

  const result = await overrideOverlappingNonBlockingBookings(db, {
    paidBookingId: "booking-paid-1",
    vehicleId: "vehicle-1",
    startDate: "2026-03-19",
    endDate: "2026-03-21",
    overrideReason: "Overridden by paid booking",
  });

  assert.deepEqual(result.blockingConflictIds, []);
  assert.equal(result.overridden.length, 1);
  assert.equal(result.overridden[0]?.id, "booking-unpaid-1");
  assert.equal(result.overridden[0]?.customerEmail, "test@example.com");

  const updateCall = calls.find((call) =>
    call.text.includes("update bookings set status = 'CANCELLED'"),
  );
  assert.ok(updateCall, "expected cancelled booking update query");
  const updatePricing = (updateCall?.params?.[1] ?? null) as Record<string, unknown> | null;
  assert.equal(updatePricing?.override_reason, "Overridden by paid booking");
  assert.equal(updatePricing?.overridden_by_booking_id, "booking-paid-1");
  assert.equal(typeof updatePricing?.overridden_at, "string");
});

test("overrideOverlappingNonBlockingBookings: blocking conflicts are returned and no unpaid bookings are cancelled", async () => {
  const { db, calls } = createMockDb([
    { rows: [{}], rowCount: 1 }, // advisory lock
    { rows: [{ id: "booking-paid-existing" }], rowCount: 1 }, // blocking conflict
  ]);

  const result = await overrideOverlappingNonBlockingBookings(db, {
    paidBookingId: "booking-paid-new",
    vehicleId: "vehicle-1",
    startDate: "2026-03-19",
    endDate: "2026-03-21",
  });

  assert.deepEqual(result.blockingConflictIds, ["booking-paid-existing"]);
  assert.equal(result.overridden.length, 0);
  assert.equal(
    calls.some((call) => call.text.includes("update bookings set status = 'CANCELLED'")),
    false,
  );
});
