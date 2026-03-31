import {
  buildBookingLocationConfigs,
  type BookingLocationConfig,
  type BookingLocationDbRow,
} from "@/lib/bookings/bookingLocations";

type Queryable = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{
    rows: unknown[];
  }>;
};

export async function listActiveBookingLocationConfigs(db: Queryable) {
  const result = await db.query(
    `select
        id,
        label,
        allow_pickup,
        allow_dropoff,
        applies_to_pickup,
        applies_to_dropoff,
        location_type_key,
        display_label_pickup,
        display_label_dropoff,
        field_schema_json,
        is_active,
        sort_order
      from booking_locations
      where is_active = true
      order by sort_order asc, location_type_key asc, created_at asc`,
  );

  return buildBookingLocationConfigs(result.rows as BookingLocationDbRow[]).filter(
    (config) => config.isActive,
  );
}

export function findBookingLocationConfigById(
  configs: BookingLocationConfig[],
  id: string | null | undefined,
) {
  if (!id) return null;
  return configs.find((config) => config.id === id) ?? null;
}
