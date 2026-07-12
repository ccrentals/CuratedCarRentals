import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("booking itinerary preview displays stored JMD units without cent conversion", async () => {
  const form = await readFile("src/components/admin/BookingUpdateForm.tsx", "utf8");
  assert.doesNotMatch(form, /Number\(value \?\? 0\)\) \/ 100/);
});
