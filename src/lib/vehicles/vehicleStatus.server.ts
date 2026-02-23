import "server-only";

import { dbQuery } from "@/lib/db";
import {
  getStartOfToday,
  nextRelevantBookingWindowFromBookings,
  type NextRelevantBookingWindow,
  type VehicleStatusBookingLike,
} from "@/lib/vehicles/vehicleStatus";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function nextRelevantBookingWindow(
  vehicleId: string,
  now = new Date(),
): Promise<NextRelevantBookingWindow | null> {
  if (!UUID_REGEX.test(vehicleId)) return null;

  const startOfToday = getStartOfToday(now).toISOString();
  const result = await dbQuery<VehicleStatusBookingLike>(
    "select b.id, b.status, b.archived_at, b.start_at, b.start_date, b.end_at, b.end_date, b.pricing_json, v.deposit_cents as vehicle_deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id where b.vehicle_id = $1::uuid and coalesce(b.start_at, b.start_date::timestamptz) >= $2::timestamptz order by coalesce(b.start_at, b.start_date::timestamptz) asc limit 24",
    [vehicleId, startOfToday],
  );

  return nextRelevantBookingWindowFromBookings(result.rows, now);
}
